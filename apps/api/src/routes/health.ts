import type { FastifyPluginAsync } from 'fastify';

export interface HealthRouteOptions {
  version: string;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, opts) => {
  app.get(
    '/health',
    {
      // Platform health checks poll this constantly; never rate-limit it.
      config: { rateLimit: false },
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              uptime: { type: 'number', description: 'Process uptime in seconds' },
              version: { type: 'string' },
            },
            required: ['status', 'uptime', 'version'],
          },
        },
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return {
        status: 'ok' as const,
        uptime: Math.round(process.uptime()),
        version: opts.version,
      };
    },
  );
};
