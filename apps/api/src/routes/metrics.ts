import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Registry } from 'prom-client';
import { AppError } from '../errors/app-error.js';

export interface MetricsRouteOptions {
  registry: Registry;
  /** When set, scrapers must send `Authorization: Bearer <token>`. */
  token: string | undefined;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header ?? '');
  // Constant-time comparison so the token can't be guessed byte by byte.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const metricsRoutes: FastifyPluginAsync<MetricsRouteOptions> = async (app, opts) => {
  app.get('/metrics', { config: { rateLimit: false } }, async (request, reply) => {
    if (opts.token && !tokenMatches(request.headers.authorization, opts.token)) {
      throw new AppError('UNAUTHORIZED', 'Send the metrics token as Authorization: Bearer <token>');
    }
    return reply
      .header('Content-Type', opts.registry.contentType)
      .header('Cache-Control', 'no-store')
      .send(await opts.registry.metrics());
  });
};
