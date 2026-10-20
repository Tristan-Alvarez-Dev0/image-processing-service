import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  if (config.NODE_ENV === 'development') {
    return {
      level: config.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: config.LOG_LEVEL };
}

/**
 * Builds the Fastify app without starting it, so tests can drive it
 * through `app.inject()` and the server entrypoint can call `listen()`.
 */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
  });

  await app.register(healthRoutes, { version: config.APP_VERSION });

  return app;
}
