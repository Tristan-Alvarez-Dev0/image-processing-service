import type { FastifyPluginAsync } from 'fastify';
import { createProcessQuerySchema } from '../schemas/process.js';
import { parseQuery } from '../schemas/validate.js';
import type { LoadingCache } from '../services/cache.js';
import type { SourceFetcher } from '../services/fetcher.js';
import { parseAccept } from '../services/format-negotiation.js';
import { cacheKey, etagFor } from '../services/http-cache.js';
import { transformImage, type ImageLimits } from '../services/image.js';
import type { ConcurrencyLimiter } from '../services/limiter.js';
import type { Metrics } from '../observability/metrics.js';
import { sendImage, type ProcessedImage } from './image-response.js';

export interface ProcessRouteOptions {
  fetchSource: SourceFetcher;
  limiter: ConcurrencyLimiter;
  resultCache: LoadingCache<ProcessedImage>;
  maxDimension: number;
  imageLimits: ImageLimits;
  httpMaxAgeSeconds: number;
  metrics: Metrics;
}

export const processRoutes: FastifyPluginAsync<ProcessRouteOptions> = async (app, opts) => {
  const schema = createProcessQuerySchema({ maxDimension: opts.maxDimension });

  app.get('/process', async (request, reply) => {
    const query = parseQuery(schema, request.query);
    const isAuto = query.format === 'auto';
    const params = {
      ...query,
      // Canonical form (lower-case host, no default port) for better cache hits.
      url: new URL(query.url).href,
      // Only format=auto depends on the Accept header, so only then is it part of the key.
      accept: isAuto ? parseAccept(request.headers.accept) : undefined,
    };

    const { value, hit } = await opts.resultCache.get(cacheKey('process', params), async () => {
      const source = await opts.fetchSource(params.url);
      const transformed = await opts.limiter.run(async () => {
        // Timed inside the limiter, so queueing time isn't counted as processing.
        const end = opts.metrics.processingDuration.startTimer({ kind: 'image' });
        try {
          return await transformImage(source.body, params, opts.imageLimits, source.contentType);
        } finally {
          end();
        }
      });
      return { ...transformed, etag: etagFor(transformed.data) };
    });

    return sendImage(request, reply, value, {
      hit,
      isAuto,
      httpMaxAgeSeconds: opts.httpMaxAgeSeconds,
    });
  });
};
