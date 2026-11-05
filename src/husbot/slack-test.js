/**
 * TASK-003: guarded test-channel transport for SYNTHETIC deterministic briefs.
 * No credentials are read from process.env; no production/channel auto-routing.
 * An AI draft cannot be posted using this adapter.
 */
import { isSyntheticBrief } from './daily-brief.js';

const URL = 'https://slack.com/api/chat.postMessage';
const CHANNEL = /^[CG][A-Z0-9]{8,}$/; // Channel/group ID only, never user DM.

export async function postSyntheticTestBrief(brief, options = {}) {
  const {
    enabled = false, approvedTestSend = false,
    botToken, testChannelId, approvedTestChannelId,
    fetchImpl = globalThis.fetch,
  } = options;
  if (!enabled) return { state: 'disabled' };
  if (!approvedTestSend) return { state: 'approval_required' };
  if (!isSyntheticBrief(brief)) return { state: 'synthetic_only' };
  if (!botToken || !testChannelId || !approvedTestChannelId) {
    return { state: 'not_configured' };
  }
  if (typeof botToken !== 'string' || !/^xoxb-[A-Za-z0-9-]{10,}$/.test(botToken) ||
      typeof testChannelId !== 'string' || !CHANNEL.test(testChannelId) ||
      testChannelId !== approvedTestChannelId || typeof fetchImpl !== 'function') {
    return { state: 'invalid_configuration' };
  }

  try {
    const response = await fetchImpl(URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + botToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: testChannelId,
        text: '[SYNTHETIC TEST — NOT REAL HOUSEHOLD DATA]\n' + brief.text,
        mrkdwn: false,
        parse: 'none',
        link_names: false,
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response?.ok) return { state: 'unavailable' };
    const payload = await response.json();
    if (payload?.ok !== true || payload.channel !== testChannelId ||
        typeof payload.ts !== 'string' || !/^\d+\.\d+$/.test(payload.ts)) {
      return { state: 'unavailable' };
    }
    return { state: 'sent_test' };
  } catch {
    // Fail closed: never log Slack's raw error or token and never claim sent.
    // Slack ACK loss is ambiguous; do NOT retry automatically.
    return { state: 'unavailable' };
  }
}
