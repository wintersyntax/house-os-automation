import test from 'node:test';
import assert from 'node:assert/strict';
import {CLEANING_ZONES, planCleaningCycle} from '../src/engine/cleaning-parity.js';

// Pure fiction: never map these IDs to actual resident names or Trello members.
const ids = Array.from({length:6},(_,i)=>'synthetic-'+String(i+1));
const make=(patch={})=>({
  cardId:'synthetic-cycle',zone:'Kjøkken',
  completionDate:'2026-10-17',completedById:ids[0],
  isCompletedCard:true,stage:'unseen',previousAssignmentMode:'Normal',
  residents:ids.map((id,i)=>({id,status:'Aktiv',
    points:i*2,credits:0,skipped:0})),...patch,
});
const allZero=(patch={})=>make({residents:ids.map(id=>({
  id,status:'Aktiv',points:0,credits:0,skipped:0,
})),...patch});
const withAway=(away,base=allZero())=>({...base,
  residents:base.residents.map(x=>({...x,
    status:away.includes(x.id)?'Borte':'Aktiv'})),
});
const proposal=p=>{
  assert.equal(p.kind,'PROPOSE_CYCLE');
  assert.equal(p.authority,'PROVISIONAL_DOCUMENTED_ONLY');
  assert.equal('providerWrite' in p,false);
  assert.equal('verifiedParity' in p,false);
  return p;
};

test('TASK-004: six documented cleaning zones, effort and date windows',()=>{
  assert.deepEqual(CLEANING_ZONES,{
    'Kjøkken':{points:5,startOffsetDays:5,dueOffsetDays:7},
    'Bad 1':{points:4,startOffsetDays:5,dueOffsetDays:7},
    'Bad 2':{points:3,startOffsetDays:8,dueOffsetDays:10},
    WC:{points:3,startOffsetDays:5,dueOffsetDays:7},
    'Stue + Spisestue':{points:2,startOffsetDays:11,dueOffsetDays:14},
    Gang:{points:1,startOffsetDays:17,dueOffsetDays:21},
  });
  assert.ok(Object.isFrozen(CLEANING_ZONES));
  for(const entry of Object.values(CLEANING_ZONES))
    assert.ok(Object.isFrozen(entry));
});

test('TASK-004: normal next person is the circular next when point gap is low',()=>{
  const p=proposal(planCleaningCycle(allZero()));
  assert.equal(p.nominalResidentId,ids[1]);
  assert.equal(p.normalSuccessorId,ids[1]);
  assert.equal(p.selectedResidentId,ids[1]);
  assert.equal(p.allocation,'Normal');
  assert.equal(p.pointGapAfterBooking,5);
  assert.deepEqual(p.completionPoints,{residentId:ids[0],delta:5});
  assert.equal(p.startDate,'2026-10-22');
  assert.equal(p.dueDate,'2026-10-24');
  assert.equal(p.previousAssignmentMode,'Normal');
});

test('TASK-004: gap over five produces at most one provisional correction',()=>{
  const p=proposal(planCleaningCycle(make()));
  assert.equal(p.pointGapAfterBooking,8);
  assert.equal(p.allocation,'Balansekorrigert');
  assert.equal(p.selectedResidentId,ids[1]);
  assert.equal(p.previousAssignmentMode,'Normal');
});

test('TASK-033: prior routine Balansekorrigert forces Normal even with gap >5',()=>{
  const p=proposal(planCleaningCycle(make({previousAssignmentMode:'Balansekorrigert'})));
  assert.equal(p.pointGapAfterBooking,8);
  assert.equal(p.allocation,'Normal');
  assert.equal(p.selectedResidentId,ids[1]);
  assert.equal(p.previousAssignmentMode,'Balansekorrigert');
});

test('TASK-004: one and two Borte skips propose one credit and counter per person',()=>{
  const p=proposal(planCleaningCycle(withAway([ids[1]])));
  assert.equal(p.nominalResidentId,ids[1]);
  assert.equal(p.selectedResidentId,ids[2]);
  assert.deepEqual(p.skippedResidentIds,[ids[1]]);
  assert.deepEqual(p.skippedCreditDeltas,[{
    residentId:ids[1],creditDelta:1,skippedDelta:1,
  }]);
  const two=proposal(planCleaningCycle(withAway([ids[1],ids[2]])));
  assert.equal(two.selectedResidentId,ids[3]);
  assert.deepEqual(two.skippedResidentIds,[ids[1],ids[2]]);
  assert.equal(two.skippedCreditDeltas.length,2);
});

test('TASK-004: circular successor from final position returns to first',()=>{
  const p=proposal(planCleaningCycle(allZero({completedById:ids[5]})));
  assert.equal(p.nominalResidentId,ids[0]);
  assert.equal(p.normalSuccessorId,ids[0]);
  assert.equal(p.selectedResidentId,ids[0]);
});

test('TASK-004: all-away becomes REVIEW without point/counter/create proposal',()=>{
  const p=planCleaningCycle(withAway(ids));
  assert.deepEqual(p,{
    kind:'REVIEW',reason:'ALL_AWAY_NO_OPERATIONAL_WRITES',
    authority:'PROVISIONAL_DOCUMENTED_ONLY',
  });
});

test('TASK-004: partial processing is REVIEW, never blindly resumed',()=>{
  const p=planCleaningCycle(allZero({stage:'processing'}));
  assert.deepEqual(p,{
    kind:'REVIEW',reason:'PARTIAL_PROCESSING_REQUIRES_PROGRESS_RECONCILIATION',
    authority:'PROVISIONAL_DOCUMENTED_ONLY',
  });
});

test('TASK-004: completed operation is idempotent NO_ACTION without any new write',()=>{
  const p=planCleaningCycle(allZero({stage:'completed'}));
  assert.deepEqual(p,{
    kind:'NO_ACTION',reason:'ALREADY_PROCESSED_IDEMPOTENTLY',
    authority:'PROVISIONAL_DOCUMENTED_ONLY',
  });
});

test('TASK-004: an old routine not marked completed must be reviewed',()=>{
  const p=planCleaningCycle(allZero({isCompletedCard:false}));
  assert.equal(p.kind,'REVIEW');
  assert.equal(p.reason,'OLD_CARD_NOT_COMPLETED');
});

test('TASK-004: every zone date is computed from actual completion D, not due date',()=>{
  for(const [zone,model] of Object.entries(CLEANING_ZONES)){
    const p=proposal(planCleaningCycle(allZero({zone,completionDate:'2026-12-29'})));
    const expectedStart=new Date(Date.UTC(2026,11,29)+model.startOffsetDays*86400000)
      .toISOString().slice(0,10);
    const expectedDue=new Date(Date.UTC(2026,11,29)+model.dueOffsetDays*86400000)
      .toISOString().slice(0,10);
    assert.equal(p.startDate,expectedStart);
    assert.equal(p.dueDate,expectedDue);
    assert.equal(p.effortPoints,model.points);
  }
});

test('TASK-004: immutable proposal has no provider or resident personal data',()=>{
  const input=allZero(),copy=structuredClone(input);
  const p=proposal(planCleaningCycle(input));
  assert.deepEqual(input,copy);
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.skippedResidentIds));
  assert.ok(Object.isFrozen(p.skippedCreditDeltas));
  assert.ok(!/trello.com|http|token|memberName|buyer/i.test(JSON.stringify(p)));
});

test('TASK-004: empty numeric Trello fields become zero, invalid numbers fail closed',()=>{
  const v=allZero();
  v.residents[0].points='';
  v.residents[1].credits=null;
  v.residents[2].skipped=undefined;
  assert.equal(proposal(planCleaningCycle(v)).pointGapAfterBooking,5);
  for(const bad of [-1_000_000_001,3.5,Infinity,NaN,'3','NaN',1_000_000_001]){
    const x=allZero();x.residents[2].points=bad;
    assert.throws(()=>planCleaningCycle(x),TypeError);
  }
  // TASK-137: points may be negative after overdue deductions; credits and counters may not.
  const neg=allZero();neg.residents[2].points=-7;assert.equal(proposal(planCleaningCycle(neg)).pointGapAfterBooking,12);
  for(const k of ['credits','skipped']){const x=allZero();x.residents[2][k]=-1;assert.throws(()=>planCleaningCycle(x),TypeError);}
});

test('TASK-004: nonsense completion calendar dates cannot silently roll over',()=>{
  for(const d of ['2026-02-29','2026-13-01','2026-11-31',
    '2026-01-00','2026-10-17T01:00:00Z','not-a-date']){
    assert.throws(()=>planCleaningCycle(allZero({completionDate:d})),TypeError);
  }
  const leap=proposal(planCleaningCycle(allZero({completionDate:'2028-02-29'})));
  assert.equal(leap.startDate,'2028-03-05');
  assert.equal(leap.dueDate,'2028-03-07');
});

test('TASK-004: duplicate, foreign or wrong-sized resident arrays fail closed',()=>{
  for(const residents of [
    [],make().residents.slice(0,5),
    [...make().residents.slice(0,5),make().residents[0]],
    [null,...make().residents.slice(1)],
    make().residents.map((x,i)=>i===0?{...x,id:'?'}:x),
    make().residents.map((x,i)=>i===0?{...x,status:'unknown'}:x),
    make().residents.map((x,i)=>i===0?{...x,extra:'foreign'}:x),
  ])assert.throws(()=>planCleaningCycle(allZero({residents})),TypeError);
  assert.throws(()=>planCleaningCycle(allZero({completedById:'other-member'})),TypeError);
});

test('TASK-004: unknown stage, zone, provenance and extra authority are refused',()=>{
  for(const patch of [
    {stage:'confirmed'}, {previousAssignmentMode:'unknown'}, {zone:'Unknown'},
    {isCompletedCard:'yes'}, {trustedSourceSequence:1}, {cardId:'bad/with/slash'},
  ])assert.throws(()=>planCleaningCycle(allZero(patch)),TypeError);
});

test('TASK-004: fairness tie follows forward nominal order among active residents',()=>{
  const v=allZero();
  v.residents=v.residents.map((r,i)=>({...r,points:i===0?8:0}));
  const p=proposal(planCleaningCycle(v));
  assert.equal(p.pointGapAfterBooking,13);
  assert.equal(p.allocation,'Balansekorrigert');
  assert.equal(p.selectedResidentId,ids[1]);
});

test('TASK-004: Borte rows excluded from gap but not forgotten for credit proposal',()=>{
  const v=withAway([ids[1]]);
  v.residents=v.residents.map(r=>({...r,points:r.id===ids[1]?100:0}));
  const p=proposal(planCleaningCycle(v));
  assert.equal(p.pointGapAfterBooking,5);
  assert.equal(p.selectedResidentId,ids[2]);
  assert.deepEqual(p.skippedResidentIds,[ids[1]]);
});

test('TASK-004: late-stage Borte skip branch cannot be mistaken for atomic write',()=>{
  const p=proposal(planCleaningCycle(withAway([ids[1]])));
  assert.equal('commitAtomically' in p,false);
  assert.equal('send' in p,false);
  assert.equal(p.skippedCreditDeltas.length,1);
});
