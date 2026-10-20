import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ErrorCode } from '../errors/app-error.js';
import type { Metrics } from './metrics.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the error handler, so logs and metrics can report it. */
    errorCode: ErrorCode | undefined;
  }
}

/** Routes polled by infrastructure; logged at debug level to keep logs readable. */
const QUIET_ROUTES = new Set(['/health', '/metrics']);

/**
 * Only the host of the source is logged: full source URLs often carry signed
 * tokens or identify what a user is viewing, and don't belong in logs.
 */
function sourceHost(request: FastifyRequest): string | undefined {
  const url = (request.query as Record<string, unknown> | undefined)?.url;
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Per-request observability: echoes the request ID, records HTTP metrics and
 * writes exactly one structured log line per request. Client IPs, headers and
 * query strings are deliberately not logged.
 */
export function registerRequestHooks(app: FastifyInstance, metrics: Metrics) {
  app.decorateRequest('errorCode', undefined);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    // The route template, never the raw path, so labels can't explode in number.
    const route = request.routeOptions.url ?? 'unmatched';
    const status = reply.statusCode;

    metrics.httpRequests.inc({ route, method: request.method, status_code: String(status) });
    metrics.httpDuration.observe({ route, method: request.method }, reply.elapsedTime / 1000);
    if (request.errorCode) metrics.errors.inc({ code: request.errorCode });

    const level = status >= 500 ? 'error' : QUIET_ROUTES.has(route) ? 'debug' : 'info';
    request.log[level](
      {
        method: request.method,
        route,
        ...(route === 'unmatched' && { path: request.url.split('?')[0]!.slice(0, 200) }),
        status,
        durationMs: Math.round(reply.elapsedTime * 10) / 10,
        cache: reply.getHeader('x-cache'),
        sourceHost: sourceHost(request),
        errorCode: request.errorCode,
      },
      'request completed',
    );
  });
}
