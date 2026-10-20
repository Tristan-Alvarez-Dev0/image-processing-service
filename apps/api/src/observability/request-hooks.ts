import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ErrorCode } from '../errors/app-error.js';
import type { Metrics } from './metrics.js';

declare module 'fastify' {
  interface FastifyRequest {
    errorCode: ErrorCode | undefined;
  }
}

/** Health checks, scrapes and docs assets log at debug level. */
const isQuiet = (route: string) =>
  route === '/health' || route === '/metrics' || route.startsWith('/docs');

/** Only the host: full source URLs can carry signed tokens. */
function sourceHost(request: FastifyRequest): string | undefined {
  const url = (request.query as Record<string, unknown> | undefined)?.url;
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** One log line per request. Client IPs, headers and query strings are never logged. */
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

    const level = status >= 500 ? 'error' : isQuiet(route) ? 'debug' : 'info';
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
