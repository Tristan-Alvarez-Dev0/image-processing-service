import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The real API serving the freshly built UI, as in production. The test
    // images live on 127.0.0.1, which only non-production configs may allow.
    command: 'npm run build && tsx ../api/src/server.ts',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ALLOW_PRIVATE_ADDRESSES: '127.0.0.1',
      ALLOWED_PORTS: '*',
      RATE_LIMIT_MAX: '0',
    },
  },
});
