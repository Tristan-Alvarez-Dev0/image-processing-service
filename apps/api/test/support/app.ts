import { buildApp, type AppDeps } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';

/**
 * Allows the fixture server (127.0.0.1, random port) and turns rate limiting off;
 * SSRF and rate-limit tests override these to get production behaviour.
 */
const TEST_DEFAULTS = {
  NODE_ENV: 'test',
  ALLOW_PRIVATE_ADDRESSES: '127.0.0.1',
  ALLOWED_PORTS: '*',
  RATE_LIMIT_MAX: '0',
};

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): Config {
  return loadConfig({ ...TEST_DEFAULTS, ...overrides });
}

export async function buildTestApp(overrides: Partial<NodeJS.ProcessEnv> = {}, deps?: AppDeps) {
  const app = await buildApp(testConfig(overrides), deps);
  await app.ready();
  return app;
}
