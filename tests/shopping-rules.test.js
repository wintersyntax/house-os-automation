import test from 'node:test';
import assert from 'node:assert/strict';
import {planShopping,shoppingItemText,shoppingName,SHOPPING_STATUSES} from '../src/engine/shopping-rules.js';

// TASK-155: fictional cards and identities only.
const hex=n=>n.toString(16).padStart(24,'0');
const card=(n,status,extra={})=>({cardId:hex(n),name:'Vare '+n,url:'https://trello.com/c/Abcd'+String(n).padStart(4,'0'),status,inList:true,...extra});
const item=(n,complete=false,text='x')=>({id:hex(1000+n),text,complete});
const open=(n,i)=>({cardId:hex(n),checkItemId:hex(1000+i),state:'OPEN'});
const dismissed=n=>({cardId:hex(n),checkItemId:null,state:'DISMISSED'});
const plan=(inventory,items=[],links=[])=>planShopping({inventory,items,links});

test('TASK-155 only KJØP adds an item, once, as a link to the card; LAV and OK add nothing',()=>{
 assert.deepEqual(SHOPPING_STATUSES,['OK','LAV','KJØP']);
 assert.deepEqual(plan([card(1,'KJØP'),card(2,'LAV'),card(3,'OK'),card(4,null)]),[{kind:'ADD',cardId:hex(1),text:'[Vare 1](https://trello.com/c/Abcd0001)'}]);
 assert.deepEqual(plan([card(1,'KJØP')],[item(1)],[open(1,1)]),[],'an open linked item is enough');
 assert.deepEqual(plan([card(1,'KJØP',{inList:false})]),[],'an archived or moved card is not a need');
 assert.deepEqual(plan([card(1,'KJØP')],[item(9,false,'[Vare 1](https://trello.com/c/Abcd0001)')]).map(e=>e.kind),['ADD'],'a manual item with the same text is not a link');
});

test('TASK-155 a ticked linked item restocks a card that is still KJØP; otherwise it is only removed',()=>{
 assert.deepEqual(plan([card(1,'KJØP')],[item(1,true)],[open(1,1)]),[{kind:'RESTOCK',cardId:hex(1),checkItemId:hex(1001)}]);
 for(const c of [card(1,'OK'),card(1,'LAV'),card(1,'KJØP',{inList:false})])
  assert.deepEqual(plan([c],[item(1,true)],[open(1,1)]),[{kind:'REMOVE',checkItemId:hex(1001),reason:'DONE_NOT_NEEDED',cardId:hex(1)}]);
 assert.deepEqual(plan([],[item(5,true),item(6)]),[{kind:'REMOVE',checkItemId:hex(1005),reason:'MANUAL_DONE',cardId:null}],'a ticked manual item is removed, an open one stays');
});

test('TASK-155 a need that ends without a tick removes its item; a deleted item is not added again for the same need',()=>{
 for(const c of [card(1,'OK'),card(1,'LAV'),card(1,null),card(1,'KJØP',{inList:false})])
  assert.deepEqual(plan([c],[item(1)],[open(1,1)]),[{kind:'REMOVE',checkItemId:hex(1001),reason:'NOT_NEEDED',cardId:hex(1)}]);
 assert.deepEqual(plan([card(1,'KJØP')],[],[open(1,1)]),[{kind:'DISMISS',cardId:hex(1)}],'deleted by a resident while still needed');
 assert.deepEqual(plan([card(1,'KJØP')],[],[dismissed(1)]),[],'no new item for the dismissed need');
 assert.deepEqual(plan([card(1,'OK')],[],[dismissed(1)]),[{kind:'FORGET',cardId:hex(1)}],'the need ended');
 assert.deepEqual(plan([card(1,'OK')],[],[open(1,1)]),[{kind:'FORGET',cardId:hex(1)}],'item gone and need ended');
 assert.deepEqual(plan([card(1,'KJØP')]).map(e=>e.kind),['ADD'],'after FORGET the next KJØP is a new need');
});

test('TASK-155 settling effects come before additions, in a stable order',()=>{
 const inventory=[card(1,'KJØP'),card(2,'KJØP'),card(3,'OK'),card(4,'KJØP')];
 const effects=plan(inventory,[item(2,true),item(3),item(7,true)],[open(2,2),open(3,3)]);
 assert.deepEqual(effects.map(e=>e.kind+':'+(e.cardId??e.checkItemId).slice(-4)),['RESTOCK:0002','REMOVE:0003','REMOVE:03ef','ADD:0001','ADD:0004']);
});

test('TASK-155 names are one short line without link characters; malformed input is refused',()=>{
 assert.equal(shoppingName('  Oppvask[tabletter] (store)\n '),'Oppvasktabletter store');
 assert.equal(shoppingItemText({name:'Dopapir',url:'https://trello.com/c/AbCd1234'}),'[Dopapir](https://trello.com/c/AbCd1234)');
 for(const bad of ['','  ','()','x'.repeat(101),'a<b',7])assert.throws(()=>shoppingName(bad),/SHOPPING_RULE_INPUT_NAME/);
 for(const url of ['http://trello.com/c/AbCd1234','https://trello.com/c/AbCd12345','https://evil.example/c/AbCd1234'])assert.throws(()=>shoppingItemText({name:'x',url}),/SHOPPING_RULE_INPUT_URL/);
 const bad=[
  {inventory:[],items:[]},
  {inventory:[card(1,'KJØP'),card(1,'OK')],items:[],links:[]},
  {inventory:[card(1,'Kjøp')],items:[],links:[]},
  {inventory:[{...card(1,'OK'),extra:1}],items:[],links:[]},
  {inventory:[],items:[item(1),item(1)],links:[]},
  {inventory:[],items:[],links:[open(1,1)]},
  {inventory:[card(1,'KJØP'),card(2,'KJØP')],items:[item(1)],links:[open(1,1),open(2,1)]},
  {inventory:[card(1,'KJØP')],items:[],links:[open(1,1),dismissed(1)]},
  {inventory:[card(1,'KJØP')],items:[],links:[{cardId:hex(1),checkItemId:hex(1001),state:'DISMISSED'}]},
  {inventory:[card(1,'KJØP')],items:[],links:[{cardId:hex(1),checkItemId:hex(1001),state:'DONE'}]},
 ];
 for(const x of bad)assert.throws(()=>planShopping(x),/SHOPPING_RULE_INPUT/);
});
