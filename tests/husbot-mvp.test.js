import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleAccessToken, createCloudTasksEnqueue, createFirestoreClaims, eventKey}
  from '../src/husbot/cloud-platform.js';
import {classifyMention, createAnswer, createLiveSlackSender}
  from '../src/husbot/live-reply.js';
import {createTaskWorker, createTaskWorkerHttpServer}
  from '../src/husbot/cloud-worker.js';
import {createCloudServer} from '../src/husbot/cloud-main.js';

const env = {
  HUSBOT_PROJECT: 'safe-house-os-123',
  HUSBOT_REGION: 'europe-west1',
  HUSBOT_QUEUE: 'husbot-test-queue',
  HUSBOT_WORKER_URL: 'https://portfolio-fixture-not-deployed.run.app',
  HUSBOT_TASK_INVOKER_SA: 'husbot-invoker@safe-house-os-123.iam.gserviceaccount.com',
  HUSBOT_SLACK_APP_ID: 'A123456789',
  HUSBOT_SLACK_TEAM_ID: 'T123456789',
  HUSBOT_TEST_CHANNEL_ID: 'C123456789',
  HUSBOT_SLACK_SIGNING_SECRET: 'some-long-synthetic-signing-secret',
  HUSBOT_SLACK_BOT_TOKEN: 'xoxb-portfolio-synthetic-placeholder',
  HUSBOT_LIVE_SEND_ENABLED: 'true',
  TRELLO_API_KEY: 'TEST_READ_KEY_123456',
  TRELLO_READ_TOKEN: 'TEST_READ_TOKEN_123456789',
  TRELLO_BOARD_ID: 'a'.repeat(24),
};
const job = {
  kind:'HUSBOT_MENTION_V1', eventId:'EvABCDEFGHIJKL',
  teamId: env.HUSBOT_SLACK_TEAM_ID, channelId: env.HUSBOT_TEST_CHANNEL_ID,
  userId: 'U123456789', text:'<@U123456789> ping',
  messageTs:'1729000000.000001', threadTs:'1729000000.000001',
};
const snapshot = {inventory:[{id:'invented-a',name:'Synthetic tablets',status:'ok'},
  {id:'invented-b',name:'Synthetic soap',status:'kjøp'}],
  shoppingAttention:[{id:'invented-b',name:'Synthetic soap'}],
  shoppingList:[{id:'shopping-one',name:'Synthetic detergent'}]};
const token=async()=> 'synthetic_access_token';

test('TASK-017 metadata token requires Google flavor header, no credentials in URL', async()=>{
  let called;
  const get = createGoogleAccessToken({fetchImpl:async(url,options)=>{
    called={url,options};return {ok:true,json:async()=>({
      access_token:'A'.repeat(60),token_type:'Bearer'})};
  }});
  assert.equal((await get()).length,60);
  assert.equal(called.options.method,'GET');
  assert.equal(called.options.headers['Metadata-Flavor'],'Google');
  assert.match(called.url,/^http:\/\/metadata\.google\.internal\//);
  assert.doesNotMatch(called.url,/token=|key=/);
  const refused=createGoogleAccessToken({fetchImpl:async()=>({ok:false})});
  await assert.rejects(refused(),/metadata refused/);
});

test('TASK-017 stable Cloud Tasks identity, OIDC target and durable ACK',async()=>{
  let call;
  const enqueue=createCloudTasksEnqueue({
    project:env.HUSBOT_PROJECT,region:env.HUSBOT_REGION,queue:env.HUSBOT_QUEUE,
    workerUrl:env.HUSBOT_WORKER_URL,invokerServiceAccount:env.HUSBOT_TASK_INVOKER_SA,
    accessToken:token,
    fetchImpl:async(url,init)=>{
      call={url,init,body:JSON.parse(init.body)};
      return {status:200,json:async()=>({name:call.body.task.name})};
    },
  });
  assert.deepEqual(await enqueue(job),{durability:'durable',state:'stored'});
  assert.equal(call.init.method,'POST');
  assert.equal(call.init.headers.Authorization,'Bearer synthetic_access_token');
  assert.equal(call.body.task.name.split('/').at(-1),eventKey(job.eventId));
  assert.equal(call.body.task.httpRequest.oidcToken.audience,env.HUSBOT_WORKER_URL);
  assert.equal(call.body.task.httpRequest.oidcToken.serviceAccountEmail,env.HUSBOT_TASK_INVOKER_SA);
  assert.equal(call.body.task.httpRequest.url,env.HUSBOT_WORKER_URL+'/internal/task');
  assert.deepEqual(JSON.parse(Buffer.from(call.body.task.httpRequest.body,'base64').toString()),job);
  assert.equal(call.body.task.httpRequest.headers['Content-Type'],'application/json');
  assert.doesNotMatch(JSON.stringify(call.body),/TEST_READ_TOKEN|signing-secret/);
});

test('TASK-017 Cloud Tasks duplicate is durable, other failures and ambiguous ACK are RED',async()=>{
  const make=response=>createCloudTasksEnqueue({
    project:env.HUSBOT_PROJECT,region:env.HUSBOT_REGION,queue:env.HUSBOT_QUEUE,
    workerUrl:env.HUSBOT_WORKER_URL,invokerServiceAccount:env.HUSBOT_TASK_INVOKER_SA,
    accessToken:token,fetchImpl:async()=>response});
  assert.deepEqual(await make({status:409})(job),{durability:'durable',state:'duplicate'});
  await assert.rejects(make({status:403})(job),/refused/);
  await assert.rejects(make({status:200,json:async()=>({name:'wrong'})})(job),/mismatch/);
  await assert.rejects(make(null)(job),/malformed/);
  await assert.rejects(make({status:500})(job),/refused/);
  await assert.rejects(make({status:200,json:async()=>{throw Error('secret')}})(job),/malformed/);
  assert.throws(()=>createCloudTasksEnqueue({
    project:env.HUSBOT_PROJECT,region:env.HUSBOT_REGION,queue:env.HUSBOT_QUEUE,
    workerUrl:'http://localhost:8080',invokerServiceAccount:env.HUSBOT_TASK_INVOKER_SA,
    accessToken:token}),/worker/);
});

test('TASK-017 Firestore first claim is terminal and duplicate cannot send',async()=>{
  let urlSeen;
  const make=response=>createFirestoreClaims({
    project:env.HUSBOT_PROJECT,accessToken:token,
    fetchImpl:async(url,init)=>{urlSeen=url;assert.equal(init.method,'POST');return response;}});
  const claim=make({status:200,json:async()=>({name:
    'projects/'+env.HUSBOT_PROJECT+'/databases/(default)/documents/husbot_reply_claims/'+eventKey(job.eventId)})});
  assert.equal(await claim(job.eventId),'claimed');
  assert.ok(urlSeen.endsWith('documentId='+eventKey(job.eventId)));
  assert.equal(await make({status:409})(job.eventId),'duplicate');
  await assert.rejects(make({status:503})(job.eventId),/refused/);
  await assert.rejects(make({status:200,json:async()=>({name:'not-the-claim'})})(job.eventId),/mismatch/);
});

test('TASK-018 Firestore reply claims retain only identifiers for 30 UTC days',async()=>{
  const createdAt=Date.UTC(2026,9,16,12,30,0);
  const requests=[];
  const claim=createFirestoreClaims({
    project:env.HUSBOT_PROJECT,accessToken:token,nowMs:()=>createdAt,
    fetchImpl:async(url,init)=>{
      const body=JSON.parse(init.body);
      requests.push({url,body});
      const id=new URL(url).searchParams.get('documentId');
      return {status:200,json:async()=>({name:
        'projects/'+env.HUSBOT_PROJECT+'/databases/(default)/documents/husbot_reply_claims/'+id})};
    },
  });
  assert.equal(await claim(job.eventId),'claimed');
  assert.equal(await claim('EvABCDEFGHIJKM'),'claimed');
  assert.equal(requests.length,2);
  assert.notEqual(requests[0].url,requests[1].url);
  for(const {body} of requests){
    assert.deepEqual(Object.keys(body.fields).sort(),['eventHash','expiresAt','kind']);
    assert.equal(body.fields.expiresAt.timestampValue,'2026-11-15T12:30:00.000Z');
    assert.equal(body.fields.kind.stringValue,'HUSBOT_SLACK_REPLY_CLAIM_V1');
    assert.doesNotMatch(JSON.stringify(body),/ping|Synthetic soap|HUSBOT_MENTION_V1/);
  }
});

test('TASK-018 invalid claim clocks fail before any Firestore write',async()=>{
  let attempts=0;
  for(const value of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER,
    Date.UTC(10000,0,1)]){
    const claim=createFirestoreClaims({
      project:env.HUSBOT_PROJECT,accessToken:token,nowMs:()=>value,
      fetchImpl:async()=>{attempts++;return {status:200};},
    });
    await assert.rejects(claim(job.eventId),/claim clock|claim expiry/);
  }
  assert.equal(attempts,0);
  assert.throws(()=>createFirestoreClaims({
    project:env.HUSBOT_PROJECT,accessToken:token,nowMs:null,
  }),/clock/);
});

test('TASK-017 Norwegian deterministic intent and factual replies',async()=>{
  assert.equal(classifyMention('<@U123456789> ping'),'ping');
  assert.equal(classifyMention('<@U123456789> hva trenger vi å kjøpe?'),'shopping');
  assert.equal(classifyMention('<@U123456789> inventar'),'inventory');
  assert.equal(classifyMention('<@U123456789> do something else'),'help');
  assert.match(await createAnswer(job.text),/Husbot er på nett/);
  assert.equal(await createAnswer('<@U123456789> hva trenger vi å kjøpe?',{
    readInventory:async()=>snapshot}), '🛒 Må kjøpes (2):\n• Synthetic detergent — HANDLELISTE\n• Synthetic soap — KJØP');
  assert.match(await createAnswer('<@U123456789> inventar',{readInventory:async()=>snapshot}),/Synthetic tablets — OK/);
  assert.match(await createAnswer('hva trenger vi å kjøpe',{
    readInventory:async()=>({inventory:[snapshot.inventory[0]],
      shoppingAttention:[],shoppingList:[]})}),/Ingen varer på handlelisten/);
  assert.match(await createAnswer('inventar',{
    readInventory:async()=>({inventory:[],shoppingAttention:[]})}),/Ingen registrerte/);
  // Both sources support a positive result; neither is a required quorum.
  assert.equal(await createAnswer('hva trenger vi å kjøpe?',{
    readInventory:async ({includeShoppingList})=>{
      assert.equal(includeShoppingList,true);
      return {...snapshot,shoppingList:[{id:'shopping-same',name:' SYNTHETIC SOAP '}]};
    }}), '🛒 Må kjøpes (1):\n• SYNTHETIC SOAP — HANDLELISTE + KJØP');
  // A KJØP inventory item survives a delayed/failed Butler checklist addition.
  assert.equal(await createAnswer('shopping',{
    readInventory:async()=>({...snapshot,shoppingList:[]})}),
    '🛒 Må kjøpes (1):\n• Synthetic soap — KJØP');
  // Standalone manual checklist entries are shown with no inventory matches.
  assert.equal(await createAnswer('shopping',{
    readInventory:async()=>({inventory:[],shoppingAttention:[],
      shoppingList:[{id:'manual-1',name:'Synthetic flowers'}]})}),
    '🛒 Må kjøpes (1):\n• Synthetic flowers — HANDLELISTE');
  await assert.rejects(createAnswer('shopping',{
    readInventory:async()=>({inventory:[],shoppingAttention:[]})}),/snapshot invalid/);
  await assert.rejects(createAnswer('shopping',{
    readInventory:async()=>({inventory:[],shoppingAttention:[],
      shoppingList:[{id:'manual-1',name:'Malformed\nitem'}]})}),/ambiguous/);
  let inventoryArg;
  await createAnswer('inventar',{readInventory:async arg=>{
    inventoryArg=arg;return snapshot;
  }});
  assert.deepEqual(inventoryArg,{includeShoppingList:false});
  await assert.rejects(createAnswer('inventar',{
    readInventory:async()=>({inventory:snapshot.inventory,shoppingAttention:[]})}),/mismatch/);
  await assert.rejects(createAnswer('inventar',{
    readInventory:async()=>({inventory:[{id:'i',name:'malformed\nsecret',status:'ok'}],shoppingAttention:[]})}),/ambiguous/);
});

test('TASK-017 live sender is single-channel single-shot without automatic retry',async()=>{
  let sent=0,request;
  const make=(fetchImpl,enabled=true)=>createLiveSlackSender({
    enabled,botToken:env.HUSBOT_SLACK_BOT_TOKEN,
    approvedChannelId:env.HUSBOT_TEST_CHANNEL_ID,fetchImpl});
  assert.throws(()=>make(async()=>{},false),/not explicitly enabled/);
  const sender=make(async(url,init)=>{
    sent++; request={url,init};return {ok:true,json:async()=>({
      ok:true,channel:env.HUSBOT_TEST_CHANNEL_ID,ts:'1729000001.000123'})};
  });
  assert.equal(await sender({channelId:job.channelId,threadTs:job.threadTs},'Hei'), 'sent');
  assert.equal(request.init.method,'POST');
  assert.equal(JSON.parse(request.init.body).thread_ts,job.threadTs);
  assert.equal(JSON.parse(request.init.body).parse,'none');
  await assert.rejects(sender({channelId:'C999999999',threadTs:job.threadTs},'wrong'),/invalid/);
  assert.equal(sent,1);
  const failed=make(async()=>{sent++;throw Error('maybe sent')});
  await assert.rejects(failed({channelId:job.channelId,threadTs:job.threadTs},'Hei'),
    /outcome unknown/);
  assert.equal(sent,2);
});

test('TASK-017 worker rejects foreign channels, retries Trello before claim, dedups POST',async()=>{
  let claimed=0,sent=0,read=0;
  const make=(changes={})=>createTaskWorker({
    teamId:job.teamId,approvedChannelId:job.channelId,
    readInventory:async()=>{read++;return snapshot;},
    claim:async()=>{claimed++;return 'claimed';},
    postReply:async()=>{sent++;return 'sent';},...changes,
  });
  assert.deepEqual(await make()({...job,channelId:'C999999999'}),{status:403});
  assert.deepEqual(await make()({...job,other:'junk'}),{status:403});
  const w=make();assert.deepEqual(await w({...job,text:'hva trenger vi å kjøpe'}),{status:204});
  assert.equal(read,1);assert.equal(claimed,1);assert.equal(sent,1);
  assert.deepEqual(await make({claim:async()=>{claimed++;return 'duplicate'}})(job),{status:204});
  assert.equal(sent,1);
  assert.deepEqual(await make({readInventory:async()=>{throw Error('offline')}})(
    {...job,text:'inventar'}),{status:503});
  assert.equal(sent,1);
  assert.deepEqual(await make({postReply:async()=>{sent++;throw Error('ambiguous')}})(job),{status:503});
  assert.equal(sent,2);
});

test('TASK-017 cloud startup fails closed, worker SEND flag and credentials required',()=>{
  assert.throws(()=>createCloudServer({...env,HUSBOT_ROLE:'worker',HUSBOT_LIVE_SEND_ENABLED:'false'},async()=>{}),/enablement/);
  assert.throws(()=>createCloudServer({...env,HUSBOT_ROLE:'worker',TRELLO_READ_TOKEN:''},async()=>{}),/token/);
  assert.throws(()=>createCloudServer({...env,HUSBOT_ROLE:'not-worker'},async()=>{}),/role/);
  const ing=createCloudServer({...env,HUSBOT_ROLE:'ingress'},async()=>{throw Error('no network')});
  assert.equal(typeof ing.listen,'function');
  const work=createCloudServer({...env,HUSBOT_ROLE:'worker'},async()=>{throw Error('no network')});
  assert.equal(typeof work.listen,'function');
});

test('TASK-017 private worker HTTP accepts only bounded JSON POST (IAM is mandatory)',async()=>{
  const server=createTaskWorkerHttpServer({processTask:async j=>({
    status:j.eventId===job.eventId?204:403})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(root+'/internal/task',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(job)})).status,204);
    assert.equal((await fetch(root+'/internal/task',{method:'GET'})).status,405);
    assert.equal((await fetch(root+'/wrong',{method:'POST'})).status,404);
    assert.equal((await fetch(root+'/internal/task',{method:'POST',
      headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
    assert.equal((await fetch(root+'/internal/task',{method:'POST',
      headers:{'Content-Type':'application/json'},body:'not-json'})).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
