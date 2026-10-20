import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { registerErrorHandling } from './errors/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { processRoutes } from './routes/process.js';
import { createFetcher, type SourceFetcher } from './services/fetcher.js';

/** Collaborators that tests can swap out. */
export interface AppDeps {
  fetchSource?: SourceFetcher;
}

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
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    genReqId: () => randomUUID(),
  });

  registerErrorHandling(app);

  const fetchSource =
    deps.fetchSource ??
    createFetcher({
      timeoutMs: config.FETCH_TIMEOUT_MS,
      userAgent: `ImageProcessingService/${config.APP_VERSION}`,
    });

  await app.register(healthRoutes, { version: config.APP_VERSION });
  await app.register(processRoutes, { fetchSource });

  return app;
}
