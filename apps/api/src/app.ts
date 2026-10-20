import type { Writable } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { AppError } from './errors/app-error.js';
import { registerErrorHandling } from './errors/error-handler.js';
import { createMetrics } from './observability/metrics.js';
import { registerRequestHooks } from './observability/request-hooks.js';
import { genRequestId } from './observability/request-id.js';
import { healthRoutes } from './routes/health.js';
import type { ProcessedImage } from './routes/image-response.js';
import { docsRoutes } from './routes/docs.js';
import { metricsRoutes } from './routes/metrics.js';
import { buildOpenApiDocument } from './openapi/spec.js';
import { processRoutes } from './routes/process.js';
import { videoRoutes } from './routes/video.js';
import { AddressPolicy } from './security/address-policy.js';
import { LoadingCache } from './services/cache.js';
import { createFetcher, type FetchedSource, type SourceFetcher } from './services/fetcher.js';
import { ConcurrencyLimiter } from './services/limiter.js';

/** Collaborators that tests can swap out. */
export interface AppDeps {
  fetchSource?: SourceFetcher;
  /** Where JSON logs go; lets tests capture them. */
  logStream?: Writable;
}

const describeWindow = (ms: number) =>
  ms % 60_000 === 0 ? `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}` : `${ms / 1000} seconds`;

function loggerOptions(config: Config, stream?: Writable): FastifyServerOptions['logger'] {
  if (stream) return { level: config.LOG_LEVEL, stream };
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
    logger: loggerOptions(config, deps.logStream),
    trustProxy: config.TRUST_PROXY,
    genReqId: genRequestId,
    requestIdLogLabel: 'requestId',
    // Replaced by one structured line per request (see request-hooks).
    disableRequestLogging: true,
  });

  const metrics = createMetrics();
  registerErrorHandling(app);
  registerRequestHooks(app, metrics);

  if (config.RATE_LIMIT_MAX > 0) {
    await app.register(rateLimit, {
      max: config.RATE_LIMIT_MAX,
      timeWindow: config.RATE_LIMIT_WINDOW_MS,
      // The docs UI loads several static assets per page view; they cost nothing to serve.
      allowList: (request) => request.url.startsWith('/docs'),
      errorResponseBuilder: (_request, ctx) =>
        new AppError(
          'RATE_LIMITED',
          `Rate limit of ${ctx.max} requests per ${describeWindow(config.RATE_LIMIT_WINDOW_MS)} exceeded. Try again in ${ctx.after}.`,
        ),
    });
  }

  let baseFetch = deps.fetchSource;
  if (!baseFetch) {
    const fetcher = createFetcher({
      timeoutMs: config.FETCH_TIMEOUT_MS,
      maxBytes: config.MAX_SOURCE_BYTES,
      maxRedirects: config.MAX_REDIRECTS,
      addresses: new AddressPolicy(config.ALLOW_PRIVATE_ADDRESSES),
      allowedPorts: config.ALLOWED_PORTS,
      userAgent: `ImageProcessingService/${config.APP_VERSION}`,
    });
    app.addHook('onClose', fetcher.close);
    baseFetch = fetcher.fetch;
  }
  const download = baseFetch;
  const rawFetch: SourceFetcher = async (url, callOpts) => {
    const end = metrics.upstreamDuration.startTimer();
    try {
      const source = await download(url, callOpts);
      end({ outcome: 'ok' });
      return source;
    } catch (err) {
      end({ outcome: 'error' });
      throw err;
    }
  };

  const sourceCache = new LoadingCache<FetchedSource>({
    maxBytes: config.SOURCE_CACHE_MAX_BYTES,
    ttlMs: config.SOURCE_CACHE_TTL_SECONDS * 1000,
    sizeOf: (source) => source.body.length,
    onLookup: (hit) => metrics.cacheLookups.inc({ cache: 'source', result: hit ? 'hit' : 'miss' }),
  });
  const fetchSource: SourceFetcher = async (url) =>
    (await sourceCache.get(url, () => rawFetch(url))).value;

  const resultCache = new LoadingCache<ProcessedImage>({
    maxBytes: config.RESULT_CACHE_MAX_BYTES,
    ttlMs: config.RESULT_CACHE_TTL_SECONDS * 1000,
    sizeOf: (result) => result.data.length,
    onLookup: (hit) => metrics.cacheLookups.inc({ cache: 'result', result: hit ? 'hit' : 'miss' }),
  });

  const limiter = new ConcurrencyLimiter(config.MAX_CONCURRENT_JOBS);
  metrics.trackState({ result: resultCache, source: sourceCache }, limiter);
  const imageLimits = {
    maxInputPixels: config.MAX_INPUT_PIXELS,
    timeoutMs: config.PROCESSING_TIMEOUT_MS,
  };

  await app.register(healthRoutes, { version: config.APP_VERSION });
  await app.register(metricsRoutes, { registry: metrics.registry, token: config.METRICS_TOKEN });
  await app.register(docsRoutes, {
    document: buildOpenApiDocument({
      version: config.APP_VERSION,
      maxDimension: config.MAX_OUTPUT_DIMENSION,
      maxInputPixels: config.MAX_INPUT_PIXELS,
      maxSourceBytes: config.MAX_SOURCE_BYTES,
      videoMaxSourceBytes: config.VIDEO_MAX_SOURCE_BYTES,
      maxRedirects: config.MAX_REDIRECTS,
      fetchTimeoutMs: config.FETCH_TIMEOUT_MS,
      processingTimeoutMs: config.PROCESSING_TIMEOUT_MS,
      rateLimitMax: config.RATE_LIMIT_MAX,
      videoRateLimitMax: config.VIDEO_RATE_LIMIT_MAX,
      rateLimitWindowMs: config.RATE_LIMIT_WINDOW_MS,
      httpMaxAgeSeconds: config.HTTP_CACHE_MAX_AGE_SECONDS,
    }),
  });
  await app.register(processRoutes, {
    fetchSource,
    limiter,
    resultCache,
    maxDimension: config.MAX_OUTPUT_DIMENSION,
    imageLimits,
    httpMaxAgeSeconds: config.HTTP_CACHE_MAX_AGE_SECONDS,
    metrics,
  });
  await app.register(videoRoutes, {
    fetchSource: rawFetch,
    limiter,
    resultCache,
    maxDimension: config.MAX_OUTPUT_DIMENSION,
    maxSourceBytes: config.VIDEO_MAX_SOURCE_BYTES,
    imageLimits,
    videoLimits: {
      ffmpegPath: config.FFMPEG_PATH,
      timeoutMs: config.PROCESSING_TIMEOUT_MS,
      maxPixels: config.MAX_INPUT_PIXELS,
    },
    httpMaxAgeSeconds: config.HTTP_CACHE_MAX_AGE_SECONDS,
    rateLimit:
      config.RATE_LIMIT_MAX > 0
        ? { max: config.VIDEO_RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW_MS }
        : null,
    metrics,
  });

  return app;
}
