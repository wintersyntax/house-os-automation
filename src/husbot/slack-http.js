/**
 * Bounded Node HTTP adapter for the pure Slack Events ingress.
 * No server is started on module import, and no cloud deployment is included.
 */
import { createServer } from 'node:http';

export function createSlackHttpServer({ handleSlackEvent, maxBodyBytes = 32768 } = {}) {
  if (typeof handleSlackEvent !== 'function' ||
      !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 100 ||
      maxBodyBytes > 32768) {
    throw new TypeError('Invalid Slack HTTP server configuration');
  }
  return createServer(async (req, res) => {
    if (req.url !== '/slack/events') {
      res.writeHead(404); res.end(); return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405); res.end(); return;
    }
    if (Number(req.headers['content-length']) > maxBodyBytes) {
      res.writeHead(413); res.end(); return;
    }
    const chunks = [];
    let length = 0;
    try {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > maxBodyBytes) {
          res.writeHead(413); res.end(); return;
        }
        chunks.push(chunk);
      }
      const result = await handleSlackEvent({
        method: req.method, headers: req.headers, rawBody: Buffer.concat(chunks),
      });
      res.writeHead(result.status, {
        'Content-Type': result.contentType ?? 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(result.body ?? '');
    } catch {
      // No echo of credentials, event bodies or provider exception messages.
      if (!res.headersSent) res.writeHead(503);
      res.end();
    }
  });
}
