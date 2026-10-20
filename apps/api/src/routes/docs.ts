import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyPluginAsync } from 'fastify';

export interface DocsRouteOptions {
  document: Record<string, unknown>;
}

/** Serves the OpenAPI document at /openapi.json and interactive docs at /docs. */
export const docsRoutes: FastifyPluginAsync<DocsRouteOptions> = async (app, opts) => {
  await app.register(swagger, {
    mode: 'static',
    specification: { document: opts.document as never },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      tryItOutEnabled: true,
      displayRequestDuration: true,
    },
  });

  app.get('/openapi.json', { config: { rateLimit: false } }, async (_request, reply) =>
    reply.header('Cache-Control', 'public, max-age=300').send(opts.document),
  );
};
