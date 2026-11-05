/** Trello board inventory projection. Pure, strict and read-only. */
const INVENTORY_LIST = '📦 INVENTAR';
const STATUS_FIELD = 'I · Status';
const STATUS_OPTIONS = new Set(['OK', 'LAV', 'KJØP']);
const SHOPPING_LIST = '🛒 HANDLELISTE';
const SHOPPING_CARD = 'Neste handletur';
const SHOPPING_CHECKLIST = 'Varer som skal kjøpes';

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid ' + label);
  return value;
}
function string(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Missing ' + label);
  return value;
}
function unique(values, predicate, label) {
  const found = values.filter(predicate);
  if (found.length !== 1) throw new TypeError('Require exactly one ' + label);
  return found[0];
}

export function projectInventory({ lists, fields, cards }) {
  if (!Array.isArray(lists) || !Array.isArray(fields) || !Array.isArray(cards))
    throw new TypeError('Missing Trello board collections');
  const inventoryList = unique(lists, x => x?.name === INVENTORY_LIST, 'inventory list');
  const listId = string(inventoryList.id, 'inventory list ID');
  const statusField = unique(fields, x => x?.name === STATUS_FIELD, 'inventory status field');
  if (statusField.type !== 'list' || !Array.isArray(statusField.options))
    throw new TypeError('Unsupported inventory status field definition');
  const options = new Map();
  for (const raw of statusField.options) {
    const option = object(raw, 'inventory status option');
    const id = string(option.id, 'inventory status option ID');
    const value = string(option.value?.text, 'inventory status option value').toUpperCase();
    if (!STATUS_OPTIONS.has(value) || options.has(id) ||
        [...options.values()].includes(value))
      throw new TypeError('Unexpected or duplicate inventory status option');
    options.set(id, value);
  }
  if (options.size !== STATUS_OPTIONS.size)
    throw new TypeError('Incomplete inventory status option mapping');
  const inventory = [], seen = new Set();
  for (const raw of cards) {
    const card = object(raw, 'Trello card');
    if (card.idList !== listId || card.closed === true) continue;
    const id = string(card.id, 'inventory card ID');
    if (seen.has(id)) throw new TypeError('Duplicate inventory card');
    seen.add(id);
    const name = string(card.name, 'inventory card name');
    if (!Array.isArray(card.customFieldItems))
      throw new TypeError('Missing inventory customFieldItems');
    const statusItem = unique(card.customFieldItems,
      x => x?.idCustomField === statusField.id, 'inventory status value');
    const status = options.get(string(statusItem.idValue, 'inventory option selection'));
    if (!status) throw new TypeError('Unknown inventory status option');
    inventory.push({ id, name, status: status.toLocaleLowerCase('nb-NO') });
  }
  return inventory.sort((a,b) => a.id.localeCompare(b.id));
}

export function inventoryAttention(inventory) {
  if (!Array.isArray(inventory)) throw new TypeError('Invalid inventory');
  return inventory.filter(item => item.status === 'kjøp')
    .map(item => ({ id: item.id, name: item.name }));
}

/**
 * TASK-019: resolve only the one existing evergreen shopping card.
 * Never infer a purchase from a checklist item, or scan unrelated cards.
 */
export function shoppingCardId({lists, cards} = {}) {
  if (!Array.isArray(lists) || !Array.isArray(cards))
    throw new TypeError('Missing Trello shopping collections');
  const list = unique(lists, x => x?.name === SHOPPING_LIST, 'shopping list');
  const listId = string(list.id, 'shopping list ID');
  const card = unique(cards, x => x?.idList === listId && x?.closed === false &&
    x?.name === SHOPPING_CARD, 'active evergreen shopping card');
  const id = string(card.id, 'shopping card ID');
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new TypeError('Invalid shopping card ID');
  return id;
}

/** Project only incomplete checklist entries; completed entries are not restock proof. */
export function projectShoppingChecklist({lists, cards, checklists} = {}) {
  const cardId = shoppingCardId({lists, cards});
  if (!Array.isArray(checklists)) throw new TypeError('Missing Trello checklists');
  const checklist = unique(checklists,
    x => x?.name === SHOPPING_CHECKLIST, 'evergreen shopping checklist');
  if (checklist.idCard !== undefined && checklist.idCard !== cardId)
    throw new TypeError('Shopping checklist belongs to another card');
  if (!Array.isArray(checklist.checkItems) || checklist.checkItems.length > 200)
    throw new TypeError('Invalid shopping checklist items');
  const items = [], seen = new Set();
  for (const raw of checklist.checkItems) {
    const item = object(raw, 'shopping checklist item');
    const id = string(item.id, 'shopping item ID');
    const name = string(item.name, 'shopping item name').trim();
    if (!/^[a-f0-9]{24}$/i.test(id) || seen.has(id) ||
        name.length > 120 || /[\r\n<>]/.test(name))
      throw new TypeError('Ambiguous shopping checklist item');
    seen.add(id);
    if (item.state !== 'complete' && item.state !== 'incomplete')
      throw new TypeError('Unknown shopping checklist item state');
    if (item.state === 'incomplete') items.push({id, name});
  }
  return items;
}
