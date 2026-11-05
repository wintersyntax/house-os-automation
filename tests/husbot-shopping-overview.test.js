import test from 'node:test';
import assert from 'node:assert/strict';
import {createShoppingOverview} from '../src/husbot/shopping-overview.js';
import {createAnswer, classifyMention} from '../src/husbot/live-reply.js';
import {projectShoppingChecklist} from '../src/trello/inventory.js';

const need = (id = 'inventory-1', name = 'Synthetic soap') => ({id, name});
const check = (id = 'check-1', name = 'Synthetic detergent') => ({id, name});
const overview = (inventoryNeeds = [], checklistItems = []) =>
  createShoppingOverview({inventoryNeeds, checklistItems});

test('TASK-032: present independent inventory and checklist entries without invented joins', () => {
  const text = overview([need()], [check()]);
  assert.match(text, /Må kjøpes \(2 registreringer\)/);
  assert.match(text, /Synthetic detergent — HANDLELISTE/);
  assert.match(text, /Synthetic soap — KJØP/);
  assert.doesNotMatch(text, /HANDLELISTE \+ KJØP/);
  assert.match(text, /ikke bekreftet kjøp eller levering/);
});

test('TASK-032: same name never collapses two independent identities', () => {
  const text = overview([need()], [check('check-2', 'Synthetic soap')]);
  assert.match(text, /Må kjøpes \(2 registreringer\)/);
  assert.match(text, /Synthetic soap — HANDLELISTE/);
  assert.match(text, /Synthetic soap — KJØP/);
  assert.match(text, /⚠️ 1 varenavn gjentas/);
  assert.doesNotMatch(text, /identitet .* bekreftet\.$/);
});

test('TASK-032: repeated checklist names with distinct IDs remain visible with warning', () => {
  const text = overview([], [check('check-a'), check('check-b')]);
  assert.match(text, /Må kjøpes \(2 registreringer\)/);
  assert.equal((text.match(/Synthetic detergent — HANDLELISTE/g) || []).length, 2);
  assert.match(text, /1 varenavn gjentas/);
});

test('TASK-032: Norwegian lowercase and NFKC matching flag possible overlap, not identity', () => {
  const text = overview([need('inventory', 'SÅPE')], [check('check', 'såpe')]);
  assert.match(text, /1 varenavn gjentas/);
  assert.match(text, /SÅPE — KJØP/);
  assert.match(text, /såpe — HANDLELISTE/);
});

test('TASK-032: Butler link label is display only, not verified inventory ownership', () => {
  const text = overview([need()], [
    check('check', '[Synthetic soap](https://trello.com/c/AbCd1234/soap)'),
  ]);
  assert.match(text, /Synthetic soap — HANDLELISTE/);
  assert.match(text, /Synthetic soap — KJØP/);
  assert.match(text, /⚠️ 1 varenavn gjentas/);
  assert.doesNotMatch(text, /trello\.com|AbCd1234|https/);
});

test('TASK-032: a checked item is not a purchase or a restock input', () => {
  const cardId = 'a'.repeat(24);
  const shopping = projectShoppingChecklist({
    lists: [{id: 'list-id', name: '🛒 HANDLELISTE'}],
    cards: [{id: cardId, idList: 'list-id', closed: false,
      name: 'Neste handletur'}],
    checklists: [{idCard: cardId, name: 'Varer som skal kjøpes', checkItems: [
      {id: 'b'.repeat(24), name: 'Synthetic checked item', state: 'complete'},
      {id: 'c'.repeat(24), name: 'Synthetic remaining item', state: 'incomplete'},
    ]}],
  });
  const text = overview([need()], shopping);
  assert.doesNotMatch(text, /Synthetic checked item/);
  assert.match(text, /Synthetic remaining item/);
  assert.match(text, /Synthetic soap — KJØP/);
  assert.match(text, /ikke bekreftet kjøp eller levering/);
});

test('TASK-032: empty shopping view remains truthful, not evidence of restock', () => {
  assert.equal(overview(), '🛒 Ingen varer på handlelisten eller merket KJØP i inventaret akkurat nå.');
});

test('TASK-032: display cap preserves total count without an unbounded Slack reply', () => {
  const items = Array.from({length: 28}, (_, i) => check('id-' + i, 'Synthetic item ' + i));
  const text = overview([], items);
  assert.match(text, /Må kjøpes \(28 registreringer\)/);
  assert.match(text, /…og 16 flere registreringer/);
  assert.ok(text.length <= 2000);
  assert.ok(!text.includes('Synthetic item 27 — HANDLELISTE'));
});

test('TASK-032: max valid lengths cannot overflow Slack even with many hidden rows', () => {
  const big = 'S'.repeat(120);
  const items = Array.from({length: 200}, (_, i) =>
    check('check-' + i, big.slice(0, 116) + String(i).padStart(4, '0')));
  const result = overview([], items);
  assert.ok(result.length <= 2000);
  assert.match(result, /…og 188 flere registreringer/);
});

test('TASK-032: unknown shape, duplicate IDs and unsafe labels fail closed', () => {
  for (const value of [
    null, {}, 'soap', [check('a'), check('a')],
    [null], [{id: 1, name: 'Soap'}],
    [check('b', '')], [check('b', 'Bad\nentry')],
    [check('b', 'x'.repeat(121))],
    [check('b', 'https://trello.com/c/AbCd1234')],
    [check('b', '[Soap](https://evil.example/c/AbCd1234)')],
    [check('b', '<script>')], [check('b', 'Safe\u202Eunsafe')],
    Array.from({length: 201}, (_, i) => check('id-' + i, 'Soap')),
  ]) assert.throws(() => overview([], value), TypeError);
});

test('TASK-032: cannot import URLs/tokens as freeform checklist names', () => {
  for (const name of [
    '[Soap](https://trello.com/c/AbCd1234?token=secret)',
    'https://trello.com/c/AbCd1234',
    'Soap https://example.invalid', '[Soap](http://trello.com/c/AbCd1234)',
    '[Soap](https://trello.com/c/AbCd1234/#bad)',
  ]) assert.throws(() => overview([], [check('id', name)]), TypeError);
});

test('TASK-032: rendering never mutates source data or accepts false authority', () => {
  const input = {inventoryNeeds:[need()],checklistItems:[check()]};
  const original = structuredClone(input);
  const text = createShoppingOverview(input);
  assert.deepEqual(input, original);
  assert.doesNotMatch(text, /trustedSequence|needGeneration|verified purchase/);
});

test('TASK-032: same shopping intent accepts explicit status phrases', async () => {
  assert.equal(classifyMention('<@U123456789> handleliste status'), 'shopping');
  assert.equal(classifyMention('<@U123456789> status handleliste'), 'shopping');
  const readInventory = async ({includeShoppingList}) => {
    assert.equal(includeShoppingList, true);
    return {
      inventory: [{id:'i1',name:'Synthetic soap',status:'kjøp'}],
      shoppingAttention:[{id:'i1',name:'Synthetic soap'}],
      shoppingList:[{id:'c1',name:'Synthetic soap'}],
    };
  };
  const text = await createAnswer('<@U123456789> status handleliste', {readInventory});
  assert.match(text, /2 registreringer/);
  assert.match(text, /⚠️ 1 varenavn gjentas/);
});

test('TASK-032: duplicate inventory identity fails even if names differ', () => {
  assert.throws(() => overview([need(),need('inventory-1','Other')], []), TypeError);
});
