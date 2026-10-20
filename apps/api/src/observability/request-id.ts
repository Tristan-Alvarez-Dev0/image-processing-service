import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Unsafe IDs could forge or corrupt log lines. */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

/** Reuses a safe incoming X-Request-Id, otherwise a new UUID. */
export function genRequestId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}
