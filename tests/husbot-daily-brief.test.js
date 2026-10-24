import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { prepareDailyBrief, prepareSyntheticBrief, isSyntheticBrief } from '../src/husbot/daily-brief.js';
import { requestSyntheticWordingDraft } from '../src/husbot/openrouter-draft.js';
import { postSyntheticTestBrief } from '../src/husbot/slack-test.js';

const fixture = JSON.parse(readFileSync(
  new URL('../examples/synthetic-household.json', import.meta.url), 'utf8',
));
const before = () => prepareSyntheticBrief(fixture, 'beforePurchase');
const after = () => prepareSyntheticBrief(fixture, 'afterPurchase');
const token = 'xoxb-portfolio-synthetic-placeholder';
const channel = 'C123ABC456';

function response(payload, ok = true) {
  return { ok, async json() { return payload; } };
}

test('TASK-003: fixture preview is deterministic, read-only and reflects purchases', () => {
  const original = structuredClone(fixture);
  const first = before(), second = before(), finished = after();
  assert.deepEqual(first, second);
  assert.equal(first.kind, 'HOUSE_OS_DAILY_BRIEF');
  assert.equal(first.source, 'deterministic');
  assert.equal(first.dataClassification, 'synthetic');
  assert.ok(Object.isFrozen(first));
  assert.match(first.text, /Rengjøring i dag: Kjøkken/);
  assert.match(first.text, /Borte: resident-oliver/);
  assert.match(first.text, /Haster: Lekkasjen under kjøkkenvasken/);
  assert.match(first.text, /Må kjøpes: Oppvasktabletter/);
  assert.match(finished.text, /Må kjøpes: Ingen/);
  assert.doesNotMatch(finished.text, /Oppvasktabletter|Håndsåpe/);
  assert.deepEqual(fixture, original, 'preparation must never change source');
});

test('TASK-003: empty valid sources remain truthful, missing or invalid fields are RED', () => {
  const empty = prepareDailyBrief({
    capturedAt: '2026-10-14T08:00:00+02:00',
    chores: [], away: [], homeIssues: [], inventory: [],
  });
  assert.equal(empty.source, 'deterministic');
  assert.match(empty.text, /Må kjøpes: Ingen/);
  assert.throws(() => prepareDailyBrief({ capturedAt: '2026-10-14T08:00:00+02:00' }),
    /Missing or invalid chores/);
  const broken = structuredClone(fixture.snapshots.beforePurchase);
  broken.inventory[0].status = 'unknown';
  assert.throws(() => prepareDailyBrief(broken), /Unrecognized inventory status/);
  const long = structuredClone(fixture.snapshots.beforePurchase);
  long.chores[0].name = 'x'.repeat(3200);
  assert.throws(() => prepareDailyBrief(long), /bounded output size/);
});

test('TASK-003: external preview marker rejects nonfictional data and invalid phase', () => {
  assert.throws(() => prepareSyntheticBrief({}, 'beforePurchase'), /synthetic/);
  assert.throws(() => prepareSyntheticBrief({ ...fixture, kind: 'LIVE_DATA' }), /synthetic/);
  assert.throws(() => prepareSyntheticBrief({ ...fixture, disclaimer: 'unknown' }), /synthetic/);
  assert.throws(() => prepareSyntheticBrief(fixture, 'otherPhase'), /synthetic/);
});

test('TASK-003: local CLI preview requires no API or Slack configuration and never sends', () => {
  const script = new URL('../scripts/preview-daily-brief.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname, 'beforePurchase'],
    { encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYNTHETIC DAILY BRIEF/);
  assert.match(result.stdout, /Må kjøpes: Oppvasktabletter/);
  const invalid = spawnSync(process.execPath, [script.pathname, 'LIVE'],
    { encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH } });
  assert.notEqual(invalid.status, 0);
  assert.doesNotMatch(invalid.stderr, /xoxb-|Authorization:|Bearer/);
});

test('TASK-003: OpenRouter disabled, unapproved or missing config never makes a request', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw Error('Must not call network'); };
  assert.deepEqual(await requestSyntheticWordingDraft(before(), { fetchImpl }),
    { state: 'disabled', draft: null });
  assert.deepEqual(await requestSyntheticWordingDraft(before(), { enabled: true, fetchImpl }),
    { state: 'approval_required', draft: null });
  assert.deepEqual(await requestSyntheticWordingDraft(before(), {
    enabled: true, approvedSyntheticRequest: true, fetchImpl,
  }), { state: 'not_configured', draft: null });
  assert.deepEqual(await requestSyntheticWordingDraft(
    prepareDailyBrief(fixture.snapshots.beforePurchase), {
      enabled: true, approvedSyntheticRequest: true, apiKey: 'synthetic', model: 'a/b', fetchImpl,
    }), { state: 'synthetic_only', draft: null });
  assert.equal(calls, 0);
});

test('TASK-003: bounded OpenRouter request is a draft only; facts remain authoritative', async () => {
  const prepared = before();
  let calls = 0;
  const result = await requestSyntheticWordingDraft(prepared, {
    enabled: true, approvedSyntheticRequest: true,
    apiKey: 'synthetic-test-key', model: 'example/model',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-key');
      assert.equal(options.signal.aborted, false);
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false);
      assert.equal(body.temperature, 0);
      assert.equal(body.max_tokens, 160);
      assert.equal(body.messages.length, 2);
      assert.match(body.messages[1].content, /SYNTHETIC FIXTURE/);
      assert.match(body.messages[1].content, /Må kjøpes: Oppvasktabletter/);
      return response({ choices: [{
        finish_reason: 'stop', message: { content: 'Hei fra Husbot!' },
      }] });
    },
  });
  assert.deepEqual(result, { state: 'draft_only', draft: 'Hei fra Husbot!' });
  assert.equal(calls, 1);
  assert.equal(prepared.text, before().text);
  assert.doesNotMatch(prepared.text, /Hei fra Husbot/);
});

test('TASK-003: provider errors, corrupted and truncated AI output never replace fallback', async () => {
  const common = {
    enabled: true, approvedSyntheticRequest: true,
    apiKey: 'synthetic-test-key', model: 'example/model',
  };
  for (const fetchImpl of [
    async () => { throw Error('sensitive-provider-network-diagnostics'); },
    async () => response({}, false),
    async () => response({ choices: [] }),
    async () => response({ choices: [{ finish_reason: 'length',
      message: { content: 'Incomplete' } }] }),
    async () => response({ choices: [{ finish_reason: 'stop',
      message: { content: 'x'.repeat(401) } }] }),
    async () => ({ ok: true, json: async () => { throw Error('bad JSON'); } }),
  ]) {
    const result = await requestSyntheticWordingDraft(before(), { ...common, fetchImpl });
    assert.deepEqual(result, { state: 'unavailable', draft: null });
    assert.doesNotMatch(JSON.stringify(result), /sensitive-provider/);
  }
  assert.match(before().text, /Må kjøpes: Oppvasktabletter/);
});

test('TASK-003: OpenRouter invalid model and oversize credential fail before network', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw Error('Network forbidden'); };
  for (const model of ['latest', '', 'https://evil.example/path', 'foo/../../bar']) {
    const r = await requestSyntheticWordingDraft(before(), {
      enabled: true, approvedSyntheticRequest: true,
      apiKey: 'synthetic', model, fetchImpl,
    });
    assert.ok(['not_configured', 'invalid_configuration'].includes(r.state), model);
  }
  const r = await requestSyntheticWordingDraft(before(), {
    enabled: true, approvedSyntheticRequest: true,
    apiKey: 'x'.repeat(301), model: 'example/model', fetchImpl,
  });
  assert.equal(r.state, 'invalid_configuration');
  assert.equal(calls, 0);
});

test('TASK-003: Slack disabled, unapproved or missing config makes no request', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw Error('Must not call'); };
  assert.deepEqual(await postSyntheticTestBrief(before(), { fetchImpl }), { state: 'disabled' });
  assert.deepEqual(await postSyntheticTestBrief(before(), { enabled: true, fetchImpl }),
    { state: 'approval_required' });
  assert.deepEqual(await postSyntheticTestBrief(before(), {
    enabled: true, approvedTestSend: true, fetchImpl,
  }), { state: 'not_configured' });
  assert.equal(calls, 0);
});

test('TASK-003: Slack rejects DMs, non-approved channels and non-synthetic or AI text', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw Error('Must not call'); };
  const common = { enabled: true, approvedTestSend: true, botToken: token,
    testChannelId: channel, approvedTestChannelId: channel, fetchImpl };
  assert.deepEqual(await postSyntheticTestBrief(
    prepareDailyBrief(fixture.snapshots.beforePurchase), common), { state: 'synthetic_only' });
  assert.deepEqual(await postSyntheticTestBrief({ ...before(), source: 'ai' }, common),
    { state: 'synthetic_only' });
  for (const testChannelId of ['U123ABC456', 'D123ABC456', '#general', 'C555ABC123']) {
    assert.deepEqual(await postSyntheticTestBrief(before(), { ...common, testChannelId }),
      { state: 'invalid_configuration' });
  }
  assert.equal(calls, 0);
});

test('TASK-003: approved Slack test transport sends only labeled deterministic brief once', async () => {
  let calls = 0;
  const brief = before();
  const result = await postSyntheticTestBrief(brief, {
    enabled: true, approvedTestSend: true,
    botToken: token, testChannelId: channel, approvedTestChannelId: channel,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://slack.com/api/chat.postMessage');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer ' + token);
      const body = JSON.parse(options.body);
      assert.equal(body.channel, channel);
      assert.equal(body.text, '[SYNTHETIC TEST — NOT REAL HOUSEHOLD DATA]\n' + brief.text);
      assert.equal(body.mrkdwn, false);
      assert.equal(body.parse, 'none');
      assert.equal(body.link_names, false);
      assert.equal(body.unfurl_links, false);
      assert.equal(body.unfurl_media, false);
      assert.equal(options.signal.aborted, false);
      return response({ ok: true, channel, ts: '1700000000.000123' });
    },
  });
  assert.deepEqual(result, { state: 'sent_test' });
  assert.equal(calls, 1);
});

test('TASK-003: Slack API, timeout and ambiguous ACK failures are never falsely sent', async () => {
  const common = {
    enabled: true, approvedTestSend: true,
    botToken: token, testChannelId: channel, approvedTestChannelId: channel,
  };
  for (const fetchImpl of [
    async () => { throw Error('private-provider-secret-response'); },
    async () => response({ ok: false, error: 'not_in_channel' }),
    async () => response({ ok: true, channel: 'C999AAA888', ts: '1700.001' }),
    async () => response({ ok: true, channel, ts: null }),
    async () => response({ ok: true, channel, ts: '1700.001' }, false),
    async () => ({ ok: true, json: async () => { throw Error('JSON read'); } }),
  ]) {
    let calls = 0;
    const result = await postSyntheticTestBrief(before(), {
      ...common, fetchImpl: (...args) => { calls++; return fetchImpl(...args); },
    });
    assert.deepEqual(result, { state: 'unavailable' });
    assert.equal(calls, 1, 'must not retry an ambiguous post');
    assert.doesNotMatch(JSON.stringify(result), /not_in_channel|private-provider/);
  }
});

test('TASK-003: forged or serialized synthetic markers cannot authorize provider egress', async () => {
  const issued = before();
  assert.equal(isSyntheticBrief(issued), true);
  const forgedBriefs = [
    { ...issued },
    structuredClone(issued),
    JSON.parse(JSON.stringify(issued)),
    {
      kind: 'HOUSE_OS_DAILY_BRIEF',
      source: 'deterministic',
      dataClassification: 'synthetic',
      asOf: issued.asOf,
      text: issued.text.replace('Må kjøpes:', 'FAKE private household: Må kjøpes:'),
    },
  ];

  let calls = 0;
  const noNetwork = () => { calls++; throw new Error('unapproved provider call'); };
  for (const forged of forgedBriefs) {
    assert.equal(isSyntheticBrief(forged), false);
    const ai = await requestSyntheticWordingDraft(forged, {
      enabled: true, approvedSyntheticRequest: true,
      apiKey: 'synthetic-test-key', model: 'example/model',
      fetchImpl: noNetwork,
    });
    assert.deepEqual(ai, { state: 'synthetic_only', draft: null });
    const slack = await postSyntheticTestBrief(forged, {
      enabled: true, approvedTestSend: true,
      botToken: token, testChannelId: channel,
      approvedTestChannelId: channel, fetchImpl: noNetwork,
    });
    assert.deepEqual(slack, { state: 'synthetic_only' });
  }
  assert.equal(calls, 0);
});
