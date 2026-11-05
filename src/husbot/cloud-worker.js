/**
 * TASK-017: private Cloud Tasks worker. Cloud Run IAM must block every
 * unauthenticated request; this handler never trusts spoofable task headers.
 * Cloud Tasks delivers at least once. A Firestore create-only reply claim
 * enforces at-most-one Slack POST attempt per eventId across processes.
 */
import { createServer } from 'node:http';
import { createAnswer } from './live-reply.js';

const EVENT = /^Ev[A-Za-z0-9]{7,62}$/;
const CHANNEL = /^[CG][A-Z0-9]{8,}$/;
const TEAM = /^T[A-Z0-9]{8,}$/;
const TS = /^\d{9,15}\.\d{1,9}$/;
const MAX_BODY = 4096;
function validJob(job, teamId, approvedChannelId) {
  if (!job || typeof job !== 'object' || Array.isArray(job) ||
      Object.keys(job).sort().join(',') !==
        'channelId,eventId,kind,messageTs,teamId,text,threadTs,userId' ||
      job.kind !== 'HUSBOT_MENTION_V1' || !EVENT.test(job.eventId ?? '') ||
      job.teamId !== teamId || job.channelId !== approvedChannelId ||
      typeof job.text !== 'string' || !job.text.trim() ||
      job.text.length > 2000 || !TS.test(job.messageTs ?? '') ||
      !TS.test(job.threadTs ?? '') ||
      !/^[UW][A-Z0-9]{8,}$/.test(job.userId ?? ''))
    return false;
  return true;
}
export function createTaskWorker({
  teamId, approvedChannelId, claim, readInventory, postReply,
} = {}) {
  if (!TEAM.test(teamId ?? '') || !CHANNEL.test(approvedChannelId ?? '') ||
      typeof claim !== 'function' || typeof readInventory !== 'function' ||
      typeof postReply !== 'function')
    throw new TypeError('Invalid private worker configuration');
  return async function processTask(job) {
    if (!validJob(job, teamId, approvedChannelId))
      return {status: 403};
    // Compute validated deterministic facts first; transient Trello failure
    // should retry safely without consuming the unique reply claim.
    let answer;
    try {
      answer = await createAnswer(job.text, {readInventory});
    } catch { return {status: 503}; }
    let state;
    try { state = await claim(job.eventId); }
    catch { return {status: 503}; }
    if (state === 'duplicate') return {status: 204};
    if (state !== 'claimed') return {status: 503};
    try {
      await postReply({channelId: approvedChannelId, threadTs: job.threadTs}, answer);
      return {status: 204};
    } catch {
      // Ambiguous Slack result: Cloud Tasks may retry, but the durable
      // claim prevents a second external POST. Operator must inspect Slack.
      return {status: 503};
    }
  };
}

export function createTaskWorkerHttpServer({processTask, maxBodyBytes = MAX_BODY} = {}) {
  if (typeof processTask !== 'function' || maxBodyBytes !== MAX_BODY)
    throw new TypeError('Invalid private worker HTTP configuration');
  return createServer(async (req, res) => {
    function finish(status) {
      res.writeHead(status, {'Cache-Control': 'no-store'});
      res.end();
    }
    if (req.url !== '/internal/task') return finish(404);
    if (req.method !== 'POST') return finish(405);
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
      return finish(415);
    if (Number(req.headers['content-length']) > MAX_BODY) return finish(413);
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) return finish(413);
        chunks.push(chunk);
      }
      let job;
      try { job = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return finish(400); }
      const response = await processTask(job);
      finish([204, 403, 503].includes(response?.status) ? response.status : 503);
    } catch {
      if (!res.headersSent) finish(503);
      else res.end();
    }
  });
}
