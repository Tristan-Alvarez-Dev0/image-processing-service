import type { FastifyPluginAsync } from 'fastify';
import { createProcessQuerySchema } from '../schemas/process.js';
import { parseQuery } from '../schemas/validate.js';
import type { SourceFetcher } from '../services/fetcher.js';
import { transformImage, type ImageLimits } from '../services/image.js';
import type { ConcurrencyLimiter } from '../services/limiter.js';

export interface ProcessRouteOptions {
  fetchSource: SourceFetcher;
  limiter: ConcurrencyLimiter;
  maxDimension: number;
  imageLimits: ImageLimits;
}

export const processRoutes: FastifyPluginAsync<ProcessRouteOptions> = async (app, opts) => {
  const schema = createProcessQuerySchema({ maxDimension: opts.maxDimension });

  app.get('/process', async (request, reply) => {
    const query = parseQuery(schema, request.query);

    const source = await opts.fetchSource(query.url);
    const result = await opts.limiter.run(() =>
      transformImage(source.body, query, opts.imageLimits, source.contentType),
    );

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
