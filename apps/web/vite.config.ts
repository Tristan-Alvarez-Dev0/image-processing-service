import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use the SDK's source directly, so the UI never needs a separate SDK build step.
    alias: {
      '@ips/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // In development the UI runs on Vite and forwards API calls; in production
    // the API serves the built UI itself, so both share one origin.
    proxy: Object.fromEntries(
      ['/process', '/video', '/health', '/docs', '/openapi.json'].map((path) => [path, API]),
    ),
  },
  build: { sourcemap: true },
  test: { include: ['src/**/*.test.ts'] },
});
