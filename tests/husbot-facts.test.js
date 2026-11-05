import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFacts, renderFallbackBrief } from '../src/husbot/facts.js';

const fixture = JSON.parse(
  readFileSync(new URL('../examples/synthetic-household.json', import.meta.url), 'utf8')
);

function ids(records) {
  return records.map((item) => item.id ?? item.residentId);
}

test('before purchase: facts match documented synthetic expectations', () => {
  const facts = buildFacts(fixture.snapshots.beforePurchase);
  const expected = fixture.expectedDeterministicFacts.beforePurchase;
  assert.deepEqual(ids(facts.choresDueToday), expected.choresDueTodayIds);
  assert.deepEqual(ids(facts.overdue), expected.overdueChoreIds);
  assert.deepEqual(ids(facts.awayResidents), expected.awayResidentIds);
  assert.deepEqual(ids(facts.urgentIssues), expected.urgentIssueIds);
  assert.deepEqual(ids(facts.shoppingAttention), expected.shoppingAttentionInventoryIds);
});

test('after purchase: do not report stale shopping needs', () => {
  const facts = buildFacts(fixture.snapshots.afterPurchase);
  const expected = fixture.expectedDeterministicFacts.afterPurchase;
  assert.deepEqual(ids(facts.shoppingAttention), expected.shoppingAttentionInventoryIds);
  assert.doesNotMatch(renderFallbackBrief(facts), /Oppvasktabletter|Håndsåpe/);
});

test('read-only: extraction never mutates its source snapshot', () => {
  const snapshot = structuredClone(fixture.snapshots.beforePurchase);
  const original = structuredClone(snapshot);
  buildFacts(snapshot);
  assert.deepEqual(snapshot, original);
});

test('overdue chores are distinct from chores due today', () => {
  const snapshot = structuredClone(fixture.snapshots.beforePurchase);
  snapshot.chores[0].dueDate = '2026-10-13';
  const facts = buildFacts(snapshot);
  assert.deepEqual(ids(facts.choresDueToday), []);
  assert.deepEqual(ids(facts.overdue), ['chore-kitchen']);
});

test('away dates are inclusive but expired absence is not active', () => {
  const snapshot = structuredClone(fixture.snapshots.beforePurchase);
  snapshot.away[0].awayThroughDateInclusive = '2026-10-13';
  assert.deepEqual(buildFacts(snapshot).awayResidents, []);
});

test('checked item does not erase an unconfirmed shopping requirement', () => {
  const snapshot = structuredClone(fixture.snapshots.beforePurchase);
  snapshot.shopping.nextTrip.items[0].checked = true;
  assert.ok(ids(buildFacts(snapshot).shoppingAttention).includes('inv-dishwasher-tablets'));
});

test('empty valid collections yield a truthful empty fallback', () => {
  const facts = buildFacts({
    capturedAt: '2026-10-14T08:00:00+02:00',
    chores: [], away: [], homeIssues: [], inventory: [],
  });
  assert.deepEqual(facts.shoppingAttention, []);
  assert.match(renderFallbackBrief(facts), /Må kjøpes: Ingen/);
});

test('missing source fields fail closed, never silently report all clear', () => {
  const snapshot = structuredClone(fixture.snapshots.beforePurchase);
  delete snapshot.inventory;
  assert.throws(() => buildFacts(snapshot), /Missing or invalid inventory/);
  assert.throws(() => buildFacts({}), /capturedAt/);
});

test('rejects impossible chore and Borte dates without rollover', () => {
  const invalidDates = [
    '2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01',
    '2026-00-12', '2026-01-00', '0000-01-01', '1900-02-29',
    '2026-1-01',
  ];
  for (const invalid of invalidDates) {
    const chore = structuredClone(fixture.snapshots.beforePurchase);
    chore.chores[0].dueDate = invalid;
    assert.throws(() => buildFacts(chore), /Invalid calendar date at chores\[0\]\.dueDate/, invalid);

    const away = structuredClone(fixture.snapshots.beforePurchase);
    away.away[0].awayThroughDateInclusive = invalid;
    assert.throws(
      () => buildFacts(away),
      /Invalid calendar date at away\[0\]\.awayThroughDateInclusive/,
      invalid,
    );
  }
});

test('accepts leap days and preserves the local household date across UTC boundaries', () => {
  for (const year of ['2000', '2024']) {
    const facts = buildFacts({
      capturedAt: `${year}-02-29T00:15:00+14:00`,
      chores: [{ id: 'leap-clean', name: 'Leap cleaning', dueDate: `${year}-02-29`, status: 'open' }],
      away: [{ residentId: 'resident-example', awayThroughDateInclusive: `${year}-02-29`, status: 'borte' }],
      homeIssues: [],
      inventory: [],
    });
    assert.equal(facts.asOf, `${year}-02-29`);
    assert.deepEqual(ids(facts.choresDueToday), ['leap-clean']);
    assert.deepEqual(ids(facts.awayResidents), ['resident-example']);
  }
});

test('rejects impossible capturedAt days, times and UTC offsets', () => {
  const invalidTimestamps = [
    '2026-02-30T08:00:00+02:00', '2026-02-29T08:00:00+02:00',
    '2026-04-31T08:00:00+02:00', '0000-01-01T08:00:00+02:00',
    '2026-10-14T24:00:00+02:00', '2026-10-14T23:60:00+02:00',
    '2026-10-14T23:59:60+02:00', '2026-10-14T08:00:00+14:01',
    '2026-10-14T08:00:00+15:00', '2026-10-14T08:00:00+02:60',
    '2026-10-14T08:00:00',
  ];
  for (const capturedAt of invalidTimestamps) {
    const snapshot = structuredClone(fixture.snapshots.beforePurchase);
    snapshot.capturedAt = capturedAt;
    assert.throws(() => buildFacts(snapshot), /capturedAt must be a valid ISO timestamp/, capturedAt);
  }
});

test('invalid dates and unknown statuses fail closed', () => {
  const snapshot = structuredClone(fixture.snapshots.beforePurchase);
  snapshot.chores[0].dueDate = 'bad-date';
  assert.throws(() => buildFacts(snapshot), /calendar date/);
  snapshot.chores[0].dueDate = '2026-10-14';
  snapshot.inventory[0].status = 'mystery';
  assert.throws(() => buildFacts(snapshot), /inventory status/);
});

test('TASK-002: one evergreen shopping card and checklist survive completed purchase', () => {
  const { beforePurchase: before, afterPurchase: after } = fixture.snapshots;
  const expected = fixture.expectedShoppingLifecycle;
  const previous = before.shopping.nextTrip;
  const current = after.shopping.nextTrip;

  assert.equal(previous.name, '🛒 Neste handletur');
  assert.equal(current.name, previous.name);
  assert.equal(previous.id, expected.evergreenCardId);
  assert.equal(current.id, previous.id);
  assert.equal(previous.state, 'open');
  assert.equal(current.state, previous.state);
  assert.equal(previous.checklistName, 'Varer som skal kjøpes');
  assert.equal(current.checklistName, previous.checklistName);
  assert.equal(previous.checklistId, expected.evergreenChecklistId);
  assert.equal(current.checklistId, previous.checklistId);
  assert.deepEqual(previous.items.map(item => item.sourceInventoryId),
    expected.purchasedInventoryIds);
  assert.deepEqual(current.items.map(item => item.sourceInventoryId),
    expected.remainingChecklistInventoryIdsAfter);
  assert.deepEqual(current.items, []);
  assert.equal(after.shopping.completedTripId, expected.completedPurchaseId);
  assert.notEqual(after.shopping.completedTripId, current.id,
    'a historical purchase is not the evergreen Trello card');
  assert.equal(after.expenses[0].fromTripId, expected.completedPurchaseId);
});

test('TASK-002: one purchased checklist entry per inventory source and historical expense', () => {
  const { beforePurchase: before, afterPurchase: after } = fixture.snapshots;
  const expected = fixture.expectedShoppingLifecycle;
  const items = before.shopping.nextTrip.items;
  const ids = items.map(item => item.sourceInventoryId);
  assert.equal(new Set(ids).size, items.length, 'no duplicate purchase links');
  assert.deepEqual(ids, expected.purchasedInventoryIds);
  const beforeById = new Map(before.inventory.map(item => [item.id, item]));
  const afterById = new Map(after.inventory.map(item => [item.id, item]));
  const expense = after.expenses[0];
  assert.equal(after.expenses.length, 1);
  assert.equal(expense.id, expected.expenseId);
  assert.equal(expense.lineItems.length, items.length);
  assert.deepEqual(expense.lineItems.map(item => item.sourceInventoryId), ids);

  for (const [index, item] of items.entries()) {
    const beforeProduct = beforeById.get(item.sourceInventoryId);
    const afterProduct = afterById.get(item.sourceInventoryId);
    const line = expense.lineItems[index];
    assert.equal(beforeProduct.status.toLocaleLowerCase('nb-NO'), 'kjøp');
    assert.equal(afterProduct.status, 'OK');
    assert.equal(item.name, beforeProduct.name);
    assert.equal(line.name, item.name);
    assert.equal(item.priceNok, line.amountNok);
    assert.deepEqual(line.quantity, item.quantityPurchased);
    assert.equal(beforeProduct.quantity.unit, item.quantityPurchased.unit);
    assert.equal(afterProduct.quantity.unit, beforeProduct.quantity.unit);
    assert.ok(Math.abs(
      afterProduct.quantity.value -
      (beforeProduct.quantity.value + item.quantityPurchased.value)
    ) < 1e-9, 'fictional restock must conserve units');
  }

  assert.deepEqual([...beforeById.keys()], [...afterById.keys()]);
  for (const id of expected.unchangedLowInventoryIds) {
    assert.equal(beforeById.get(id).status, 'Lav');
    assert.equal(afterById.get(id).status, 'Lav');
    assert.deepEqual(beforeById.get(id).quantity, afterById.get(id).quantity);
  }
});

test('TASK-002: 286 NOK purchase and 20 NOK PANT create only a synthetic 266 NOK expense', () => {
  const { beforePurchase: before, afterPurchase: after } = fixture.snapshots;
  const expected = fixture.expectedShoppingLifecycle;
  const expense = after.expenses[0];
  const cents = value => {
    assert.ok(Number.isSafeInteger(Math.round(value * 100)));
    assert.ok(Math.abs(value * 100 - Math.round(value * 100)) < 1e-9);
    return Math.round(value * 100);
  };
  const checklistTotal = before.shopping.nextTrip.items
    .reduce((sum, item) => sum + cents(item.priceNok), 0);
  const receiptTotal = expense.lineItems
    .reduce((sum, item) => sum + cents(item.amountNok), 0);
  assert.equal(checklistTotal, 28600);
  assert.equal(receiptTotal, 28600);
  assert.equal(cents(expense.totalNok), cents(expected.totalNok));
  assert.equal(cents(expense.pantUsedNok), cents(expected.pantUsedNok));
  assert.equal(cents(expense.personallyPaidNok), cents(expected.personallyPaidNok));
  assert.equal(checklistTotal - cents(expense.pantUsedNok),
    cents(expense.personallyPaidNok));
  assert.equal(before.pant.vouchers.length, 1);
  assert.equal(after.pant.vouchers.length, 1);
  assert.equal(before.pant.vouchers[0].status, 'Tilgjengelig');
  assert.equal(after.pant.vouchers[0].status, 'Brukt');
  assert.equal(after.pant.vouchers[0].amountNok, expected.pantUsedNok);
  assert.equal(after.pant.vouchers[0].usedForExpenseId, expense.id);
  assert.equal(expense.receipt.kind, 'synthetic');
  assert.equal(expense.settlement.defined, false);
  assert.equal(fixture.implementationStatus.shoppingToExpenses, 'SYNTHETIC_DEMO_NOT_AUTOMATED');
});

test('TASK-002: empty or checked evergreen checklist never overrides Kjøp inventory status', () => {
  const before = structuredClone(fixture.snapshots.beforePurchase);
  const beforeOriginal = structuredClone(before);
  for (const item of before.shopping.nextTrip.items) item.checked = true;
  assert.deepEqual(ids(buildFacts(before).shoppingAttention),
    fixture.expectedShoppingLifecycle.purchasedInventoryIds);
  assert.deepEqual(fixture.snapshots.beforePurchase, beforeOriginal);

  const after = structuredClone(fixture.snapshots.afterPurchase);
  assert.deepEqual(after.shopping.nextTrip.items, []);
  after.inventory[0].status = 'Kjøp'; // New shortage, even with empty checklist.
  const afterOriginal = structuredClone(after);
  assert.deepEqual(ids(buildFacts(after).shoppingAttention),
    [fixture.expectedShoppingLifecycle.purchasedInventoryIds[0]]);
  assert.match(renderFallbackBrief(buildFacts(after)), /Må kjøpes: Oppvasktabletter/);
  assert.deepEqual(after, afterOriginal, 'read-only facts cannot clear checklist or restock');
});
