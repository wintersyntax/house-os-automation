import test from 'node:test';
import assert from 'node:assert/strict';
import {planCleaningCycle} from '../src/engine/cleaning-parity.js';
import {roomsToHandOver} from '../src/engine/cleaning-handover-rules.js';

// internal milestone: fictional residents r1–r6 and fictional card/member identities only.
const people=(over={})=>['r1','r2','r3','r4','r5','r6'].map((id,i)=>({id,status:'Aktiv',points:10,credits:0,skipped:0,openPoints:0,openRooms:0,...(over[id]??{})}));
const cycle=extra=>({cardId:'card-1',zone:'Kjøkken',completionDate:'2026-11-05',completedById:'r2',stage:'unseen',isCompletedCard:false,previousAssignmentMode:'Normal',handover:true,residents:people({r2:{status:'Borte'}}),...extra});
const hex=n=>n.toString(16).padStart(24,'0');

test('internal milestone a handover goes to the next resident: no points for the away holder, a Borte credit, a full new period',()=>{
 const p=planCleaningCycle(cycle());
 assert.equal(p.kind,'PROPOSE_CYCLE');assert.equal(p.handover,true);
 assert.deepEqual([p.selectedResidentId,p.normalSuccessorId,p.allocation],['r3','r3','Normal']);
 assert.deepEqual(p.completionPoints,{residentId:'r2',delta:0});
 assert.deepEqual(p.skippedCreditDeltas,[{residentId:'r2',creditDelta:1,skippedDelta:1}]);
 assert.deepEqual([p.startDate,p.dueDate],['2026-11-10','2026-11-12'],'Kjøkken: a full seven-day period from the handover day');
 const g=planCleaningCycle(cycle({zone:'Gang'}));assert.equal(g.dueDate,'2026-11-26');
});

test('internal milestone the ordinary rotation rules apply: further Borte residents are skipped, the cap and the balance correction',()=>{
 const p=planCleaningCycle(cycle({residents:people({r2:{status:'Borte'},r3:{status:'Borte'}})}));
 assert.equal(p.selectedResidentId,'r4');assert.deepEqual(p.skippedCreditDeltas.map(d=>d.residentId),['r2','r3'],'the holder first, then the next away resident');
 const capped=planCleaningCycle(cycle({residents:people({r2:{status:'Borte'},r3:{openRooms:2}})}));assert.equal(capped.selectedResidentId,'r4');
 const gap=planCleaningCycle(cycle({residents:people({r2:{status:'Borte'},r1:{points:20},r5:{points:2}})}));
 assert.deepEqual([gap.selectedResidentId,gap.allocation,gap.pointGapAfterBooking],['r5','Balansekorrigert',18],'the gap reads booked points, the holder adds nothing');
 const repeat=planCleaningCycle(cycle({previousAssignmentMode:'Balansekorrigert',residents:people({r2:{status:'Borte'},r1:{points:20},r5:{points:2}})}));
 assert.deepEqual([repeat.selectedResidentId,repeat.allocation],['r3','Normal'],'no two corrections in a row');
});

test('internal milestone a handover is refused for an active holder, a completed card, everyone away and a malformed flag; ordinary cycles are unchanged',()=>{
 assert.deepEqual(planCleaningCycle(cycle({residents:people()})).reason,'HANDOVER_HOLDER_NOT_AWAY');
 assert.deepEqual(planCleaningCycle(cycle({isCompletedCard:true})).reason,'HANDOVER_CARD_ALREADY_COMPLETED');
 assert.deepEqual(planCleaningCycle(cycle({residents:people(Object.fromEntries(['r1','r2','r3','r4','r5','r6'].map(r=>[r,{status:'Borte'}])))})).reason,'ALL_AWAY_NO_OPERATIONAL_WRITES');
 assert.throws(()=>planCleaningCycle(cycle({handover:false})),/Invalid handover flag/);
 const {handover,...ordinary}=cycle({isCompletedCard:true,residents:people()});
 const o=planCleaningCycle(ordinary);assert.equal(o.handover,undefined);assert.deepEqual(o.completionPoints,{residentId:'r2',delta:5});assert.deepEqual(o.skippedCreditDeltas,[]);
 assert.equal(planCleaningCycle({...ordinary,isCompletedCard:false}).reason,'OLD_CARD_NOT_COMPLETED');
});

test('internal milestone rooms handed over: holder away with a date, due on or before it, an open unaccepted head',()=>{
 const residents=[0,1,2,3,4,5].map(i=>({memberId:hex(40+i),status:'Aktiv',untilDay:null}));
 residents[1]={...residents[1],status:'Borte',untilDay:'2026-11-12'};
 const room=(zone,holder,dueDay,phase='READY')=>({zone,holderId:hex(40+holder),dueDay,phase});
 assert.deepEqual(roomsToHandOver({residents,rooms:[room('Kjøkken',1,'2026-11-11'),room('Bad 1',1,'2026-11-12'),room('Gang',1,'2026-11-20'),room('WC',2,'2026-11-06'),room('Bad 2',1,'2026-11-01')]}),
  ['Kjøkken','Bad 1','Bad 2'],'back before Gang is due; WC is not hers; an overdue room is handed over too');
 assert.deepEqual(roomsToHandOver({residents,rooms:[room('Kjøkken',1,'2026-11-11','ACCEPTED'),room('Bad 1',1,'2026-11-11','DEFERRED')]}),[],'only an open READY head');
 const noDate=residents.map((r,i)=>i===1?{...r,untilDay:null}:r);assert.deepEqual(roomsToHandOver({residents:noDate,rooms:[room('Kjøkken',1,'2026-11-05')]}),[],'Borte without a date is not acted on');
 assert.deepEqual(roomsToHandOver({residents,rooms:[]}),[]);
 for(const bad of [{residents:residents.slice(1),rooms:[]},{residents,rooms:[room('Kjøkken',1,'11.11.2026')]},{residents,rooms:[room('Kjøkken',1,'2026-11-11'),room('Kjøkken',2,'2026-11-11')]},
  {residents,rooms:[{...room('Kjøkken',1,'2026-11-11'),holderId:hex(99)}]},{residents:residents.map((r,i)=>i?r:{...r,status:'Syk'}),rooms:[]}])
  assert.throws(()=>roomsToHandOver(bad),/HANDOVER_RULE_INPUT_/);
});
