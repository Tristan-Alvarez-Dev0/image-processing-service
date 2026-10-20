import type { FastifyPluginAsync } from 'fastify';
import { processQuerySchema } from '../schemas/process.js';
import { parseQuery } from '../schemas/validate.js';
import type { SourceFetcher } from '../services/fetcher.js';
import { transformImage } from '../services/image.js';

export interface ProcessRouteOptions {
  fetchSource: SourceFetcher;
}

export const processRoutes: FastifyPluginAsync<ProcessRouteOptions> = async (app, opts) => {
  app.get('/process', async (request, reply) => {
    const query = parseQuery(processQuerySchema, request.query);

    const source = await opts.fetchSource(query.url);
    const result = await transformImage(source.body, query, source.contentType);

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
