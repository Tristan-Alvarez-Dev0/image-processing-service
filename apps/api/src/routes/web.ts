import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

export interface WebRouteOptions {
  /** The built UI (apps/web/dist). */
  root: string;
}

/**
 * The UI only talks to this origin and shows blob: images, so it can run
 * under a strict policy. Inline styles are allowed for React's style props.
 */
const UI_CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function webBuildExists(root: string): boolean {
  return existsSync(join(root, 'index.html'));
}

/** Serves the playground UI at `/`, from the same origin as the API it calls. */
export const webRoutes: FastifyPluginAsync<WebRouteOptions> = async (app, opts) => {
  await app.register(fastifyStatic, {
    root: opts.root,
    prefix: '/',
    // Only real files; unknown paths fall through to the JSON 404.
    wildcard: false,
    index: ['index.html'],
    setHeaders(reply, path) {
      if (path.includes(join('assets', ''))) {
        // Vite fingerprints these file names, so they never change.
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        reply.header('Cache-Control', 'no-cache');
      }
      if (path.endsWith('.html')) {
        reply.header('Content-Security-Policy', UI_CSP);
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Referrer-Policy', 'no-referrer');
      }
    },
  });
};
