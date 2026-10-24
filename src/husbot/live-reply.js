/**
 * TASK-017: deterministic one-channel Husbot replies.
 * Real Trello data is never sent to AI; status fields are authoritative.
 */
const CHANNEL = /^[CG][A-Z0-9]{8,}$/;
const TS = /^\d{9,15}\.\d{1,9}$/;
const BOT = /^xoxb-[A-Za-z0-9-]{10,}$/;

export function classifyMention(text) {
  if (typeof text !== 'string' || text.length > 2000) return null;
  const question = text.replace(/<@[UW][A-Z0-9]{8,}>(?:\s+\|[^>]+)?/g, ' ')
    .trim().toLocaleLowerCase('nb-NO').replace(/\s+/g, ' ');
  if (/^(ping|hei|hello|hi|bok|hej)[!?.\s]*$/.test(question)) return 'ping';
  if (/^(?:hva (?:trenger vi å kjøpe|må vi kjøpe|skal vi kjøpe|står på handlelisten)|što trebamo kupiti|sto trebamo kupiti|shopping)[!?.\s]*$/.test(question))
    return 'shopping';
  if (/^(?:hva (?:har vi (?:i inventar(?:et|en)|på lager)|er i inventar(?:et|en))|što imamo u inventaru|sto imamo u inventaru|inventar|inventory)[!?.\s]*$/.test(question))
    return 'inventory';
  return 'help';
}
function safeItem(item) {
  if (!item || typeof item.name !== 'string' || !item.name.trim() ||
      item.name.length > 120 || /[\r\n<>]/.test(item.name) ||
      !['ok', 'lav', 'kjøp'].includes(item.status))
    throw new Error('Inventory facts are ambiguous');
}
function shoppingKey(name) {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    .toLocaleLowerCase('nb-NO');
}
function shoppingAnswer(items, inventoryBuy) {
  if (!Array.isArray(items) || items.length > 200 ||
      new Set(items.map(x => x?.id)).size !== items.length)
    throw new Error('Shopping checklist snapshot invalid');
  const combined = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id ||
        typeof item.name !== 'string' || !item.name.trim() ||
        item.name.length > 120 || /[\r\n<>]/.test(item.name))
      throw new Error('Shopping checklist item ambiguous');
    const key = shoppingKey(item.name);
    if (combined.has(key)) throw new Error('Duplicate shopping checklist names');
    combined.set(key, {name: item.name.trim(), checklist: true, inventory: false});
  }
  for (const item of inventoryBuy) {
    const key = shoppingKey(item.name);
    const row = combined.get(key);
    if (row?.inventory) throw new Error('Duplicate inventory shopping names');
    if (row) row.inventory = true;
    else combined.set(key, {name: item.name.trim(), checklist: false, inventory: true});
  }
  if (!combined.size)
    return '🛒 Ingen varer på handlelisten eller merket KJØP i inventaret akkurat nå.';
  const rows = [...combined.values()].slice(0, 15).map(item =>
    '• ' + item.name + ' — ' +
    (item.checklist ? (item.inventory ? 'HANDLELISTE + KJØP' : 'HANDLELISTE') : 'KJØP'));
  const more = combined.size > 15 ? `\n…og ${combined.size - 15} til.` : '';
  const answer = `🛒 Må kjøpes (${combined.size}):\n${rows.join('\n')}${more}`;
  if (answer.length > 2000) throw new Error('Shopping answer exceeded limit');
  return answer;
}

export async function createAnswer(text, {readInventory} = {}) {
  const intent = classifyMention(text);
  if (!intent) throw new Error('Invalid Husbot question');
  if (intent === 'ping') return 'Hei! 👋 Husbot er på nett.';
  if (intent === 'help')
    return 'Jeg kan svare på: ping, inventar, eller «hva trenger vi å kjøpe?»';
  if (typeof readInventory !== 'function') throw new Error('Inventory reader unavailable');
  const facts = await readInventory({includeShoppingList: intent === 'shopping'});
  if (!facts || !Array.isArray(facts.inventory) || !Array.isArray(facts.shoppingAttention))
    throw new Error('Inventory snapshot invalid');
  const all = facts.inventory;
  if (all.length > 200 || new Set(all.map(x => x.id)).size !== all.length)
    throw new Error('Inventory snapshot is ambiguous');
  all.forEach(safeItem);
  const expected = all.filter(item => item.status === 'kjøp');
  if (expected.length !== facts.shoppingAttention.length ||
      expected.some(item => !facts.shoppingAttention.some(x => x.id === item.id)))
    throw new Error('Inventory attention mismatch');
  if (intent === 'shopping') return shoppingAnswer(facts.shoppingList, expected);
  if (!all.length) return '📦 Ingen registrerte inventarvarer akkurat nå.';
  const rows = all.slice(0, 15).map(item =>
    '• ' + item.name + ' — ' + item.status.toLocaleUpperCase('nb-NO'));
  const more = all.length > 15 ? `\n…og ${all.length - 15} til.` : '';
  const message = `📦 Inventar (${all.length}):\n${rows.join('\n')}${more}`;
  if (message.length > 2000) throw new Error('Inventory answer exceeded limit');
  return message;
}

export function createLiveSlackSender({
  enabled = false, botToken, approvedChannelId, fetchImpl = globalThis.fetch,
} = {}) {
  if (!CHANNEL.test(approvedChannelId ?? '') || typeof fetchImpl !== 'function')
    throw new TypeError('Invalid live Slack sender configuration');
  if (enabled !== true || !BOT.test(botToken ?? ''))
    throw new TypeError('Live Slack send not explicitly enabled with valid bot token');
  return async function postReply({channelId, threadTs}, answer) {
    if (channelId !== approvedChannelId || !TS.test(threadTs ?? '') ||
        typeof answer !== 'string' || !answer.trim() || answer.length > 2000)
      throw new Error('Slack reply target or content invalid');
    let response;
    try {
      response = await fetchImpl('https://slack.com/api/chat.postMessage', {
        method: 'POST', redirect: 'error',
        headers: {Authorization: 'Bearer ' + botToken,
          'Content-Type': 'application/json'},
        body: JSON.stringify({
          channel: approvedChannelId, thread_ts: threadTs, text: answer,
          mrkdwn: false, parse: 'none', link_names: false,
          unfurl_links: false, unfurl_media: false,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { throw new Error('Slack send outcome unknown; manual review required'); }
    if (response?.ok !== true)
      throw new Error('Slack send outcome unknown; manual review required');
    let reply;
    try { reply = await response.json(); }
    catch { throw new Error('Slack ACK invalid; manual review required'); }
    if (reply?.ok !== true || reply.channel !== approvedChannelId ||
        !TS.test(reply.ts ?? ''))
      throw new Error('Slack ACK ambiguous; manual review required');
    return 'sent';
  };
}
