import type { FastifyPluginAsync } from 'fastify';
import { createProcessQuerySchema } from '../schemas/process.js';
import { parseQuery } from '../schemas/validate.js';
import type { LoadingCache } from '../services/cache.js';
import type { SourceFetcher } from '../services/fetcher.js';
import { cacheKey, etagFor, ifNoneMatchHits } from '../services/http-cache.js';
import { transformImage, type ImageLimits, type TransformResult } from '../services/image.js';
import type { ConcurrencyLimiter } from '../services/limiter.js';

export type ProcessedImage = TransformResult & { etag: string };

export interface ProcessRouteOptions {
  fetchSource: SourceFetcher;
  limiter: ConcurrencyLimiter;
  resultCache: LoadingCache<ProcessedImage>;
  maxDimension: number;
  imageLimits: ImageLimits;
  httpMaxAgeSeconds: number;
}

export const processRoutes: FastifyPluginAsync<ProcessRouteOptions> = async (app, opts) => {
  const schema = createProcessQuerySchema({ maxDimension: opts.maxDimension });

  app.get('/process', async (request, reply) => {
    const query = parseQuery(schema, request.query);
    // Canonical URL form (lower-case host, default port dropped) for a better cache hit rate.
    const params = { ...query, url: new URL(query.url).href };

    const { value: result, hit } = await opts.resultCache.get(
      cacheKey('process', params),
      async () => {
        const source = await opts.fetchSource(params.url);
        const transformed = await opts.limiter.run(() =>
          transformImage(source.body, params, opts.imageLimits, source.contentType),
        );
        return { ...transformed, etag: etagFor(transformed.data) };
      },
    );

    reply
      .header('Cache-Control', `public, max-age=${opts.httpMaxAgeSeconds}`)
      .header('ETag', result.etag)
      .header('X-Cache', hit ? 'HIT' : 'MISS');

    if (ifNoneMatchHits(request.headers['if-none-match'], result.etag)) {
      return reply.code(304).send();
    }

    return reply
      .header('Content-Type', `image/${result.output.format}`)
      .header('Content-Length', result.data.length)
      .header('Content-Disposition', `inline; filename="image.${result.output.format}"`)
      .header('X-Original-Width', result.original.width)
      .header('X-Original-Height', result.original.height)
      .header('X-Original-Format', result.original.format)
      .header('X-Original-Size', result.original.size)
      .send(result.data);
  });
};
