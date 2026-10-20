import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The SDK's source, so it needs no separate build step.
    alias: {
      '@ips/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
      // Matches the "@/*" path in tsconfig.json (used by the shadcn/ui components).
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // In production the API serves the UI itself, so both share one origin.
    proxy: Object.fromEntries(
      ['/process', '/video', '/health', '/docs', '/openapi.json'].map((path) => [path, API]),
    ),
  },
  build: { sourcemap: true },
  test: { include: ['src/**/*.test.ts'] },
});
