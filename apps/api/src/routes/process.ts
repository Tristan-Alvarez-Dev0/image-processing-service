import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { processQuerySchema } from '../schemas/process.js';
import type { SourceFetcher } from '../services/fetcher.js';
import { transformImage } from '../services/image.js';

export interface ProcessRouteOptions {
  fetchSource: SourceFetcher;
}

export const processRoutes: FastifyPluginAsync<ProcessRouteOptions> = async (app, opts) => {
  app.get('/process', async (request, reply) => {
    const parsed = processQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const param = issue?.path.join('.') || undefined;
      throw new AppError(400, 'INVALID_PARAMETER', issue?.message ?? 'Invalid query', param);
    }
    const query = parsed.data;

    const source = await opts.fetchSource(query.url);
    const result = await transformImage(source.body, query);

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
