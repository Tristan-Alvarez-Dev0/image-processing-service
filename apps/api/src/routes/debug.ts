import type { FastifyPluginAsync } from 'fastify';

/** Only registered when DEBUG_CLIENT_IP=true, to check TRUST_PROXY on a new host. */
export const debugRoutes: FastifyPluginAsync = async (app) => {
  app.get('/debug/client-ip', async (request, reply) =>
    reply.header('Cache-Control', 'no-store').send({
      ip: request.ip,
      chain: request.ips ?? [request.ip],
      forwardedFor: request.headers['x-forwarded-for'] ?? null,
    }),
  );
};
