#!/usr/bin/env node
/** Illustrate retry boundaries without any external service calls. */
import assert from 'node:assert/strict';
import { createTaskWorker } from '../src/husbot/cloud-worker.js';

const job = {
  kind: 'HUSBOT_MENTION_V1',
  eventId: 'Ev987654321', teamId: 'T123456789', channelId: 'C123456789',
  userId: 'U123456789', text: '<@U123456789> inventar',
  messageTs: '1760000001.000100', threadTs: '1760000001.000100',
};
const facts = {inventory: [{id:'fake-one',name:'Fictional paper',status:'ok'}], shoppingAttention: []};
let failRead = true;
let claims = 0;
let sends = 0;
const stored = new Set();
const worker = createTaskWorker({
  teamId: job.teamId,
  approvedChannelId: job.channelId,
  readInventory: async () => {
    if (failRead) throw new Error('fictional read outage');
    return facts;
  },
  claim: async id => {
    claims += 1;
    if (stored.has(id)) return 'duplicate';
    stored.add(id);
    return 'claimed';
  },
  postReply: async () => {
    sends += 1;
    throw new Error('fictional ambiguous send acknowledgement');
  },
});

assert.equal((await worker(job)).status, 503, 'failed read should be retryable');
assert.equal(claims, 0, 'a read failure must not consume event identity');
failRead = false;
assert.equal((await worker(job)).status, 503, 'ambiguous send outcome remains a failure');
assert.equal(claims, 1);
assert.equal(sends, 1);
assert.equal((await worker(job)).status, 204, 'retry finds existing claim');
assert.equal(sends, 1, 'no second send after ambiguous outcome');
if (!process.argv.includes('--verify')) {
  console.log('SYNTHETIC FAILURE DEMO');
  console.log('Read failed → 503; no claim created.');
  console.log('Read recovered; claim created; send acknowledgement ambiguous → 503.');
  console.log('Repeated event → 204 duplicate; no second send attempt.');
  console.log('Important: this is at-most-once attempt, NOT guaranteed delivery.');
} else {
  console.log('Synthetic failure boundaries: PASS');
}
