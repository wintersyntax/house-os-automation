/**
 * TASK-004 — provisional, pure cleaning cycle decision model.
 *
 * Inputs/outputs use fictional stable IDs; no Make, Trello, HTTP, Slack,
 * Firestore, Cloud credentials or side effects. This models the documented
 * cleaning contract, NOT verified byte-for-byte Make BATCHED v3 parity.
 *
 * The owner-provided private Make blueprint was inspected under TASK-004.
 * Live Make execution outcome evidence is still missing: do not promote
 * any model proposal into provider writes or parity authority.
 */
const ID = /^[a-z0-9_-]{1,40}$/;
const DATE = /^(20\d\d)-(\d\d)-(\d\d)$/;
const STAGES = new Set(['unseen', 'processing', 'completed']);
// Previous completed routine's assignment-mode custom field, NOT a global
// rotation_state. The blueprint checks old-card Balansekorrigert before >5.
const PREVIOUS_ASSIGNMENTS = new Set(['Normal', 'Balansekorrigert']);
const STATUS = new Set(['Aktiv', 'Borte']);

// TASK-138 (owner decision 2026-11-02): at most two open rooms per resident while at least three residents are
// active (six rooms, two each), otherwise three; if everyone active is full the inherited rotation still applies.
const roomCap = activeCount => activeCount >= 3 ? 2 : 3;
export const CLEANING_ZONES = Object.freeze({
  'Kjøkken': Object.freeze({points: 5, startOffsetDays: 5, dueOffsetDays: 7}),
  'Bad 1': Object.freeze({points: 4, startOffsetDays: 5, dueOffsetDays: 7}),
  'Bad 2': Object.freeze({points: 3, startOffsetDays: 8, dueOffsetDays: 10}),
  'WC': Object.freeze({points: 3, startOffsetDays: 5, dueOffsetDays: 7}),
  'Stue + Spisestue': Object.freeze({points: 2, startOffsetDays: 11, dueOffsetDays: 14}),
  'Gang': Object.freeze({points: 1, startOffsetDays: 17, dueOffsetDays: 21}),
});

function object(x, label) {
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw new TypeError('Invalid ' + label);
  return x;
}
function exactly(x, keys, label) {
  if (Object.keys(x).sort().join(',') !== keys.slice().sort().join(','))
    throw new TypeError('Unexpected fields in ' + label);
}
function memberId(x) {
  if (typeof x !== 'string' || !ID.test(x))
    throw new TypeError('Invalid fictional resident identity');
  return x;
}
function count(x, label) {
  // Canonical Master documents blank numeric Trello fields as zero.
  if (x === '' || x === null || x === undefined) return 0;
  if (!Number.isSafeInteger(x) || x < 0 || x > 1_000_000_000)
    throw new TypeError('Invalid ' + label);
  return x;
}
// TASK-137: cleaning points may be negative (overdue deductions); credits and counters may not.
function signed(x, label) {
  if (x === '' || x === null || x === undefined) return 0;
  if (!Number.isSafeInteger(x) || x < -1_000_000_000 || x > 1_000_000_000)
    throw new TypeError('Invalid ' + label);
  return x;
}
function cleanDate(x) {
  if (typeof x !== 'string' || !DATE.test(x))
    throw new TypeError('Invalid local completion date');
  const [, year, month, day] = x.match(DATE).map(Number);
  const ms = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 10) !== x)
    throw new TypeError('Impossible local completion date');
  return ms;
}
function advance(ms, days) {
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}
function residentsOf(raw) {
  if (!Array.isArray(raw) || raw.length !== 6)
    throw new TypeError('Exactly six ordered fictional resident records required');
  const seen = new Set();
  return raw.map(row => {
    const r = object(row, 'resident');
    // TASK-120: optional points of the open routine cards this resident already holds in other rooms.
    const open = Object.hasOwn(r, 'openPoints'), rooms = Object.hasOwn(r, 'openRooms');
    exactly(r, ['id', 'status', 'points', 'credits', 'skipped', ...(open ? ['openPoints'] : []), ...(rooms ? ['openRooms'] : [])], 'resident');
    const id = memberId(r.id);
    if (seen.has(id) || !STATUS.has(r.status))
      throw new TypeError('Duplicate identity or invalid active status');
    seen.add(id);
    return {id, status: r.status,
      points: signed(r.points, 'cleaning points'),
      credits: count(r.credits, 'rotation credits'),
      skipped: count(r.skipped, 'skipped rotation count'),
      ...(open ? {openPoints: count(r.openPoints, 'open routine card points')} : {}),
      ...(rooms ? {openRooms: count(r.openRooms, 'open routine card count')} : {})};
  });
}
function outcome(kind, reason) {
  return Object.freeze({kind, reason, authority: 'PROVISIONAL_DOCUMENTED_ONLY'});
}

/**
 * NO_ACTION: independently supplied "completed" idempotency snapshot.
 * REVIEW: in-progress / all-away / invalid workflow precondition.
 * PROPOSE_CYCLE: read-only proposed values, NEVER safe provider commands.
 *
 * Previous assignment mode is read from the *completed routine card*.
 * This is blueprint-derived, whereas actual runtime parity and failure
 * behavior still require separately captured Make execution observations.
 */
export function planCleaningCycle(raw) {
  const v = object(raw, 'cleaning cycle input');
  // TASK-166 (owner decisions 2026-11-04): an optional handover — the holder went Borte before the room's due day, so
  // the open card goes to the next resident: `completedById` is the away holder, `completionDate` the handover day, and
  // the card is not completed. The holder books no points but is skipped like any Borte resident (+1 credit, +1 skip).
  const handover = Object.hasOwn(v, 'handover');
  exactly(v, ['cardId', 'zone', 'completionDate', 'completedById',
    'stage', 'isCompletedCard', 'previousAssignmentMode', 'residents', ...(handover ? ['handover'] : [])], 'cycle input');
  if (handover && v.handover !== true) throw new TypeError('Invalid handover flag');
  const cardId = memberId(v.cardId);
  const zone = CLEANING_ZONES[v.zone];
  if (!Object.hasOwn(CLEANING_ZONES, v.zone) || !zone)
    throw new TypeError('Unknown six-zone cleaning routine');
  const dateMs = cleanDate(v.completionDate);
  const completedById = memberId(v.completedById);
  if (!STAGES.has(v.stage) || typeof v.isCompletedCard !== 'boolean' ||
      !PREVIOUS_ASSIGNMENTS.has(v.previousAssignmentMode))
    throw new TypeError('Invalid completion stage or rotation state');
  const residents = residentsOf(v.residents);
  const prior = residents.findIndex(x => x.id === completedById);
  if (prior === -1)
    throw new TypeError('Completed by a foreign resident');
  if (handover && v.isCompletedCard)
    return outcome('REVIEW', 'HANDOVER_CARD_ALREADY_COMPLETED');
  if (handover && residents[prior].status !== 'Borte')
    return outcome('REVIEW', 'HANDOVER_HOLDER_NOT_AWAY');
  if (!handover && !v.isCompletedCard)
    return outcome('REVIEW', 'OLD_CARD_NOT_COMPLETED');
  if (v.stage === 'completed')
    return outcome('NO_ACTION', 'ALREADY_PROCESSED_IDEMPOTENTLY');
  if (v.stage === 'processing')
    return outcome('REVIEW', 'PARTIAL_PROCESSING_REQUIRES_PROGRESS_RECONCILIATION');

  // A genuine all-away case must not book points or any Borte credits.
  const active = residents.filter(x => x.status === 'Aktiv');
  if (!active.length)
    return outcome('REVIEW', 'ALL_AWAY_NO_OPERATIONAL_WRITES');

  const next = (prior + 1) % residents.length;
  const nominee = residents[next];
  // TASK-129 (owner decision 2026-11-01): with the Routine room counts supplied, a resident who already holds
  // the cap of open rooms (roomCap) is passed over (without a Borte credit) while someone else can take the room; if everyone
  // active is at the cap, the inherited rotation applies unchanged.
  const capped = residents.some(row => Object.hasOwn(row, 'openRooms'));
  const cap = roomCap(active.length);
  const full = row => capped && (row.openRooms ?? 0) >= cap;
  const rotate = useCap => {
    const skipped = [];
    for (let offset = 1; offset <= residents.length; offset++) {
      const row = residents[(prior + offset) % residents.length];
      if (row.status === 'Borte') {
        skipped.push(row.id);
        continue;
      }
      if (useCap && full(row)) continue;
      return {id: row.id, skipped};
    }
    return null;
  };
  const rotation = rotate(true) ?? rotate(false);
  // A handover's away holder is skipped first, like the Borte residents after it.
  const skippedIds = rotation ? [...(handover ? [completedById] : []), ...rotation.skipped] : [];
  const normalCandidate = rotation ? rotation.id : null;
  if (normalCandidate === null)
    return outcome('REVIEW', 'ALL_AWAY_NO_OPERATIONAL_WRITES');

  // The documented Make contract books effort to the completer before
  // reading the active score gap. This is a value proposal, not a write.
  const expectedPoints = residents.map(row => ({
    ...row,
    proposedPoints: row.points + (row.id === completedById && !handover ? zone.points : 0),
  }));
  if (expectedPoints.some(x => !Number.isSafeInteger(x.proposedPoints) ||
      x.proposedPoints > 1_000_000_000 || x.proposedPoints < -1_000_000_000))
    throw new TypeError('Cleaning points overflow');
  const activeAfter = expectedPoints.filter(x => x.status === 'Aktiv');
  const pointValues = activeAfter.map(x => x.proposedPoints);
  const gap = Math.max(...pointValues) - Math.min(...pointValues);
  let selectedId = normalCandidate;
  let allocation = 'Normal';
  if (gap > 5 && v.previousAssignmentMode === 'Normal') {
    // TASK-120 (owner decision 2026-10-31): the gap still reads booked points, but the correction goes to the
    // active resident with the lowest booked points plus points of open routine cards already held, so a
    // resident with open rooms and no completion yet does not receive every correction. Without openPoints
    // (every earlier caller) the load equals the booked points, exactly as before.
    const load = row => row.proposedPoints + (row.openPoints ?? 0);
    // TASK-123 (owner decision 2026-10-31): with the Routine load rule (open points supplied) the resident who
    // just completed this room is never its correction pick while another active resident exists.
    const routineLoad = residents.some(row => Object.hasOwn(row, 'openPoints'));
    const pool = activeAfter.filter(row => !routineLoad || row.id !== completedById);
    const candidates = pool.length ? pool : activeAfter;
    const lowest = Math.min(...candidates.map(load));
    // TASK-138 (owner decision 2026-11-02): the correction goes only to a truly lowest resident (ties follow the
    // nominal forward circular order). If every lowest resident is already full, the room follows the normal
    // rotation and no correction is used, so the next completion can still correct.
    for (let offset = 1; offset <= residents.length; offset++) {
      const row = expectedPoints[(prior + offset) % residents.length];
      if (row.status === 'Aktiv' && candidates.includes(row) && load(row) === lowest && !full(row)) {
        selectedId = row.id;
        allocation = 'Balansekorrigert';
        break;
      }
    }
  }
  // Blueprint module 13 prevents a consecutive correction by inspecting
  // previous routine-card assignment mode. Module 21 stamps this new mode
  // on the newly generated routine; no shared rotation_state is consulted.
  const window = {
    startDate: advance(dateMs, zone.startOffsetDays),
    dueDate: advance(dateMs, zone.dueOffsetDays),
  };

  return Object.freeze({
    kind: 'PROPOSE_CYCLE',
    authority: 'PROVISIONAL_DOCUMENTED_ONLY',
    cardId, zone: v.zone, completionDate: v.completionDate,
    effortPoints: zone.points,
    nominalResidentId: nominee.id,
    selectedResidentId: selectedId,
    normalSuccessorId: normalCandidate,
    skippedResidentIds: Object.freeze(skippedIds),
    completionPoints: Object.freeze({residentId: completedById,
      delta: handover ? 0 : zone.points}),
    ...(handover ? {handover: true} : {}),
    skippedCreditDeltas: Object.freeze(skippedIds.map(id =>
      Object.freeze({residentId: id, creditDelta: 1, skippedDelta: 1}))),
    pointGapAfterBooking: gap,
    allocation,
    previousAssignmentMode: v.previousAssignmentMode,
    ...window,
  });
}
