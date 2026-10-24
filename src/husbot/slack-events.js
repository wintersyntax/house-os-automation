/**
 * TASK-012: signed, bounded Slack Events API ingress.
 * No outbound network, AI calls, Trello mutation, queue implementation or bot send.
 * Slack receives a 2xx for app_mention ONLY after a durable sink confirms
 * storage or recognizes the stable event_id as already stored.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const APP = /^A[A-Z0-9]{8,}$/;
const TEAM = /^T[A-Z0-9]{8,}$/;
const CHANNEL = /^[CG][A-Z0-9]{8,}$/;
const USER = /^[UW][A-Z0-9]{8,}$/;
const EVENT = /^Ev[A-Z0-9]{7,}$/i;
const TS = /^\d{9,15}\.\d{1,9}$/;
const MAX_BODY = 32768;

function header(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return null;
}

const response = (status, body = '', contentType = 'text/plain; charset=utf-8') =>
  ({ status, body, contentType });

/** Must be done on the original bytes BEFORE any JSON decoding. */
export function verifySlackSignature({ rawBody, headers, signingSecret, nowSeconds }) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > MAX_BODY ||
      typeof signingSecret !== 'string' || signingSecret.length < 16 ||
      !Number.isSafeInteger(nowSeconds)) return false;
  const timestamp = header(headers, 'x-slack-request-timestamp');
  const signature = header(headers, 'x-slack-signature');
  if (!timestamp || !/^\d{9,11}$/.test(timestamp) ||
      !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const sentAt = Number(timestamp);
  if (!Number.isSafeInteger(sentAt) || Math.abs(nowSeconds - sentAt) > 300) return false;
  const base = Buffer.concat([
    Buffer.from('v0:' + timestamp + ':'), rawBody,
  ]);
  const expected = createHmac('sha256', signingSecret).update(base).digest();
  const supplied = Buffer.from(signature.slice(3), 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * `enqueue` is a REQUIRED durable, idempotent backend contract.
 * It must atomically persist the bounded job by job.eventId, returning:
 *   { durability: 'durable', state: 'stored' | 'duplicate' }
 * only after durable acceptance. It must NOT return success for an in-memory
 * queue or for a task that may be dropped if a Cloud Run instance stops.
 * A timed-out enqueue may still commit: always reuse eventId on retry.
 */
export function createSlackEventsIngress({
  signingSecret, appId, teamId, approvedChannelId, enqueue,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  enqueueTimeoutMs = 1200,
} = {}) {
  if (typeof signingSecret !== 'string' || signingSecret.length < 16 ||
      !APP.test(appId ?? '') || !TEAM.test(teamId ?? '') ||
      !CHANNEL.test(approvedChannelId ?? '') ||
      typeof enqueue !== 'function' || typeof nowSeconds !== 'function' ||
      !Number.isSafeInteger(enqueueTimeoutMs) ||
      enqueueTimeoutMs < 100 || enqueueTimeoutMs > 1500) {
    throw new TypeError('Invalid or missing Slack Events ingress configuration');
  }

  return async function handleSlackEvent({ method, headers, rawBody } = {}) {
    if (method !== 'POST') return response(405);
    if (!Buffer.isBuffer(rawBody) || rawBody.length > MAX_BODY) return response(413);
    if (!verifySlackSignature({
      rawBody, headers, signingSecret, nowSeconds: nowSeconds(),
    })) return response(401);

    let envelope;
    try { envelope = JSON.parse(rawBody.toString('utf8')); }
    catch { return response(400); }
    if (!envelope || typeof envelope !== 'object' ||
        Array.isArray(envelope)) return response(400);

    if (envelope.type === 'url_verification') {
      // A token field is deprecated and is NEVER accepted as authentication.
      if (typeof envelope.challenge !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(envelope.challenge)) return response(400);
      return response(200, envelope.challenge);
    }
    if (envelope.type !== 'event_callback') return response(200);
    if (envelope.api_app_id !== appId || envelope.team_id !== teamId)
      return response(403);

    const event = envelope.event;
    if (!event || typeof event !== 'object' || Array.isArray(event))
      return response(400);
    if (event.type !== 'app_mention') return response(200);
    // Ignore own/bot edits and all out-of-scope channels. No DMs or bot loops.
    if (event.bot_id || event.subtype || event.channel !== approvedChannelId)
      return response(200);
    if (typeof envelope.event_id !== 'string' ||
        envelope.event_id.length > 64 || !EVENT.test(envelope.event_id) ||
        !USER.test(event.user ?? '') ||
        typeof event.text !== 'string' || !event.text.trim() ||
        event.text.length > 2000 ||
        typeof event.ts !== 'string' || !TS.test(event.ts) ||
        (event.thread_ts !== undefined &&
          (typeof event.thread_ts !== 'string' || !TS.test(event.thread_ts)))) {
      return response(400);
    }

    // Minimize payload and discard envelope's private token/authorizations.
    const job = Object.freeze({
      kind: 'HUSBOT_MENTION_V1',
      eventId: envelope.event_id,
      teamId,
      channelId: approvedChannelId,
      userId: event.user,
      text: event.text,
      messageTs: event.ts,
      threadTs: event.thread_ts ?? event.ts,
    });

    const controller = new AbortController();
    let timer;
    try {
      const state = await Promise.race([
        Promise.resolve().then(() => enqueue(job, { signal: controller.signal })),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('enqueue deadline')), enqueueTimeoutMs);
        }),
      ]);
      if (!state || state.durability !== 'durable' ||
          !['stored', 'duplicate'].includes(state.state)) return response(503);
      return response(200);
    } catch {
      return response(503); // No 2xx until durable storage is confirmed.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
