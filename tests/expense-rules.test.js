import test from 'node:test';
import assert from 'node:assert/strict';
import {nokToOre,oreToNumber,formatNok,evaluatePurchase,problemComment,pantQuestionComment,registeredComment,settleMonth,renderExpenseOverview,EXPENSE_PROBLEMS} from '../src/engine/expense-rules.js';

// TASK-158: fictional residents and identities only.
const hex=n=>n.toString(16).padStart(24,'0');
const NAMES=['Ida','Emil','Nora','Sara','Erik','Mina'];
const roster=NAMES.map((name,i)=>({memberId:hex(10+i),name}));
const M=i=>roster[i].memberId,P=hex(100);
const purchase=(extra={})=>({purchaseCardId:P,creatorId:M(0),receipts:1,total:'249.5',members:[],vouchers:[],roster,...extra});
const voucher=(n,amount,status='Tilgjengelig',usedBy=null)=>({cardId:hex(200+n),amount,status,usedBy});

test('TASK-158 amounts are NOK with at most two decimals, kept as øre',()=>{
 assert.deepEqual(['249.5','249.50','1000','0.01','1234567.89'].map(nokToOre),[24950,24950,100000,1,123456789]);
 for(const bad of ['0','0.00','-5','1.234','1,5','01','12345678',' 5',null,5])assert.equal(nokToOre(bad),null);
 assert.deepEqual([24950,24905,100000,1].map(oreToNumber),['249.5','249.05','1000','0.01']);
 assert.equal(formatNok(123450),'1 234,50 kr');assert.equal(formatNok(5),'0,05 kr');assert.equal(formatNok(123456789),'1 234 567,89 kr');
});

test('TASK-158 a complete purchase: the creator paid total − pant, shared by all six or by the members',()=>{
 assert.deepEqual(evaluatePurchase(purchase()),{complete:true,problems:[],totalOre:24950,pantOre:0,paidOre:24950,payer:M(0),participants:roster.map(r=>r.memberId)});
 const r=evaluatePurchase(purchase({vouchers:[voucher(1,'30'),voucher(2,'12.5')],members:[M(3),M(0),M(3)]}));
 assert.deepEqual([r.complete,r.pantOre,r.paidOre,r.participants],[true,4250,20700,[M(0),M(3)]]);
 assert.equal(evaluatePurchase(purchase({vouchers:[voucher(1,'30','Brukt',P)]})).complete,true,'a voucher this purchase already used still counts');
});

test('TASK-158 an incomplete purchase names every problem, in a fixed order, and pays nothing yet',()=>{
 const r=evaluatePurchase(purchase({creatorId:hex(99),receipts:0,total:null,members:[hex(98)],vouchers:[voucher(1,'10','Brukt',hex(101)),voucher(2,null),voucher(3,'5','Brukt')]}));
 assert.deepEqual(r.problems,['CREATOR','RECEIPT','TOTAL','MEMBERS','VOUCHER_USED','VOUCHER_AMOUNT']);assert.equal(r.paidOre,null);assert.equal(r.complete,false);
 assert.deepEqual(evaluatePurchase(purchase({total:'20',vouchers:[voucher(1,'25')]})).problems,['PANT_TOO_HIGH']);
 assert.deepEqual(EXPENSE_PROBLEMS,['CREATOR','RECEIPT','TOTAL','MEMBERS','VOUCHER_USED','VOUCHER_AMOUNT','PANT_TOO_HIGH']);
 assert.equal(problemComment(['RECEIPT','TOTAL']),'🧾 **Kjøpet er ikke registrert ennå**\n- legg ved et bilde eller en PDF av kvitteringen\n- fyll inn **U · Totalbeløp** (felles del, i kr, f.eks. 249.50)');
 assert.equal(registeredComment({paidOre:20700,pantOre:4250,payerName:'Ida',participants:2}),'✅ **Registrert** · 207,00 kr betalt av Ida (pant 42,50 kr) · deles på 2');
 assert.equal(registeredComment({paidOre:24950,pantOre:0,payerName:'Ida',participants:6}),'✅ **Registrert** · 249,50 kr betalt av Ida · deles på 6');
 for(const bad of [[],['OTHER']])assert.throws(()=>problemComment(bad),/EXPENSE_RULE_INPUT/);
 for(const bad of [{...purchase(),purchaseCardId:'x'},{...purchase(),roster:roster.slice(1)},{...purchase(),receipts:-1},{...purchase(),vouchers:[voucher(1,'1'),voucher(1,'2')]}])assert.throws(()=>evaluatePurchase(bad),/EXPENSE_RULE_INPUT/);
});

test('TASK-158 the monthly settlement: equal shares with leftover øre in roster order, and the fewest transfers',()=>{
 const s=settleMonth({roster,purchases:[
  {payer:M(0),paidOre:60000,participants:roster.map(r=>r.memberId)},
  {payer:M(1),paidOre:10001,participants:[M(1),M(2),M(4)]},
  {payer:M(0),paidOre:5,participants:roster.map(r=>r.memberId)},
 ]});
 assert.equal(s.count,3);assert.equal(s.totalOre,70006);
 assert.deepEqual(s.rows.map(r=>[r.name,r.paidOre,r.shareOre,r.netOre]),[
  ['Ida',60005,10001,50004],['Emil',10001,13335,-3334],['Nora',0,13335,-13335],['Sara',0,10001,-10001],['Erik',0,13334,-13334],['Mina',0,10000,-10000]]);
 assert.equal(s.rows.reduce((n,r)=>n+r.netOre,0),0,'shares add up to what was paid');
 assert.deepEqual(s.transfers.map(t=>[NAMES[roster.findIndex(r=>r.memberId===t.from)],NAMES[roster.findIndex(r=>r.memberId===t.to)],t.ore]),
  [['Nora','Ida',13335],['Erik','Ida',13334],['Sara','Ida',10001],['Mina','Ida',10000],['Emil','Ida',3334]]);
 assert.deepEqual(settleMonth({roster,purchases:[]}),{count:0,totalOre:0,rows:roster.map(r=>({memberId:r.memberId,name:r.name,paidOre:0,shareOre:0,netOre:0})),transfers:[]});
 for(const bad of [{payer:hex(99),paidOre:1,participants:[M(0)]},{payer:M(0),paidOre:-1,participants:[M(0)]},{payer:M(0),paidOre:1,participants:[]},{payer:M(0),paidOre:1,participants:[M(0),M(0)]}])
  assert.throws(()=>settleMonth({roster,purchases:[bad]}),/EXPENSE_RULE_INPUT/);
});

test('TASK-158 the overview card: last month\'s proposal, this month so far, and the pant on the wall',()=>{
 const previous={month:'2026-10',...settleMonth({roster,purchases:[{payer:M(0),paidOre:60000,participants:roster.map(r=>r.memberId)}]})};
 const current={month:'2026-11',...settleMonth({roster,purchases:[{payer:M(1),paidOre:24950,participants:[M(1),M(2)]}]})};
 const text=renderExpenseOverview({updated:'04.11.2026 kl. 01:10',previous,current,pant:{count:3,ore:7500}});
 assert.equal(text,[
  '**💰 Utgifter · oversikt**','Sist oppdatert: 04.11.2026 kl. 01:10','','---','',
  '**Oppgjør for oktober 2026** (forslag)','- Emil → Ida: **100,00 kr**','- Nora → Ida: **100,00 kr**','- Sara → Ida: **100,00 kr**','- Erik → Ida: **100,00 kr**','- Mina → Ida: **100,00 kr**',
  '','---','','**November 2026 så langt** · 249,50 kr · 1 kjøp',
  '- Ida: betalt 0,00 kr · andel 0,00 kr · **0,00 kr**','- Emil: betalt 249,50 kr · andel 124,75 kr · **+124,75 kr**','- Nora: betalt 0,00 kr · andel 124,75 kr · **−124,75 kr**',
  '- Sara: betalt 0,00 kr · andel 0,00 kr · **0,00 kr**','- Erik: betalt 0,00 kr · andel 0,00 kr · **0,00 kr**','- Mina: betalt 0,00 kr · andel 0,00 kr · **0,00 kr**',
  '','---','','**Pant på veggen:** 3 lapper · 75,00 kr','','---','',
  '_Oppgjøret er et forslag: lik deling av det som ble betalt (uten pant) på alle seks, eller på kortets medlemmer. Betal med Vipps. Kortet oppdateres automatisk. Ikke rediger kortet._'].join('\n'));
 const empty=renderExpenseOverview({updated:'04.11.2026 kl. 01:10',previous:{month:'2026-10',...settleMonth({roster,purchases:[]})},current:{month:'2026-11',...settleMonth({roster,purchases:[]})},pant:{count:0,ore:0}});
 assert.ok(empty.includes('**Oppgjør for oktober 2026** (forslag)\nIngen kjøp.'));assert.ok(empty.includes('**November 2026 så langt** · 0,00 kr · 0 kjøp\n\n---'));assert.ok(empty.includes('**Pant på veggen:** ingen'));
 const balanced={month:'2026-10',...settleMonth({roster,purchases:[{payer:M(0),paidOre:100,participants:[M(0)]}]})};
 assert.ok(renderExpenseOverview({updated:'04.11.2026 kl. 01:10',previous:balanced,current,pant:{count:1,ore:2500}}).includes('Alle er i balanse.\n')&&true);
 assert.ok(renderExpenseOverview({updated:'04.11.2026 kl. 01:10',previous,current,pant:{count:1,ore:2500}}).includes('1 lapp · 25,00 kr'));
 for(const bad of [{updated:'i dag'},{previous:{...previous,month:'2026-13'}},{pant:{count:-1,ore:0}}])
  assert.throws(()=>renderExpenseOverview({updated:'04.11.2026 kl. 01:10',previous,current,pant:{count:0,ore:0},...bad}),/EXPENSE_RULE_INPUT/);
});

test('TASK-161 the pant question names the wall and the deadline; malformed input is refused',()=>{
 assert.equal(pantQuestionComment({count:1,ore:2000,deadline:'11:52'}),'⏳ **Brukte du pant?** Det ligger 1 pantelapp · 20,00 kr på veggen. Legg ved pantelappen på dette kortet (Vedlegg → Trello-kort), ellers registrerer jeg kjøpet uten pant kl. 11:52.');
 assert.ok(pantQuestionComment({count:3,ore:4550,deadline:'09:05'}).includes('3 pantelapper · 45,50 kr'));
 for(const bad of [{count:0,ore:0,deadline:'11:52'},{count:1,ore:-1,deadline:'11:52'},{count:1,ore:100,deadline:'1152'},{count:1.5,ore:100,deadline:'11:52'},{}])assert.throws(()=>pantQuestionComment(bad),/EXPENSE_RULE_INPUT_/);
});
