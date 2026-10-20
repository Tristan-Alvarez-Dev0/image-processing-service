import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Only short IDs of safe characters are accepted from clients. Anything else
 * (newlines, quotes, huge values) could forge or corrupt log lines.
 */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

/**
 * Reuses the caller's X-Request-Id when it is safe, so one ID can be traced
 * across services; otherwise generates a UUID.
 */
export function genRequestId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}
