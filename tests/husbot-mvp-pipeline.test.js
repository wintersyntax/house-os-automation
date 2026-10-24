import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createCloudServer} from '../src/husbot/cloud-main.js';

/**
 * TASK-017: fully synthetic end-to-end composition check.
 * Node loopback only; Google, Trello and Slack APIs are injected mocks.
 * The real Cloud Run worker must additionally be protected by IAM.
 */
const team='T123456789',channel='C123456789',app='A123456789';
const signing='fictional-secret-do-not-use-123456789';
const project='synthetic-house-123';
const env={
  HUSBOT_PROJECT:project,HUSBOT_REGION:'europe-west1',HUSBOT_QUEUE:'husbot-queue',
  HUSBOT_WORKER_URL:'https://portfolio-fixture-not-deployed.run.app',
  HUSBOT_TASK_INVOKER_SA:'husbot-push@synthetic-house-123.iam.gserviceaccount.com',
  HUSBOT_SLACK_APP_ID:app,HUSBOT_SLACK_TEAM_ID:team,
  HUSBOT_TEST_CHANNEL_ID:channel,HUSBOT_SLACK_SIGNING_SECRET:signing,
  HUSBOT_SLACK_BOT_TOKEN:'xoxb-portfolio-synthetic-placeholder',HUSBOT_LIVE_SEND_ENABLED:'true',
  TRELLO_BOARD_ID:'b'.repeat(24),TRELLO_API_KEY:'TEST_READ_KEY_1234',
  TRELLO_READ_TOKEN:'TEST_READ_TOKEN_123456789',
};

async function start(server){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return 'http://127.0.0.1:'+server.address().port;
}
async function stop(server){await new Promise(resolve=>server.close(resolve));}
const json=(data,status=200)=>({status,ok:status>=200&&status<300,json:async()=>data});

test('TASK-017 signed Slack mention reaches exactly one deterministic Trello-grounded reply',async()=>{
  const durable=new Map(),claims=new Set(),answers=[];
  const fakeFetch=async(url,init={})=>{
    const address=new URL(url);
    if(address.hostname==='metadata.google.internal')
      return json({access_token:'A'.repeat(60),token_type:'Bearer'});
    if(address.hostname==='cloudtasks.googleapis.com'){
      const body=JSON.parse(init.body);
      const task=body.task;
      if(durable.has(task.name))return json({},409);
      durable.set(task.name,JSON.parse(Buffer.from(task.httpRequest.body,'base64').toString('utf8')));
      return json({name:task.name});
    }
    if(address.hostname==='firestore.googleapis.com'){
      const id=address.searchParams.get('documentId');
      const fields=JSON.parse(init.body).fields;
      assert.equal(typeof fields.expiresAt.timestampValue,'string');
      assert.ok(Date.parse(fields.expiresAt.timestampValue) > Date.now()+29*86400000);
      assert.deepEqual(Object.keys(fields).sort(),['eventHash','expiresAt','kind']);
      if(claims.has(id))return json({},409);
      claims.add(id);
      return json({name:'projects/'+project+'/databases/(default)/documents/husbot_reply_claims/'+id});
    }
    if(address.hostname==='api.trello.com'){
      assert.equal(init.method,'GET');
      if(address.pathname.endsWith('/lists'))
        return json([{id:'l1',name:'📦 INVENTAR'},
          {id:'l2',name:'🛒 HANDLELISTE'}]);
      if(address.pathname.endsWith('/customFields'))
        return json([{id:'f1',name:'I · Status',type:'list',options:[
          {id:'ok',value:{text:'OK'}},{id:'lav',value:{text:'LAV'}},
          {id:'kjop',value:{text:'KJØP'}},
        ]}]);
      if(address.pathname.endsWith('/cards'))
        return json([{id:'c1',name:'Synthetic soap',idList:'l1',closed:false,
          customFieldItems:[{idCustomField:'f1',idValue:'kjop'}]},
          {id:'a'.repeat(24),name:'Neste handletur',idList:'l2',closed:false}]);
      if(address.pathname.endsWith('/checklists'))
        return json([{id:'b'.repeat(24),idCard:'a'.repeat(24),
          name:'Varer som skal kjøpes',checkItems:[
            {id:'c'.repeat(24),name:'Synthetic flowers',state:'incomplete'},
            {id:'d'.repeat(24),name:'Synthetic paid item',state:'complete'},
          ]}]);
    }
    if(address.hostname==='slack.com'){
      assert.equal(address.pathname,'/api/chat.postMessage');
      const body=JSON.parse(init.body);
      assert.equal(body.channel,channel);
      answers.push(body);
      return json({ok:true,channel,ts:'1729000001.000002'});
    }
    throw Error('Unexpected external network target (mock): '+address.hostname);
  };
  const ingress=createCloudServer({...env,HUSBOT_ROLE:'ingress'},fakeFetch);
  const worker=createCloudServer({...env,HUSBOT_ROLE:'worker'},fakeFetch);
  const [ingressUrl,workerUrl]=await Promise.all([start(ingress),start(worker)]);
  async function sendSlack(id,text){
    const timestamp=String(Math.floor(Date.now()/1000));
    const body=JSON.stringify({type:'event_callback',api_app_id:app,team_id:team,
      event_id:id,event:{type:'app_mention',channel,user:'U123456789',text,
        ts:'1729000000.000001'}});
    const signature='v0='+createHmac('sha256',signing)
      .update('v0:'+timestamp+':'+body).digest('hex');
    return fetch(ingressUrl+'/slack/events',{method:'POST',
      headers:{'Content-Type':'application/json',
        'X-Slack-Request-Timestamp':timestamp,'X-Slack-Signature':signature},
      body});
  }
  async function process(id){
    const task=[...durable.values()].find(x=>x.eventId===id);
    assert.ok(task);
    return fetch(workerUrl+'/internal/task',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(task)});
  }
  try{
    assert.equal((await sendSlack('EvABCDEFGHIJKL','<@U123456789> ping')).status,200);
    assert.equal((await process('EvABCDEFGHIJKL')).status,204);
    assert.equal(answers.length,1);
    assert.equal(answers[0].text,'Hei! 👋 Husbot er på nett.');
    const second='EvABCDEFGHIJKLMNOP';
    assert.equal((await sendSlack(second,'<@U123456789> hva trenger vi å kjøpe?')).status,200);
    assert.equal((await process(second)).status,204);
    assert.equal(answers.length,2);
    assert.match(answers[1].text,/Synthetic soap — KJØP/);
    assert.match(answers[1].text,/Synthetic flowers — HANDLELISTE/);
    assert.doesNotMatch(answers[1].text,/Synthetic paid item/);
    assert.equal(durable.size,2);
    // A new Slack event with the exact same question must receive a fresh reply.
    const repeatedQuestion='EvABCDEFGHIJKLMNOPQ';
    assert.equal((await sendSlack(repeatedQuestion,
      '<@U123456789> hva trenger vi å kjøpe?')).status,200);
    assert.equal((await process(repeatedQuestion)).status,204);
    assert.equal(answers.length,3);
    assert.equal(answers[2].text,answers[1].text);
    assert.equal(durable.size,3);
    // Slack replay, then even a repeated Cloud Tasks delivery:
    assert.equal((await sendSlack(second,'<@U123456789> hva trenger vi å kjøpe?')).status,200);
    assert.equal((await process(second)).status,204);
    assert.equal(answers.length,3);
    assert.equal(claims.size,3);
    // A forged or unapproved channel event never enters durable Cloud Tasks.
    const forgedTimestamp=String(Math.floor(Date.now()/1000));
    const forged=JSON.stringify({type:'event_callback',api_app_id:app,team_id:team,
      event_id:'EvUNKNOWN12345',event:{type:'app_mention',
        channel:'C999999999',user:'U123456789',text:'ping',ts:'1729000000.000001'}});
    const forgedSignature='v0='+createHmac('sha256',signing)
      .update('v0:'+forgedTimestamp+':'+forged).digest('hex');
    assert.equal((await fetch(ingressUrl+'/slack/events',{method:'POST',
      headers:{'X-Slack-Request-Timestamp':forgedTimestamp,
        'X-Slack-Signature':forgedSignature},body:forged})).status,200);
    assert.equal(durable.size,3);
  }finally{
    await Promise.all([stop(ingress),stop(worker)]);
  }
});
