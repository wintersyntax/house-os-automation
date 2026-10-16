/**
 * TASK-003: deterministic Daily Brief, plus a separate synthetic-fixture wrapper.
 * No network, Slack, AI, credentials, Trello writes or deployment.
 */
import { buildFacts, renderFallbackBrief } from './facts.js';

const PHASES = new Set(['beforePurchase', 'afterPurchase']);
// Keep a non-serializable, process-local issuance record. A bare
// dataClassification string is NOT proof of fixture provenance.
const issuedSyntheticBriefs = new WeakSet();

export function prepareDailyBrief(snapshot) {
  const facts = buildFacts(snapshot); // Missing or invalid facts must fail closed.
  const text = renderFallbackBrief(facts);
  if (text.length > 3000) {
    throw new TypeError('Deterministic brief exceeds the bounded output size');
  }
  return Object.freeze({
    kind: 'HOUSE_OS_DAILY_BRIEF',
    source: 'deterministic',
    asOf: facts.asOf,
    text,
  });
}

/**
 * Only explicitly fictional local fixtures can enter optional external adapters.
 * This marker is not an approval to transmit any real household data.
 */
export function prepareSyntheticBrief(fixture, phase = 'beforePurchase') {
  if (!fixture || fixture.kind !== 'SYNTHETIC_DEMO' ||
      typeof fixture.disclaimer !== 'string' ||
      !fixture.disclaimer.includes('fictional') ||
      !PHASES.has(phase) || !fixture.snapshots?.[phase]) {
    throw new TypeError('Only a recognized synthetic fixture phase may be previewed');
  }
  const brief = Object.freeze({
    ...prepareDailyBrief(fixture.snapshots[phase]),
    dataClassification: 'synthetic',
  });
  issuedSyntheticBriefs.add(brief);
  return brief;
}

export function isSyntheticBrief(brief) {
  return !!brief && typeof brief === 'object' &&
    issuedSyntheticBriefs.has(brief) &&
    brief.kind === 'HOUSE_OS_DAILY_BRIEF' &&
    brief.source === 'deterministic' &&
    brief.dataClassification === 'synthetic' &&
    /^\d{4}-\d{2}-\d{2}$/.test(brief.asOf ?? '') &&
    typeof brief.text === 'string' &&
    brief.text.length > 0 && brief.text.length <= 3000 &&
    brief.text.startsWith('House OS — dagsoversikt (' + brief.asOf + ')\n');
}
