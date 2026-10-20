import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { AppError } from './errors/app-error.js';
import { registerErrorHandling } from './errors/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { processRoutes, type ProcessedImage } from './routes/process.js';
import { AddressPolicy } from './security/address-policy.js';
import { LoadingCache } from './services/cache.js';
import { createFetcher, type FetchedSource, type SourceFetcher } from './services/fetcher.js';
import { ConcurrencyLimiter } from './services/limiter.js';

/** Collaborators that tests can swap out. */
export interface AppDeps {
  fetchSource?: SourceFetcher;
}

const describeWindow = (ms: number) =>
  ms % 60_000 === 0 ? `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}` : `${ms / 1000} seconds`;

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  if (config.NODE_ENV === 'development') {
    return {
      level: config.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: config.LOG_LEVEL };
}

/**
 * Builds the Fastify app without starting it, so tests can drive it
 * through `app.inject()` and the server entrypoint can call `listen()`.
 */
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    genReqId: () => randomUUID(),
  });

  registerErrorHandling(app);

  if (config.RATE_LIMIT_MAX > 0) {
    await app.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW_MS,
      errorResponseBuilder: (_request, ctx) =>
        new AppError(
          'RATE_LIMITED',
          `Rate limit of ${ctx.max} requests per ${describeWindow(config.RATE_LIMIT_WINDOW_MS)} exceeded. Try again in ${ctx.after}.`,
        ),
    });
  }

  let rawFetch = deps.fetchSource;
  if (!rawFetch) {
    const fetcher = createFetcher({
      timeoutMs: config.FETCH_TIMEOUT_MS,
      maxBytes: config.MAX_SOURCE_BYTES,
      maxRedirects: config.MAX_REDIRECTS,
      addresses: new AddressPolicy(config.ALLOW_PRIVATE_ADDRESSES),
      allowedPorts: config.ALLOWED_PORTS,
      userAgent: `ImageProcessingService/${config.APP_VERSION}`,
    });
    app.addHook('onClose', fetcher.close);
    rawFetch = fetcher.fetch;
  }

  const sourceCache = new LoadingCache<FetchedSource>({
    maxBytes: config.SOURCE_CACHE_MAX_BYTES,
    ttlMs: config.SOURCE_CACHE_TTL_SECONDS * 1000,
    sizeOf: (source) => source.body.length,
  });
  const fetchSource: SourceFetcher = async (url) =>
    (await sourceCache.get(url, () => rawFetch(url))).value;

  const resultCache = new LoadingCache<ProcessedImage>({
    maxBytes: config.RESULT_CACHE_MAX_BYTES,
    ttlMs: config.RESULT_CACHE_TTL_SECONDS * 1000,
    sizeOf: (result) => result.data.length,
  });

  await app.register(healthRoutes, { version: config.APP_VERSION });
  await app.register(processRoutes, {
    fetchSource,
    limiter: new ConcurrencyLimiter(config.MAX_CONCURRENT_JOBS),
    resultCache,
    maxDimension: config.MAX_OUTPUT_DIMENSION,
    imageLimits: {
      maxInputPixels: config.MAX_INPUT_PIXELS,
      timeoutMs: config.PROCESSING_TIMEOUT_MS,
    },
    httpMaxAgeSeconds: config.HTTP_CACHE_MAX_AGE_SECONDS,
  });

  return app;
}
