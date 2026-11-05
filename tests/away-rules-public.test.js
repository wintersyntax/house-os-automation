import test from 'node:test';
import assert from 'node:assert/strict';
import { awayPlan, awayComment, nextDay, editsPrevious, foreignChangeComment } from '../src/engine/away-rules.js';

test('Borte til: inclusive away date and next-day activation', () => {
  const away = awayPlan({today:'2026-11-04',status:'Aktiv',untilDay:'2026-11-05'});
  assert.deepEqual(away,{status:'Borte',clearUntil:false,event:'LEFT',untilDay:'2026-11-05'});
  assert.match(awayComment({event:away.event,untilDay:away.untilDay}),/06\.11\./);
  const back = awayPlan({today:'2026-11-06',status:'Borte',untilDay:'2026-11-05'});
  assert.deepEqual(back,{status:'Aktiv',clearUntil:true,event:'BACK',untilDay:'2026-11-05'});
});

test('Borte til: early return and invalid input fail closed', () => {
  assert.equal(awayPlan({today:'2026-11-04',status:'Borte',untilDay:null,wasAway:true}).event,'BACK');
  assert.equal(awayPlan({today:'2026-11-04',status:'Borte',untilDay:null}).event,'RESTORED');
  assert.equal(nextDay('2026-12-31'),'2027-01-01');
  assert.throws(()=>awayPlan({today:'not a date',status:null,untilDay:null}),/AWAY_RULE_INPUT/);
});

test('Borte til: comment edits are deterministic', () => {
  assert.equal(editsPrevious('LEFT','LEFT'),true);
  assert.equal(editsPrevious('BACK','LEFT'),false);
  assert.match(awayComment({event:'BACK'}),/Velkommen hjem/);
});

test('Borte til: leaving comment lists fictional room handovers without implying completion', () => {
  const text = awayComment({event:'LEFT',untilDay:'2026-11-10',handedOver:[{room:'Kjøkken',receiver:'Demo Resident'}]});
  assert.match(text,/Kjøkken.*Demo Resident/);
  assert.match(text,/11\.11\./);
  assert.throws(()=>awayComment({event:'BACK',handedOver:[{room:'Kjøkken',receiver:'Demo Resident'}]}),/HANDED_OVER/);
  assert.throws(()=>awayComment({event:'LEFT',untilDay:'2026-11-10',handedOver:[{room:'Kjøkken',receiver:'<script>'}]}),/HANDED_OVER/);
  assert.throws(()=>awayComment({event:'LEFT',untilDay:'2026-11-10',handedOver:null}),/HANDED_OVER/);
});

test('Borte til: foreign-change explanation accepts a fictional display name and rejects markup', () => {
  assert.match(foreignChangeComment('Demo Resident'),/Bare \*\*Demo Resident\*\* kan endre/);
  assert.throws(()=>foreignChangeComment('<script>'),/NAME/);
  assert.throws(()=>foreignChangeComment(null),/NAME/);
});
