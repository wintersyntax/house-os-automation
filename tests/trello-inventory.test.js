import test from 'node:test';
import assert from 'node:assert/strict';
import { projectInventory, inventoryAttention, shoppingCardId, projectShoppingChecklist } from '../src/trello/inventory.js';
import { createReader } from '../src/trello/read-only.js';

const id = digit => digit.repeat(24);
const statusField = {
  id: id('a'), name: 'I · Status', type: 'list',
  options: [
    { id: id('b'), value: { text: 'OK' } },
    { id: id('c'), value: { text: 'LAV' } },
    { id: id('d'), value: { text: 'KJØP' } },
  ],
};
const list = { id: id('e'), name: '📦 INVENTAR' };
function card(i, optionId, extra={}) {
  return { id: id(i), idList: list.id, name: 'Synthetic item ' + i, closed:false,
    customFieldItems: [{idCustomField:statusField.id,idValue:optionId}], ...extra };
}
const raw=()=>({lists:[list,{id:id('f'),name:'🛒 HANDLELISTE'}],
  fields:[statusField],cards:[card('1',id('d')),card('2',id('b')),card('3',id('c'))]});

test('live board naming maps only KJØP without claiming other categories',()=>{
  const x=projectInventory(raw());
  assert.deepEqual(x.map(z=>z.status),['kjøp','ok','lav']);
  assert.deepEqual(inventoryAttention(x),[{id:id('1'),name:'Synthetic item 1'}]);
});
test('closed and non-inventory cards are excluded without mutations',()=>{
  const s=raw(),copy=structuredClone(s);
  s.cards.push(card('4',id('d'),{closed:true}));
  s.cards.push(card('5',id('d'),{idList:id('f')}));
  assert.equal(projectInventory(s).length,3);
  assert.deepEqual(s.cards.slice(0,3),copy.cards);
});
test('missing or ambiguous inventory schema fails closed',()=>{
  for(const edit of [
    s=>{s.lists=[]},s=>{s.lists.push({...list})},s=>{s.fields=[]},
    s=>{s.fields[0]={...statusField,type:'text'}},
    s=>{s.fields[0]={...statusField,options:statusField.options.slice(0,2)}},
    s=>{s.fields[0]={...statusField,options:[...statusField.options,{id:id('9'),value:{text:'OTHER'}}]}},
  ]){const s=raw();edit(s);assert.throws(()=>projectInventory(s))}
});
test('missing, unknown or repeated card values fail closed',()=>{
  for(const edit of [
    s=>{delete s.cards[0].customFieldItems},
    s=>{s.cards[0].customFieldItems=[]},
    s=>{s.cards[0].customFieldItems[0].idValue=id('9')},
    s=>{s.cards[0].customFieldItems.push({...s.cards[0].customFieldItems[0]})},
    s=>{s.cards.push({...s.cards[0]})},
  ]){const s=raw();edit(s);assert.throws(()=>projectInventory(s))}
});
test('only bounded GET requests; OAuth secrets stay out of URLs',async()=>{
  const s=raw(),requests=[];
  const fetchImpl=async(url,init)=>{
    requests.push({url:String(url),init});
    const path=new URL(url).pathname;
    return {ok:true,json:async()=>path.endsWith('/lists')?s.lists:path.endsWith('/customFields')?s.fields:s.cards};
  };
  const read=createReader({key:'synthetic_key_12345',token:'synthetic_token_12345',
    boardId:id('f'),fetchImpl});
  const result=await read();
  assert.equal(result.inventory.length,3);
  assert.equal(result.shoppingAttention.length,1);
  assert.equal(requests.length,3);
  assert.ok(requests.every(x=>x.init.method==='GET'&&
    x.init.redirect==='error'&&x.init.headers.Authorization.includes('synthetic_token_12345')&&
    !x.url.includes('synthetic_token_12345')&&!x.url.includes('synthetic_key_12345')&&
    x.url.startsWith('https://api.trello.com/1/boards/')));
  assert.ok(requests.find(x=>x.url.includes('/cards?')).url.includes('customFieldItems=true'));
});
test('HTTP errors, network failure and corrupt responses are RED without leaking secrets',async()=>{
  const config={key:'synthetic_key_12345',token:'synthetic_token_12345',boardId:id('f')};
  for(const fetchImpl of [
    async()=>({ok:false,status:401}),
    async()=>{throw new Error('synthetic_token_12345 SECRET')},
    async()=>({ok:true,json:async()=>{throw new Error('secret')}}),
  ]){
    await assert.rejects(createReader({...config,fetchImpl})(),e=>{
      assert.doesNotMatch(e.message,/SECRET|synthetic_token|secret/);return true;
    });
  }
  assert.throws(()=>createReader({...config,boardId:'bad'}),/board ID/);
  assert.throws(()=>createReader({...config,token:''}),/read token/);
});

test('TASK-019 manually added checklist items are read via one additional bounded GET',async()=>{
  const fixture=raw(),cardId=id('8'),listId=id('f');
  fixture.cards.push({id:cardId,idList:listId,name:'Neste handletur',closed:false});
  const checklist=[{id:id('9'),idCard:cardId,name:'Varer som skal kjøpes',checkItems:[
    {id:id('a'),name:'Synthetic flowers',state:'incomplete'},
    {id:id('b'),name:'Synthetic already bought',state:'complete'},
  ]}];
  const calls=[];
  const fetchImpl=async(url,init)=>{
    const u=new URL(url);calls.push({url:String(url),init});
    if(u.pathname.endsWith('/checklists')) return {ok:true,json:async()=>checklist};
    if(u.pathname.endsWith('/lists')) return {ok:true,json:async()=>fixture.lists};
    if(u.pathname.endsWith('/customFields')) return {ok:true,json:async()=>fixture.fields};
    if(u.pathname.endsWith('/cards')) return {ok:true,json:async()=>fixture.cards};
    throw Error('Unexpected mock Trello endpoint');
  };
  const reader=createReader({key:'synthetic_key_12345',token:'synthetic_token_12345',
    boardId:id('f'),fetchImpl});
  const inventoryOnly=await reader();
  assert.equal(inventoryOnly.shoppingList,undefined);
  assert.equal(calls.length,3);
  const output=await reader({includeShoppingList:true});
  assert.deepEqual(output.shoppingList,[{id:id('a'),name:'Synthetic flowers'}]);
  assert.equal(output.shoppingAttention.length,1);
  assert.equal(calls.length,7);
  assert.equal(calls[6].url,
    'https://api.trello.com/1/cards/'+cardId+'/checklists?checkItems=all');
  assert.ok(calls.every(x=>x.init.method==='GET'&&x.init.redirect==='error'&&
    !x.url.includes('synthetic_token')&&!x.url.includes('synthetic_key')));
  assert.deepEqual(shoppingCardId(fixture),cardId);
  assert.deepEqual(projectShoppingChecklist({...fixture,checklists:checklist}),
    [{id:id('a'),name:'Synthetic flowers'}]);
});

test('TASK-019 ambiguous shopping board/card/checklist fails closed',()=>{
  const fixture=raw(),cardId=id('8');
  const target={id:cardId,idList:id('f'),name:'Neste handletur',closed:false};
  fixture.cards.push(target);
  const checklist={id:id('9'),idCard:cardId,name:'Varer som skal kjøpes',
    checkItems:[{id:id('a'),name:'Synthetic flowers',state:'incomplete'}]};
  const clean=()=>({lists:structuredClone(fixture.lists),
    cards:structuredClone(fixture.cards),checklists:[structuredClone(checklist)]});
  assert.deepEqual(projectShoppingChecklist(clean()),[{id:id('a'),name:'Synthetic flowers'}]);
  for(const change of [
    d=>{d.lists=d.lists.filter(x=>x.name!=='🛒 HANDLELISTE')},
    d=>{d.lists.push({...d.lists[1]})},
    d=>{d.cards.push({...d.cards.at(-1),id:id('7')})},
    d=>{d.cards=d.cards.filter(x=>x.id!==cardId)},
    d=>{d.checklists=[]},
    d=>{d.checklists.push({...d.checklists[0]})},
    d=>{d.checklists[0].idCard=id('7')},
    d=>{d.checklists[0].checkItems=null},
    d=>{d.checklists[0].checkItems[0].state='unknown'},
    d=>{d.checklists[0].checkItems[0].name='Bad\nentry'},
    d=>{d.checklists[0].checkItems.push({...d.checklists[0].checkItems[0]})},
  ]){
    const x=clean();change(x);
    assert.throws(()=>projectShoppingChecklist(x));
  }
});
