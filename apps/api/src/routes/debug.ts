import type { FastifyPluginAsync } from 'fastify';

/**
 * Shows callers the IP the API attributes to them and the proxy chain, to
 * confirm TRUST_PROXY on a new host. Only registered when DEBUG_CLIENT_IP=true.
 */
export const debugRoutes: FastifyPluginAsync = async (app) => {
  app.get('/debug/client-ip', async (request, reply) =>
    reply.header('Cache-Control', 'no-store').send({
      ip: request.ip,
      chain: request.ips ?? [request.ip],
      forwardedFor: request.headers['x-forwarded-for'] ?? null,
    }),
  );
};
