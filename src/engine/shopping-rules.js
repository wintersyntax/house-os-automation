/**
 * TASK-155 — the shopping list rules (owner decisions 2026-11-03), pure and import-free.
 *
 * - Each item has one card in `📦 INVENTAR` with `I · Status` OK / LAV / KJØP. Only KJØP is a need; LAV is a warning.
 * - One permanent card `🛒 Neste handletur` holds the checklist `Varer som skal kjøpes`. Husbot is its only automatic
 *   writer (the Butler KJØP rule is switched off).
 * - A need gets one item, `[Name](card link)`, linked by Husbot's own record (never by a name match).
 * - A tick means "bought and at home": a linked item whose card is still KJØP sets the card to OK, then the item is
 *   removed; a ticked manual item (no link) is just removed.
 * - A need that ends without a tick (the card set to OK/LAV by hand, archived or moved out) removes its open item.
 * - An item a resident deletes is not added again for the same need; the card's next KJØP is a new need.
 *
 * `planShopping` compares the board with Husbot's link records and returns the effects to carry out, in order:
 * removals and restocks first (they settle existing items), then additions.
 */
export const SHOPPING_CARD_NAME='🛒 Neste handletur';
export const SHOPPING_CHECKLIST_NAME='Varer som skal kjøpes';
export const SHOPPING_STATUS_FIELD='I · Status';
export const SHOPPING_STATUSES=Object.freeze(['OK','LAV','KJØP']);
/** Item names are short; the checklist item also carries the card link. */
export const SHOPPING_MAX_NAME=100;
const ID=/^[a-f0-9]{24}$/;
const SHORT_URL=/^https:\/\/trello\.com\/c\/[A-Za-z0-9]{8}$/;
const fail=what=>{throw Error('SHOPPING_RULE_INPUT_'+what);};
const exact=(x,keys,what)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==keys.length||!keys.every(k=>Object.hasOwn(x,k)))fail(what);return x;};
const id=(x,what)=>{if(typeof x!=='string'||!ID.test(x))fail(what);return x;};

/** The card's name as it appears on the list: trimmed, one line, without the characters that would break the link. */
export function shoppingName(name){
 if(typeof name!=='string')fail('NAME');const n=name.replace(/[\[\]()]/g,'').replace(/\s+/g,' ').trim();
 if(!n||n.length>SHOPPING_MAX_NAME||/[\u0000-\u001f<>]/.test(n))fail('NAME');return n;
}
/** The checklist item text Husbot writes for an inventory card. */
export function shoppingItemText({name,url}){if(typeof url!=='string'||!SHORT_URL.test(url))fail('URL');return '['+shoppingName(name)+']('+url+')';}

/**
 * @param {{inventory:Array<{cardId:string,name:string,url:string,status:'OK'|'LAV'|'KJØP'|null,inList:boolean}>,
 *  items:Array<{id:string,text:string,complete:boolean}>,
 *  links:Array<{cardId:string,checkItemId:string|null,state:'OPEN'|'DISMISSED'}>}} input
 *  `inventory`: the cards Husbot knows of (open cards in INVENTAR, plus any linked card, with `inList:false` once it is
 *  archived or moved); `items`: the checklist now; `links`: Husbot's records, one per card at most.
 * @returns {Array<{kind:'RESTOCK',cardId:string,checkItemId:string}|{kind:'REMOVE',checkItemId:string,reason:'MANUAL_DONE'|'DONE_NOT_NEEDED'|'NOT_NEEDED',cardId:string|null}
 *  |{kind:'DISMISS',cardId:string}|{kind:'FORGET',cardId:string}|{kind:'ADD',cardId:string,text:string}>}
 */
export function planShopping(input){
 exact(input,['inventory','items','links'],'SHAPE');
 if(![input.inventory,input.items,input.links].every(Array.isArray))fail('SHAPE');
 const cards=new Map();
 for(const c of input.inventory){exact(c,['cardId','name','url','status','inList'],'CARD');id(c.cardId,'CARD');if(cards.has(c.cardId))fail('CARD');
  if(c.status!==null&&!SHOPPING_STATUSES.includes(c.status)||typeof c.inList!=='boolean')fail('CARD');cards.set(c.cardId,c);}
 const items=new Map();
 for(const i of input.items){exact(i,['id','text','complete'],'ITEM');id(i.id,'ITEM');if(items.has(i.id)||typeof i.text!=='string'||typeof i.complete!=='boolean')fail('ITEM');items.set(i.id,i);}
 const links=new Map(),linkedItems=new Set();
 for(const l of input.links){exact(l,['cardId','checkItemId','state'],'LINK');id(l.cardId,'LINK');if(links.has(l.cardId)||!cards.has(l.cardId))fail('LINK');
  if(l.state==='OPEN'){id(l.checkItemId,'LINK');if(linkedItems.has(l.checkItemId))fail('LINK');linkedItems.add(l.checkItemId);}
  else if(l.state!=='DISMISSED'||l.checkItemId!==null)fail('LINK');links.set(l.cardId,l);}

 const needed=c=>c.inList&&c.status==='KJØP';
 const settle=[],add=[];
 for(const [cardId,l] of links){
  const c=cards.get(cardId);
  if(l.state==='DISMISSED'){if(!needed(c))settle.push({kind:'FORGET',cardId});continue;}
  const item=items.get(l.checkItemId);
  if(!item){settle.push(needed(c)?{kind:'DISMISS',cardId}:{kind:'FORGET',cardId});continue;}
  if(item.complete)settle.push(needed(c)?{kind:'RESTOCK',cardId,checkItemId:item.id}:{kind:'REMOVE',checkItemId:item.id,reason:'DONE_NOT_NEEDED',cardId});
  else if(!needed(c))settle.push({kind:'REMOVE',checkItemId:item.id,reason:'NOT_NEEDED',cardId});
 }
 for(const item of items.values())if(item.complete&&!linkedItems.has(item.id))settle.push({kind:'REMOVE',checkItemId:item.id,reason:'MANUAL_DONE',cardId:null});
 for(const c of cards.values())if(needed(c)&&!links.has(c.cardId))add.push({kind:'ADD',cardId:c.cardId,text:shoppingItemText(c)});
 return [...settle,...add];
}
