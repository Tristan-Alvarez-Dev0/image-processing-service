import { buildApp, type AppDeps } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';

/**
 * Tests talk to a fixture server on 127.0.0.1 with a random port, so by
 * default that one loopback address and any port are allowed. SSRF tests
 * override these to get production behaviour.
 */
const TEST_DEFAULTS = {
  NODE_ENV: 'test',
  ALLOW_PRIVATE_ADDRESSES: '127.0.0.1',
  ALLOWED_PORTS: '*',
};

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): Config {
  return loadConfig({ ...TEST_DEFAULTS, ...overrides });
}

export async function buildTestApp(overrides: Partial<NodeJS.ProcessEnv> = {}, deps?: AppDeps) {
  const app = await buildApp(testConfig(overrides), deps);
  await app.ready();
  return app;
}
