/**
 * TASK-017: no-SDK Google Cloud Tasks + Firestore REST adapters.
 * Cloud Run metadata identity only; never accept a service-account key or
 * pass credentials into URLs, task payloads, source or logs.
 */
import { createHash } from 'node:crypto';

const ID = /^[a-z][a-z0-9-]{2,62}$/;
const PROJECT = /^[a-z][a-z0-9-]{4,29}$/;
const EMAIL = /^[a-zA-Z0-9._-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;
const EVENT = /^Ev[A-Za-z0-9]{7,62}$/;
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function required(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw new TypeError('Invalid ' + label);
  return value;
}
function baseUrl(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid private worker URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/.test(url.hostname) ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new TypeError('Private worker must use its canonical HTTPS run.app root URL');
  return url.origin;
}
export function eventKey(eventId) {
  required(eventId, EVENT, 'Slack event ID');
  return 'e-' + createHash('sha256').update(eventId).digest('hex');
}

export function createGoogleAccessToken({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Missing Google transport');
  return async function googleAccessToken() {
    let response;
    try {
      response = await fetchImpl(METADATA, {
        method: 'GET', headers: {'Metadata-Flavor': 'Google'},
        redirect: 'error', signal: AbortSignal.timeout(2000),
      });
    } catch { throw new Error('Cloud identity metadata unavailable'); }
    if (response?.ok !== true) throw new Error('Cloud identity metadata refused');
    let data;
    try { data = await response.json(); }
    catch { throw new Error('Cloud identity metadata invalid'); }
    if (typeof data?.access_token !== 'string' ||
        !/^[A-Za-z0-9._-]{20,4096}$/.test(data.access_token) ||
        data.token_type !== 'Bearer')
      throw new Error('Cloud identity token malformed');
    return data.access_token;
  };
}

async function jsonRequest(fetchImpl, url, token, body) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new Error('Cloud durable operation outcome unknown'); }
  if (!response || !Number.isInteger(response.status))
    throw new Error('Cloud durable operation malformed status');
  return response;
}

export function createCloudTasksEnqueue({
  project, region, queue, workerUrl, invokerServiceAccount,
  accessToken, fetchImpl = globalThis.fetch,
} = {}) {
  required(project, PROJECT, 'Google project');
  required(region, ID, 'Cloud Tasks region');
  required(queue, ID, 'Cloud Tasks queue');
  required(invokerServiceAccount, EMAIL, 'task invoker service account');
  const origin = baseUrl(workerUrl);
  if (typeof accessToken !== 'function' || typeof fetchImpl !== 'function')
    throw new TypeError('Missing Cloud Tasks transport');
  const parent = `projects/${project}/locations/${region}/queues/${queue}`;
  const endpoint = `https://cloudtasks.googleapis.com/v2/${parent}/tasks`;
  return async function enqueue(job, {signal} = {}) {
    if (!job || job.kind !== 'HUSBOT_MENTION_V1' || typeof job.text !== 'string' ||
        job.text.length > 2000 || !job.text.trim() ||
        typeof job.eventId !== 'string')
      throw new TypeError('Invalid task envelope');
    if (signal?.aborted) throw new Error('Enqueue cancelled');
    const name = parent + '/tasks/' + eventKey(job.eventId);
    const body = {
      task: {name, httpRequest: {
        httpMethod: 'POST',
        url: origin + '/internal/task',
        headers: {'Content-Type': 'application/json'},
        body: Buffer.from(JSON.stringify(job), 'utf8').toString('base64'),
        oidcToken: {serviceAccountEmail: invokerServiceAccount, audience: origin},
      }},
    };
    const response = await jsonRequest(fetchImpl, endpoint, await accessToken(), body);
    // A named task retains its identity across Slack re-deliveries. Cloud
    // Tasks keeps recently completed task names unavailable for reuse.
    if (response.status === 409)
      return {durability: 'durable', state: 'duplicate'};
    if (response.status !== 200) throw new Error('Cloud Tasks create refused');
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Cloud Tasks create response malformed'); }
    if (result?.name !== name) throw new Error('Cloud Tasks identity mismatch');
    return {durability: 'durable', state: 'stored'};
  };
}

export function createFirestoreClaims({
  project, database = '(default)', collection = 'husbot_reply_claims',
  accessToken, fetchImpl = globalThis.fetch, nowMs = Date.now,
} = {}) {
  required(project, PROJECT, 'Google project');
  if (database !== '(default)' || collection !== 'husbot_reply_claims')
    throw new TypeError('Unexpected Firestore database or collection');
  if (typeof accessToken !== 'function' || typeof fetchImpl !== 'function' ||
      typeof nowMs !== 'function')
    throw new TypeError('Missing Firestore transport or clock');
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}`;
  return async function claim(eventId) {
    const key = eventKey(eventId);
    const clock = nowMs();
    if (!Number.isSafeInteger(clock) || clock < 0)
      throw new Error('Invalid Firestore claim clock');
    const expiry = new Date(clock + CLAIM_RETENTION_MS);
    if (!Number.isFinite(expiry.getTime()) || expiry.getUTCFullYear() > 9999)
      throw new Error('Invalid Firestore claim expiry');
    // createDocument is atomic and refuses existing document IDs (409).
    // Claim BEFORE chat.postMessage. This guarantees at-most-one attempt,
    // NOT guaranteed delivery; ambiguous Slack results need owner review.
    const response = await jsonRequest(fetchImpl, base + '?documentId=' + key,
      await accessToken(), {fields: {
        kind: {stringValue: 'HUSBOT_SLACK_REPLY_CLAIM_V1'},
        eventHash: {stringValue: key},
        expiresAt: {timestampValue: expiry.toISOString()},
      }});
    if (response.status === 409) return 'duplicate';
    if (response.status !== 200) throw new Error('Firestore reply claim refused');
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Firestore reply claim response malformed'); }
    if (result?.name !== `projects/${project}/databases/(default)/documents/${collection}/${key}`)
      throw new Error('Firestore reply claim identity mismatch');
    return 'claimed';
  };
}
