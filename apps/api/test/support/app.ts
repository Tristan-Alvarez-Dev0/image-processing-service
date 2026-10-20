import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): Config {
  return loadConfig({ NODE_ENV: 'test', ...overrides });
}

export async function buildTestApp(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const app = await buildApp(testConfig(overrides));
  await app.ready();
  return app;
}
