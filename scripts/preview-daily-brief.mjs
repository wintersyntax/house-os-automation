#!/usr/bin/env node
/** Fixture-only local demo. Deliberately no optional provider integration. */
import { readFileSync } from 'node:fs';
import { prepareSyntheticBrief } from '../src/husbot/daily-brief.js';

try {
  if (process.argv.length > 3) throw Error('Choose beforePurchase or afterPurchase');
  const phase = process.argv[2] ?? 'beforePurchase';
  const fixture = JSON.parse(readFileSync(
    new URL('../examples/synthetic-household.json', import.meta.url), 'utf8',
  ));
  const brief = prepareSyntheticBrief(fixture, phase);
  console.log('SYNTHETIC DAILY BRIEF — local deterministic preview; NOT sent.');
  console.log(brief.text);
} catch {
  console.error('TASK-003 PREVIEW: RED — invalid synthetic fixture or phase');
  process.exitCode = 1;
}
