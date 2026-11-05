import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createSlackEventsIngress, verifySlackSignature } from '../src/husbot/slack-events.js';
import { createSlackHttpServer } from '../src/husbot/slack-http.js';

const signingSecret = 'synthetic-slack-signing-secret-32-bytes';
const fixedNow = 1760500800;
const appId = 'A123ABC456', teamId = 'T123ABC456', channelId = 'C123ABC456';

function eventPayload(overrides = {}) {
  return {
    type: 'event_callback',
    api_app_id: appId,
    team_id: teamId,
    event_id: 'Ev123ABC456',
    event: {
      type: 'app_mention',
      user: 'U123ABC456',
      channel: channelId,
      text: '<@U222ABC333> hva må vi kjøpe?',
      ts: '1760500800.000012',
      ...overrides.event,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'event')),
  };
}

function signed(payload, options = {}) {
  const timestamp = options.timestamp ?? fixedNow;
  const rawBody = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const signature = 'v0=' + createHmac('sha256', signingSecret)
    .update(Buffer.concat([Buffer.from('v0:' + timestamp + ':'), rawBody]))
    .digest('hex');
  return {
    method: 'POST',
    headers: {
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': signature,
      'content-type': 'application/json',
    },
    rawBody,
  };
}
function ingress(enqueue = async () => ({ durability: 'durable', state: 'stored' }), options = {}) {
  return createSlackEventsIngress({
    signingSecret, appId, teamId, approvedChannelId: channelId,
    nowSeconds: () => fixedNow, enqueue, ...options,
  });
}

test('TASK-012: valid raw-byte HMAC signature with fixed timestamp', () => {
  const r = signed(eventPayload());
  assert.equal(verifySlackSignature({
    rawBody: r.rawBody, headers: r.headers, signingSecret, nowSeconds: fixedNow,
  }), true);
  assert.equal(verifySlackSignature({
    rawBody: Buffer.concat([r.rawBody, Buffer.from(' ')]),
    headers: r.headers, signingSecret, nowSeconds: fixedNow,
  }), false, 'Even whitespace byte changes must invalidate signature');
  assert.equal(verifySlackSignature({
    rawBody: r.rawBody,
    headers: { ...r.headers, 'x-slack-signature': 'v0=' + 'f'.repeat(64) },
    signingSecret, nowSeconds: fixedNow,
  }), false);
});

test('TASK-012: rejects stale/future, malformed and absent signature/timestamp', async () => {
  const h = ingress();
  for (const r of [
    signed(eventPayload(), { timestamp: fixedNow - 301 }),
    signed(eventPayload(), { timestamp: fixedNow + 301 }),
    { ...signed(eventPayload()), headers: {} },
    { ...signed(eventPayload()), headers: { 'x-slack-request-timestamp': 'not-date' } },
    { ...signed(eventPayload()), headers: { ...signed(eventPayload()).headers,
      'x-slack-signature': 'bad' } },
    { ...signed(eventPayload()), rawBody: Buffer.from('{}') },
  ]) {
    assert.equal((await h(r)).status, 401);
  }
});

test('TASK-012: URL verification challenge only after real Slack HMAC verification', async () => {
  const h = ingress();
  const good = await h(signed({ type: 'url_verification', challenge: 'challenge_123456' }));
  assert.deepEqual(good, { status: 200, body: 'challenge_123456',
    contentType: 'text/plain; charset=utf-8' });
  const forged = signed({ type: 'url_verification', challenge: 'challenge_123456' });
  forged.headers = { 'content-type': 'application/json' };
  assert.equal((await h(forged)).status, 401);
  const invalid = await h(signed({ type: 'url_verification', challenge: 'bad\nchallenge' }));
  assert.equal(invalid.status, 400);
});

test('TASK-012: accepted mention is minimized and handed off durably before ACK', async () => {
  const jobs = [];
  const h = ingress(async (job, { signal }) => {
    assert.equal(signal.aborted, false);
    jobs.push(job);
    return { durability: 'durable', state: 'stored' };
  });
  const result = await h(signed({ ...eventPayload(), token: 'synthetic-legacy-token',
    authorizations: [{ user_id: 'U555AAA666' }] }));
  assert.equal(result.status, 200);
  assert.equal(result.body, '');
  assert.equal(jobs.length, 1);
  assert.ok(Object.isFrozen(jobs[0]));
  assert.deepEqual(jobs[0], {
    kind: 'HUSBOT_MENTION_V1',
    eventId: 'Ev123ABC456',
    teamId, channelId,
    userId: 'U123ABC456',
    text: '<@U222ABC333> hva må vi kjøpe?',
    messageTs: '1760500800.000012',
    threadTs: '1760500800.000012',
  });
  assert.doesNotMatch(JSON.stringify(jobs[0]), /token|authorizations|signing-secret/);
});

test('TASK-012: duplicate Slack delivery has same stable event identity and is ACKed', async () => {
  const jobs = [];
  const h = ingress(async job => {
    jobs.push(job);
    return { durability: 'durable', state: jobs.length === 1 ? 'stored' : 'duplicate' };
  });
  assert.equal((await h(signed(eventPayload()))).status, 200);
  assert.equal((await h(signed(eventPayload()))).status, 200);
  assert.equal(jobs[0].eventId, jobs[1].eventId);
  assert.deepEqual(jobs[0], jobs[1]);
});

test('TASK-012: missing durable ACK, rejection and exception are 503, never fake success', async () => {
  for (const enqueue of [
    async () => undefined,
    async () => ({ state: 'stored' }),
    async () => ({ durability: 'memory', state: 'stored' }),
    async () => ({ durability: 'durable', state: 'queued_unconfirmed' }),
    async () => { throw Error('sensitive provider diagnostic'); },
  ]) {
    assert.equal((await ingress(enqueue)(signed(eventPayload()))).status, 503);
  }
});

test('TASK-012: slow durable sink times out and returns retryable 503 without egress', async () => {
  let cancelled = false;
  const h = ingress((_job, { signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => {
      cancelled = true;
      resolve({ durability: 'durable', state: 'stored' });
    }, { once: true });
  }), { enqueueTimeoutMs: 100 });
  const started = Date.now();
  assert.equal((await h(signed(eventPayload()))).status, 503);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - started < 800);
});

test('TASK-012: wrong workspace, app, or malformed envelope never reach queue', async () => {
  let calls = 0;
  const h = ingress(async () => { calls++; return { durability: 'durable', state: 'stored' }; });
  const rejected = [
    { ...eventPayload(), api_app_id: 'A999ABC456' },
    { ...eventPayload(), team_id: 'T999ABC456' },
    { ...eventPayload(), event_id: 'nonsense' },
    { ...eventPayload(), event: { ...eventPayload().event, user: null } },
    { ...eventPayload(), event: { ...eventPayload().event, text: 'x'.repeat(2001) } },
    { ...eventPayload(), event: { ...eventPayload().event, ts: 'invalid' } },
    { ...eventPayload(), event: { ...eventPayload().event, thread_ts: 'invalid' } },
    { ...eventPayload(), event: null },
  ];
  for (const payload of rejected)
    assert.ok([400, 403].includes((await h(signed(payload))).status));
  assert.equal(calls, 0);
});

test('TASK-012: other channels, DMs, bot replies and unrelated events safely ignored', async () => {
  let calls = 0;
  const h = ingress(async () => { calls++; return { durability: 'durable', state: 'stored' }; });
  for (const payload of [
    eventPayload({ event: { channel: 'C999AAA888' } }),
    eventPayload({ event: { channel: 'D999AAA888' } }),
    eventPayload({ event: { bot_id: 'B123AAA456' } }),
    eventPayload({ event: { subtype: 'message_changed' } }),
    eventPayload({ event: { type: 'reaction_added' } }),
    { type: 'app_rate_limited' },
  ]) assert.equal((await h(signed(payload))).status, 200);
  assert.equal(calls, 0);
});

test('TASK-012: invalid/missing configuration fails before processing any requests', () => {
  for (const overrides of [
    { signingSecret: 'short' },
    { appId: 'unknown' },
    { teamId: 'unknown' },
    { approvedChannelId: 'D123ABC456' },
    { enqueue: undefined },
    { enqueueTimeoutMs: 2500 },
  ]) {
    const args = {
      signingSecret, appId, teamId, approvedChannelId: channelId,
      enqueue: async () => ({ durability: 'durable', state: 'stored' }),
      ...overrides,
    };
    assert.throws(() => createSlackEventsIngress(args), /configuration/);
  }
});

test('TASK-012: non-POST, corrupt JSON, oversized payload never enqueue', async () => {
  let calls = 0;
  const h = ingress(async () => { calls++; return { durability: 'durable', state: 'stored' }; });
  assert.equal((await h({ ...signed(eventPayload()), method: 'GET' })).status, 405);
  assert.equal((await h(signed('not-json'))).status, 400);
  assert.equal((await h(signed('x'.repeat(32769)))).status, 413);
  assert.equal((await h(signed([]))).status, 400);
  assert.equal(calls, 0);
});

test('TASK-012: HTTP adapter has only /slack/events POST and verifies signed bytes', async () => {
  const jobs = [];
  const server = createSlackHttpServer({
    handleSlackEvent: ingress(async job => {
      jobs.push(job);
      return { durability: 'durable', state: 'stored' };
    }),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port;
    const payload = signed(eventPayload());
    const valid = await fetch(url + '/slack/events', {
      method: 'POST', headers: payload.headers, body: payload.rawBody,
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get('cache-control'), 'no-store');
    assert.equal(await valid.text(), '');
    assert.equal(jobs.length, 1);

    const path = await fetch(url + '/wrong', { method: 'POST', body: '{}' });
    assert.equal(path.status, 404);
    const verb = await fetch(url + '/slack/events');
    assert.equal(verb.status, 405);
    const unauth = await fetch(url + '/slack/events', { method: 'POST', body: '{}' });
    assert.equal(unauth.status, 401);
    const oversize = await fetch(url + '/slack/events', {
      method: 'POST', body: 'x'.repeat(32769),
    });
    assert.equal(oversize.status, 413);
    assert.equal(jobs.length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
