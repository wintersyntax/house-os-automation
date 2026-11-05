/**
 * TASK-017: Cloud Run entrypoint. Intentional startup only when explicitly
 * executed; no external calls on module import, and no local daemon.
 * Two role-isolated services use the same immutable image.
 */
import {createSlackEventsIngress} from './slack-events.js';
import {createSlackHttpServer} from './slack-http.js';
import {createTaskWorker, createTaskWorkerHttpServer} from './cloud-worker.js';
import {createGoogleAccessToken, createCloudTasksEnqueue, createFirestoreClaims}
  from './cloud-platform.js';
import {createLiveSlackSender} from './live-reply.js';
import {createReader} from '../trello/read-only.js';

export function createCloudServer(env = process.env, fetchImpl = globalThis.fetch) {
  const accessToken = createGoogleAccessToken({fetchImpl});
  if (env.HUSBOT_ROLE === 'ingress') {
    const enqueue = createCloudTasksEnqueue({
      project: env.HUSBOT_PROJECT,
      region: env.HUSBOT_REGION,
      queue: env.HUSBOT_QUEUE,
      workerUrl: env.HUSBOT_WORKER_URL,
      invokerServiceAccount: env.HUSBOT_TASK_INVOKER_SA,
      accessToken, fetchImpl,
    });
    const handler = createSlackEventsIngress({
      signingSecret: env.HUSBOT_SLACK_SIGNING_SECRET,
      appId: env.HUSBOT_SLACK_APP_ID,
      teamId: env.HUSBOT_SLACK_TEAM_ID,
      approvedChannelId: env.HUSBOT_TEST_CHANNEL_ID,
      enqueue,
    });
    return createSlackHttpServer({handleSlackEvent: handler});
  }
  if (env.HUSBOT_ROLE === 'worker') {
    if (env.HUSBOT_LIVE_SEND_ENABLED !== 'true')
      throw new TypeError('Live Slack reply requires explicit feature enablement');
    const claim = createFirestoreClaims({
      project: env.HUSBOT_PROJECT, accessToken, fetchImpl,
    });
    const readInventory = createReader({
      key: env.TRELLO_API_KEY,
      token: env.TRELLO_READ_TOKEN,
      boardId: env.TRELLO_BOARD_ID,
      fetchImpl,
    });
    const postReply = createLiveSlackSender({
      enabled: true,
      botToken: env.HUSBOT_SLACK_BOT_TOKEN,
      approvedChannelId: env.HUSBOT_TEST_CHANNEL_ID,
      fetchImpl,
    });
    const processTask = createTaskWorker({
      teamId: env.HUSBOT_SLACK_TEAM_ID,
      approvedChannelId: env.HUSBOT_TEST_CHANNEL_ID,
      claim, readInventory, postReply,
    });
    return createTaskWorkerHttpServer({processTask});
  }
  throw new TypeError('Husbot Cloud Run role must be ingress or worker');
}

if (process.argv[1]?.endsWith('/cloud-main.js')) {
  try {
    const port = Number(process.env.PORT ?? '8080');
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new TypeError('Invalid Cloud Run port');
    const server = createCloudServer();
    server.listen(port, '0.0.0.0', () => {
      // No secrets, owner data or inbound HTTP payloads in operational logs.
      console.log('HUSBOT CLOUD: ready');
    });
  } catch {
    console.error('HUSBOT CLOUD: startup RED (configuration or identity missing)');
    process.exitCode = 1;
  }
}
