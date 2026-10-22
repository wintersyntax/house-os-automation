#!/usr/bin/env node
/** An offline, fictional worker demonstration. No network connections. */
import assert from 'node:assert/strict';
import { createTaskWorker } from '../src/husbot/cloud-worker.js';

const inventory = [
  { id: 'synthetic-coffee', name: 'Fictional coffee', status: 'kjøp' },
  { id: 'synthetic-soap', name: 'Fictional soap', status: 'ok' },
];
const snapshot = {
  inventory,
  shoppingAttention: [{ id: 'synthetic-coffee', name: 'Fictional coffee' }],
  shoppingList: [{ id: 'synthetic-flowers', name: 'Fictional flowers' }],
};
const seenEvents = new Set();
const outgoing = [];
let readCalls = 0;
const job = {
  kind: 'HUSBOT_MENTION_V1',
  eventId: 'Ev123456789',
  teamId: 'T123456789',
  channelId: 'C123456789',
  userId: 'U123456789',
  text: '<@U123456789> hva trenger vi å kjøpe?',
  messageTs: '1760000000.000100',
  threadTs: '1760000000.000100',
};
const worker = createTaskWorker({
  teamId: job.teamId,
  approvedChannelId: job.channelId,
  readInventory: async ({ includeShoppingList }) => {
    assert.equal(includeShoppingList, true);
    readCalls += 1;
    return structuredClone(snapshot);
  },
  claim: async eventId => {
    if (seenEvents.has(eventId)) return 'duplicate';
    seenEvents.add(eventId);
    return 'claimed';
  },
  postReply: async ({ channelId, threadTs }, answer) => {
    assert.equal(channelId, job.channelId);
    assert.equal(threadTs, job.threadTs);
    outgoing.push(answer);
  },
});

assert.equal((await worker(job)).status, 204);
assert.equal((await worker(job)).status, 204);
assert.equal(outgoing.length, 1, 'a redelivered event must not post twice');
assert.equal(readCalls, 2, 'the worker rereads current facts before the event claim');
assert.match(outgoing[0], /Fictional coffee/);
assert.match(outgoing[0], /Fictional flowers/);
assert.match(outgoing[0], /HANDLELISTE/);
assert.match(outgoing[0], /KJØP/);
if (!process.argv.includes('--verify')) {
  console.log('SYNTHETIC ONLY — in-memory Trello, Firestore claim and Slack sender');
  console.log(outgoing[0]);
  console.log('Same event delivered twice; only one simulated Slack reply.');
} else {
  console.log('Synthetic Husbot simulation: PASS');
}
