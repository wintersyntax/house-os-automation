/**
 * TASK-032 — lossless, read-only Shopping MVP overview.
 *
 * This is a DISPLAY projection from independently fetched Trello values,
 * not a single transactional snapshot or a purchase/stock transition.
 * Similar names are never proof of a shared inventory/checklist identity.
 */
const MAX_SOURCE_ROWS = 200;
const MAX_DISPLAY_ROWS = 12;
const MAX_MESSAGE = 2000;
// Butler can add [name](https://trello.com/c/shortId[/slug]) to checklist.
// Extract the human label for DISPLAY only: do not trust the link as an
// authoritative source-card ID or emit private Trello URLs into Slack.
const BUTLER_LINK = /^\[([^\]\r\n]{1,120})\]\(https:\/\/trello\.com\/c\/[A-Za-z0-9]{8}(?:\/[A-Za-z0-9_-]{1,100})?\)$/;
const CONTROLS = /[\x00-\x1F\x7F<>\u202A-\u202E\u2066-\u2069]/;

function visibleName(raw) {
  if (typeof raw !== 'string') throw new TypeError('Invalid shopping name');
  const trimmed = raw.trim();
  const match = BUTLER_LINK.exec(trimmed);
  const name = match ? match[1].trim() : trimmed;
  if (!name || name.length > 120 || CONTROLS.test(name))
    throw new TypeError('Unsafe or ambiguous shopping display name');
  // Non-canonical or suspicious embedded markdown/link should not be
  // presented as verified provenance, a URL, or an authoritative title.
  if (!match && /https?:\/\/|\[[^\]]+\]\(/i.test(trimmed))
    throw new TypeError('Unrecognized shopping link');
  return name;
}
function canonical(name) {
  return name.normalize('NFKC').replace(/\s+/gu, ' ').trim()
    .toLocaleLowerCase('nb-NO');
}
function rows(source, label) {
  if (!Array.isArray(source) || source.length > MAX_SOURCE_ROWS)
    throw new TypeError('Invalid ' + label + ' collection');
  const ids = new Set();
  return source.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.id !== 'string' || !item.id || ids.has(item.id))
      throw new TypeError('Ambiguous ' + label + ' identity');
    ids.add(item.id);
    const name = visibleName(item.name);
    return {name, normalized: canonical(name), label};
  });
}

/**
 * Always preserve one entry per source ID — even when names coincide.
 * Only incomplete checklist items belong in the caller's checklistItems;
 * a checked item is not evidence of purchased / delivered / restocked.
 */
export function createShoppingOverview({inventoryNeeds, checklistItems} = {}) {
  const manual = rows(checklistItems, 'HANDLELISTE');
  const stock = rows(inventoryNeeds, 'KJØP');
  const all = [...manual, ...stock];
  if (all.length === 0)
    return '🛒 Ingen varer på handlelisten eller merket KJØP i inventaret akkurat nå.';
  const counts = new Map();
  for (const row of all)
    counts.set(row.normalized, (counts.get(row.normalized) || 0) + 1);
  const collisions = [...counts.values()].filter(n => n > 1).length;
  const rendered = all.slice(0, MAX_DISPLAY_ROWS)
    .map(row => '• ' + row.name + ' — ' + row.label);
  const hidden = all.length - rendered.length;
  const header = '🛒 Må kjøpes (' + all.length + ' ' +
    (all.length === 1 ? 'registrering' : 'registreringer') + '):\n';
  const extra = hidden ? '\n…og ' + hidden + ' flere registreringer.' : '';
  const ambiguity = collisions ?
    '\n⚠️ ' + collisions + ' varenavn gjentas; identitet og eventuell dobbelttelling er ikke bekreftet.' : '';
  const caveat = '\nTrello-øyeblikksbilde (flere GET); ikke bekreftet kjøp eller levering.';
  const result = header + rendered.join('\n') + extra + ambiguity + caveat;
  if (result.length > MAX_MESSAGE)
    throw new TypeError('Shopping overview exceeded safe reply limit');
  return result;
}
