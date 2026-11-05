/**
 * TASK-158 — expense and PANT rules (owner decisions 2026-11-04; design: docs/expenses-design.md), pure and import-free.
 *
 * Amounts are NOK with at most two decimals and are kept as integer øre. A purchase card in `🧾 UTGIFTER` is complete
 * when its creator is a resident, a receipt is uploaded, `U · Totalbeløp` is above 0, its members (the participants,
 * or all six without members) are residents and every attached PANT voucher is available and valid. The payer pays
 * total − pant; that amount is split equally among the participants. The monthly settlement is a proposal (OD-05 draft).
 */
export const EXPENSE_FIELDS=Object.freeze({total:'U · Totalbeløp',pant:'U · Pant brukt',paid:'U · Personlig betalt',voucherAmount:'P · Beløp',voucherStatus:'P · Status'});
export const VOUCHER_STATUSES=Object.freeze(['Tilgjengelig','Brukt']);
export const EXPENSE_OVERVIEW_CARD_NAME='Oversikt · Utgifter';
export const EXPENSE_PROBLEMS=Object.freeze(['CREATOR','RECEIPT','TOTAL','MEMBERS','VOUCHER_USED','VOUCHER_AMOUNT','PANT_TOO_HIGH']);
const MONTHS=['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
const ID=/^[a-f0-9]{24}$/;
const fail=what=>{throw Error('EXPENSE_RULE_INPUT_'+what);};
const id=(x,what)=>{if(typeof x!=='string'||!ID.test(x))fail(what);return x;};
const ore=x=>{if(!Number.isSafeInteger(x)||x<0)fail('ORE');return x;};

/** A Trello number field value (`"249.5"`) as øre, or null when it is not a NOK amount above 0 with at most two decimals. */
export function nokToOre(value){
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value))return null;
 const [whole,part='']=value.split('.');const o=Number(whole)*100+Number(part.padEnd(2,'0'));return o>0?o:null;
}
/** Øre as a Trello number field value (`24950` → `"249.5"`). */
export function oreToNumber(o){ore(o);const whole=Math.floor(o/100),part=o%100;return part===0?String(whole):whole+'.'+String(part).padStart(2,'0').replace(/0$/,'');}
/** Øre as Norwegian kroner, `1 234,50 kr`. */
export function formatNok(o){ore(o);const whole=String(Math.floor(o/100)).replace(/\B(?=(\d{3})+(?!\d))/g,' ');return whole+','+String(o%100).padStart(2,'0')+' kr';}
const signed=o=>{if(!Number.isSafeInteger(o))fail('ORE');return (o>0?'+':o<0?'−':'')+formatNok(Math.abs(o));};

function checkRoster(roster){
 if(!Array.isArray(roster)||roster.length!==6)fail('ROSTER');const seen=new Set();
 for(const r of roster){id(r?.memberId,'ROSTER');if(seen.has(r.memberId)||typeof r.name!=='string'||!/^[\p{L}][\p{L}\p{M}'-]{0,39}$/u.test(r.name))fail('ROSTER');seen.add(r.memberId);}
 return roster;
}

/**
 * @param {{purchaseCardId:string,creatorId:string|null,receipts:number,total:string|null,members:string[],
 *  vouchers:Array<{cardId:string,amount:string|null,status:string|null,usedBy:string|null}>,roster:Array<{memberId:string,name:string}>}} p
 *  `receipts`: uploaded image or PDF attachments; `vouchers`: the PANT cards attached to the purchase, with the purchase
 *  that already used each one (Husbot's record), if any.
 * @returns {{complete:boolean,problems:string[],totalOre:number|null,pantOre:number,paidOre:number|null,payer:string|null,participants:string[]}}
 */
export function evaluatePurchase(p){
 id(p?.purchaseCardId,'PURCHASE');const roster=checkRoster(p.roster),residents=new Set(roster.map(r=>r.memberId));
 if(!Number.isSafeInteger(p.receipts)||p.receipts<0||!Array.isArray(p.members)||!Array.isArray(p.vouchers))fail('SHAPE');
 const problems=[];
 const payer=typeof p.creatorId==='string'&&residents.has(p.creatorId)?p.creatorId:null;if(!payer)problems.push('CREATOR');
 if(p.receipts<1)problems.push('RECEIPT');
 const totalOre=p.total===null?null:nokToOre(p.total);if(totalOre===null)problems.push('TOTAL');
 const members=[...new Set(p.members)];if(members.some(m=>!residents.has(m)))problems.push('MEMBERS');
 let pantOre=0;const vouchers=new Set();
 for(const v of p.vouchers){id(v?.cardId,'VOUCHER');if(vouchers.has(v.cardId))fail('VOUCHER');vouchers.add(v.cardId);
  if(v.usedBy!==null&&v.usedBy!==p.purchaseCardId||v.usedBy===null&&v.status!=='Tilgjengelig'){problems.push('VOUCHER_USED');continue;}
  const a=v.amount===null?null:nokToOre(v.amount);if(a===null){problems.push('VOUCHER_AMOUNT');continue;}pantOre+=a;}
 if(totalOre!==null&&pantOre>totalOre)problems.push('PANT_TOO_HIGH');
 const unique=[...new Set(problems)].sort((a,b)=>EXPENSE_PROBLEMS.indexOf(a)-EXPENSE_PROBLEMS.indexOf(b));
 const participants=roster.map(r=>r.memberId).filter(m=>members.length?members.includes(m):true);
 return {complete:unique.length===0,problems:unique,totalOre,pantOre,paidOre:unique.length?null:totalOre-pantOre,payer,participants};
}

const PROBLEM_TEXT={
 CREATOR:'kortet må være laget av en beboer (den som betalte)',
 RECEIPT:'legg ved et bilde eller en PDF av kvitteringen',
 TOTAL:'fyll inn **U · Totalbeløp** (felles del, i kr, f.eks. 249.50)',
 MEMBERS:'bare beboere kan være medlemmer (medlemmene deler kjøpet)',
 VOUCHER_USED:'en vedlagt pantelapp er allerede brukt',
 VOUCHER_AMOUNT:'en vedlagt pantelapp mangler **P · Beløp**',
 PANT_TOO_HIGH:'panten er større enn totalbeløpet',
};
/** Husbot's one comment for a purchase that is not complete yet. */
export function problemComment(problems){
 if(!Array.isArray(problems)||!problems.length||problems.some(p=>!Object.hasOwn(PROBLEM_TEXT,p)))fail('PROBLEMS');
 return ['🧾 **Kjøpet er ikke registrert ennå**',...problems.map(p=>'- '+PROBLEM_TEXT[p])].join('\n');
}
/**
 * TASK-161 — Husbot's question on a complete purchase without pant while vouchers are on the wall.
 * @param {{count:number,ore:number,deadline:string}} q available vouchers on the wall, their sum, and the Oslo time (`HH:MM`)
 *  after which the purchase is registered without pant.
 */
export function pantQuestionComment({count,ore:sum,deadline}){
 if(!Number.isSafeInteger(count)||count<1||typeof deadline!=='string'||!/^[0-2]\d:[0-5]\d$/.test(deadline))fail('QUESTION');ore(sum);
 return '⏳ **Brukte du pant?** Det ligger '+count+' '+(count===1?'pantelapp':'pantelapper')+' · '+formatNok(sum)+' på veggen. '
  +'Legg ved pantelappen på dette kortet (Vedlegg → Trello-kort), ellers registrerer jeg kjøpet uten pant kl. '+deadline+'.';
}
/** Husbot's one comment for a registered purchase. */
export function registeredComment({paidOre,pantOre,payerName,participants}){
 ore(paidOre);ore(pantOre);if(typeof payerName!=='string'||!payerName||!Number.isSafeInteger(participants)||participants<1||participants>6)fail('COMMENT');
 return '✅ **Registrert** · '+formatNok(paidOre)+' betalt av '+payerName+(pantOre?' (pant '+formatNok(pantOre)+')':'')+' · deles på '+participants;
}

/**
 * The month's settlement proposal.
 * @param {{roster:Array<{memberId:string,name:string}>,purchases:Array<{payer:string,paidOre:number,participants:string[]}>}} input
 * @returns {{count:number,totalOre:number,rows:Array<{memberId:string,name:string,paidOre:number,shareOre:number,netOre:number}>,transfers:Array<{from:string,to:string,ore:number}>}}
 */
export function settleMonth({roster,purchases}){
 checkRoster(roster);if(!Array.isArray(purchases))fail('SHAPE');const order=roster.map(r=>r.memberId);
 const paid=new Map(order.map(m=>[m,0])),share=new Map(order.map(m=>[m,0]));let total=0;
 for(const p of purchases){
  if(!paid.has(p?.payer)||!Array.isArray(p.participants)||!p.participants.length||p.participants.some(m=>!paid.has(m))||new Set(p.participants).size!==p.participants.length)fail('PURCHASE');
  ore(p.paidOre);total+=p.paidOre;paid.set(p.payer,paid.get(p.payer)+p.paidOre);
  const people=order.filter(m=>p.participants.includes(m)),each=Math.floor(p.paidOre/people.length);let rest=p.paidOre-each*people.length;
  for(const m of people){share.set(m,share.get(m)+each+(rest>0?1:0));if(rest>0)rest--;}
 }
 const rows=roster.map(r=>({memberId:r.memberId,name:r.name,paidOre:paid.get(r.memberId),shareOre:share.get(r.memberId),netOre:paid.get(r.memberId)-share.get(r.memberId)}));
 const owe=rows.filter(r=>r.netOre<0).map(r=>({m:r.memberId,o:-r.netOre})),get=rows.filter(r=>r.netOre>0).map(r=>({m:r.memberId,o:r.netOre}));
 const byLargest=(a,b)=>b.o-a.o||order.indexOf(a.m)-order.indexOf(b.m),transfers=[];
 while(owe.length&&get.length){owe.sort(byLargest);get.sort(byLargest);const a=owe[0],b=get[0],o=Math.min(a.o,b.o);
  transfers.push({from:a.m,to:b.m,ore:o});a.o-=o;b.o-=o;if(!a.o)owe.shift();if(!b.o)get.shift();}
 return {count:purchases.length,totalOre:total,rows,transfers};
}

const monthName=month=>{if(typeof month!=='string'||!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))fail('MONTH');const n=MONTHS[Number(month.slice(5))-1];return n[0].toUpperCase()+n.slice(1)+' '+month.slice(0,4);};
const RULE='---';
const FOOTER='_Oppgjøret er et forslag: lik deling av det som ble betalt (uten pant) på alle seks, eller på kortets medlemmer. Betal med Vipps. Kortet oppdateres automatisk. Ikke rediger kortet._';
/**
 * The overview card text.
 * @param {{updated:string,previous:{month:string}&ReturnType<typeof settleMonth>,current:{month:string}&ReturnType<typeof settleMonth>,pant:{count:number,ore:number}}} v
 */
export function renderExpenseOverview({updated,previous,current,pant}){
 if(typeof updated!=='string'||!/^\d\d\.\d\d\.20\d\d kl\. [0-2]\d:[0-5]\d$/.test(updated))fail('UPDATED');
 if(!Number.isSafeInteger(pant?.count)||pant.count<0)fail('PANT');ore(pant.ore);
 const nameOf=(s,m)=>s.rows.find(r=>r.memberId===m).name;
 const lines=['**💰 Utgifter · oversikt**','Sist oppdatert: '+updated,'',RULE,'',
  '**Oppgjør for '+monthName(previous.month).toLowerCase()+'** (forslag)'];
 if(!previous.count)lines.push('Ingen kjøp.');
 else if(!previous.transfers.length)lines.push('Alle er i balanse.');
 else lines.push(...previous.transfers.map(t=>'- '+nameOf(previous,t.from)+' → '+nameOf(previous,t.to)+': **'+formatNok(t.ore)+'**'));
 lines.push('',RULE,'','**'+monthName(current.month)+' så langt** · '+formatNok(current.totalOre)+' · '+current.count+' kjøp');
 if(current.count)lines.push(...current.rows.map(r=>'- '+r.name+': betalt '+formatNok(r.paidOre)+' · andel '+formatNok(r.shareOre)+' · **'+signed(r.netOre)+'**'));
 lines.push('',RULE,'','**Pant på veggen:** '+(pant.count?pant.count+' '+(pant.count===1?'lapp':'lapper')+' · '+formatNok(pant.ore):'ingen'),'',RULE,'',FOOTER);
 return lines.join('\n');
}
