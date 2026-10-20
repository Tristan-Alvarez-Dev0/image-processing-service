import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { resolveApiUrl, staticSiteHeaders } from './src/lib/api-url';

const API = process.env.API_URL ?? 'http://localhost:3000';

/** Writes Netlify's `_headers`, with the API's origin allowed by the CSP. */
function netlifyHeaders(apiUrl: string): Plugin {
  return {
    name: 'netlify-headers',
    apply: 'build',
    generateBundle() {
      if (process.env.NETLIFY && !apiUrl) {
        this.error('Set VITE_API_URL in Netlify (Site configuration > Environment variables).');
      }
      this.emitFile({ type: 'asset', fileName: '_headers', source: staticSiteHeaders(apiUrl) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    netlifyHeaders(resolveApiUrl(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL)),
  ],
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
}));
