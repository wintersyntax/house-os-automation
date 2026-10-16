/**
 * Pure, read-only fact extraction for Husbot v1.
 *
 * The input is a normalized snapshot (currently a synthetic fixture).
 * No Trello writes, network requests, LLM calls, credentials, or side effects.
 * Adapters for live Trello data belong outside this module.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CAPTURED_AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

function requireString(value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Invalid or missing string at ${path}`);
  }
  return value;
}

function requireList(snapshot, key) {
  if (!Array.isArray(snapshot[key])) {
    throw new TypeError(`Missing or invalid ${key} collection`);
  }
  return snapshot[key];
}

// Do not use Date.parse to validate calendar days: JavaScript may normalize
// nonexistent dates (e.g. 2026-02-30) instead of rejecting them.
function validCalendarDate(value) {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, date] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || date < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date <= daysPerMonth[month - 1];
}

function day(value, path) {
  requireString(value, path);
  if (!validCalendarDate(value)) {
    throw new TypeError(`Invalid calendar date at ${path}`);
  }
  return value;
}

function captureDay(capturedAt) {
  requireString(capturedAt, 'capturedAt');
  const match = CAPTURED_AT.exec(capturedAt);
  if (!match || !validCalendarDate(match[1])) {
    throw new TypeError('capturedAt must be a valid ISO timestamp with a timezone');
  }

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = match[6] ? Number(match[7]) : 0;
  const offsetMinute = match[6] ? Number(match[8]) : 0;
  if (hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 14 || offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0) ||
      Number.isNaN(Date.parse(capturedAt))) {
    throw new TypeError('capturedAt must be a valid ISO timestamp with a timezone');
  }
  // Preserve the household's calendar day, not the UTC date after conversion.
  return match[1];
}

function itemIdentity(item, path) {
  if (!item || typeof item !== 'object') {
    throw new TypeError(`Invalid item at ${path}`);
  }
  return {
    id: requireString(item.id, `${path}.id`),
    name: requireString(item.name, `${path}.name`),
  };
}

function normalizedStatus(status, path) {
  return requireString(status, path).trim().toLocaleLowerCase('nb-NO');
}

/**
 * Derive facts only from supplied state; never invent missing information.
 * Returns new objects, leaving input data unchanged.
 */
export function buildFacts(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('House OS snapshot must be an object');
  }

  const asOf = captureDay(snapshot.capturedAt);
  const chores = requireList(snapshot, 'chores');
  const away = requireList(snapshot, 'away');
  const homeIssues = requireList(snapshot, 'homeIssues');
  const inventory = requireList(snapshot, 'inventory');

  const choresDueToday = [];
  const overdue = [];
  for (const [index, chore] of chores.entries()) {
    const path = `chores[${index}]`;
    const record = itemIdentity(chore, path);
    const dueDate = day(chore.dueDate, `${path}.dueDate`);
    const status = normalizedStatus(chore.status, `${path}.status`);
    if (!['open', 'done', 'closed', 'complete', 'completed', 'fullført'].includes(status)) {
      throw new TypeError(`Unrecognized chore status at ${path}.status`);
    }
    if (status !== 'open') continue;
    const fact = { ...record, dueDate };
    if (dueDate === asOf) choresDueToday.push(fact);
    if (dueDate < asOf) overdue.push(fact);
  }

  const awayResidents = [];
  for (const [index, person] of away.entries()) {
    const path = `away[${index}]`;
    if (!person || typeof person !== 'object') {
      throw new TypeError(`Invalid away entry at ${path}`);
    }
    const residentId = requireString(person.residentId, `${path}.residentId`);
    const status = normalizedStatus(person.status, `${path}.status`);
    if (status === 'borte') {
      const through = day(person.awayThroughDateInclusive, `${path}.awayThroughDateInclusive`);
      if (through >= asOf) awayResidents.push({ residentId, through });
    }
  }

  const urgentIssues = [];
  for (const [index, issue] of homeIssues.entries()) {
    const path = `homeIssues[${index}]`;
    const record = itemIdentity(issue, path);
    const priority = normalizedStatus(issue.priority, `${path}.priority`);
    const status = normalizedStatus(issue.status, `${path}.status`);
    if (priority === 'haster' && !['ferdig', 'løst', 'closed', 'resolved'].includes(status)) {
      urgentIssues.push(record);
    }
  }

  // Inventory status is the sole authority for buy-now alerts. A checked
  // item or an empty evergreen Next Trip checklist does not prove a purchase,
  // payment or restock. Shopping/checklist state is intentionally not read here.
  const shoppingAttention = [];
  for (const [index, product] of inventory.entries()) {
    const path = `inventory[${index}]`;
    const record = itemIdentity(product, path);
    const status = normalizedStatus(product.status, `${path}.status`);
    if (!['ok', 'lav', 'kjøp'].includes(status)) {
      throw new TypeError(`Unrecognized inventory status at ${path}.status`);
    }
    if (status === 'kjøp') shoppingAttention.push(record);
  }

  return {
    asOf,
    choresDueToday,
    overdue,
    awayResidents,
    urgentIssues,
    shoppingAttention,
  };
}

/** Deterministic fallback when OpenRouter is unavailable. */
export function renderFallbackBrief(facts) {
  if (!facts || typeof facts !== 'object') {
    throw new TypeError('Validated facts are required');
  }
  const sections = [
    ['Rengjøring i dag', facts.choresDueToday, (item) => item.name],
    ['Forsinket rengjøring', facts.overdue, (item) => item.name],
    ['Borte', facts.awayResidents, (person) => person.residentId],
    ['Haster', facts.urgentIssues, (issue) => issue.name],
    ['Må kjøpes', facts.shoppingAttention, (item) => item.name],
  ];

  const lines = [`House OS — dagsoversikt (${day(facts.asOf, 'facts.asOf')})`];
  for (const [title, items, describe] of sections) {
    if (!Array.isArray(items)) {
      throw new TypeError(`Missing facts collection: ${title}`);
    }
    lines.push(`${title}: ${items.length ? items.map(describe).join(', ') : 'Ingen'}`);
  }
  return lines.join('\n');
}
