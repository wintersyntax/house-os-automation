/** Strict GET-only Trello reader. No webhook, writes, retry loop or secret logging. */
import { projectInventory, inventoryAttention, shoppingCardId, projectShoppingChecklist }
  from './inventory.js';

const API = 'https://api.trello.com';
function credential(v, label) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(v))
    throw new TypeError('Missing or invalid ' + label);
  return v;
}

export function createReader({ key, token, boardId, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const apiKey = credential(key, 'Trello API key');
  const apiToken = credential(token, 'Trello read token');
  if (typeof boardId !== 'string' || !/^[a-f0-9]{24}$/i.test(boardId))
    throw new TypeError('Invalid Trello board ID');
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 || timeoutMs > 30000)
    throw new TypeError('Invalid Trello read configuration');

  const authorization = 'OAuth oauth_consumer_key="' + apiKey +
    '", oauth_token="' + apiToken + '"';
  async function read(path, search = {}) {
    const url = new URL(path, API);
    for (const [k,v] of Object.entries(search)) url.searchParams.set(k, v);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: authorization, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new Error('Trello GET transport unavailable');
    }
    if (!response || response.ok !== true) {
      const code = Number.isInteger(response?.status) ? response.status : 'unknown';
      throw new Error('Trello GET refused (HTTP ' + code + ')');
    }
    try { return await response.json(); }
    catch { throw new Error('Malformed Trello GET response'); }
  }

  return async function readInventory({includeShoppingList = false} = {}) {
    if (typeof includeShoppingList !== 'boolean')
      throw new TypeError('Invalid shopping read option');
    const base = '/1/boards/' + boardId;
    const [lists, fields, cards] = await Promise.all([
      read(base + '/lists', { fields: 'id,name', filter: 'open' }),
      read(base + '/customFields'),
      read(base + '/cards',
        { fields: 'id,name,idList,closed', filter: 'open', customFieldItems: 'true' }),
    ]);
    const inventory = projectInventory({lists, fields, cards});
    const facts = {inventory, shoppingAttention: inventoryAttention(inventory)};
    // The existing inventory-only probe still makes exactly three GETs.
    // Only the explicitly requested shopping command performs the fourth.
    if (!includeShoppingList) return facts;
    const cardId = shoppingCardId({lists, cards});
    const checklists = await read('/1/cards/' + cardId + '/checklists',
      {checkItems: 'all'});
    return {...facts, shoppingList: projectShoppingChecklist({lists, cards, checklists})};
  };
}
