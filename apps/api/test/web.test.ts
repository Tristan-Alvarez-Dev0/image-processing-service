import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './support/app.js';

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  // A stand-in for apps/web/dist, so these tests don't depend on a Vite build.
  root = await mkdtemp(join(tmpdir(), 'ips-web-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Playground</title>');
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
});
afterAll(() => rm(root, { recursive: true, force: true }));
afterEach(() => app?.close());

describe('web UI', () => {
  it('serves the UI at / with a strict CSP, always revalidated', async () => {
    app = await buildTestApp({ WEB_ROOT: root });

    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<title>Playground</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/img-src 'self' blob:/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('caches fingerprinted assets forever', async () => {
    app = await buildTestApp({ WEB_ROOT: root });

    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('keeps the JSON 404 for unknown paths', async () => {
    app = await buildTestApp({ WEB_ROOT: root });

    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('does not count UI files against the rate limit, only processing endpoints', async () => {
    app = await buildTestApp({ WEB_ROOT: root, RATE_LIMIT_MAX: '1' });

    const ui = await Promise.all(
      ['/', '/assets/index-abc123.js', '/', '/docs/json'].map(
        async (url) => (await app.inject({ method: 'GET', url })).statusCode,
      ),
    );
    const api = [];
    for (let i = 0; i < 2; i++) {
      api.push((await app.inject({ method: 'GET', url: '/process?url=x' })).statusCode);
    }

    expect(ui).toEqual([200, 200, 200, 200]);
    expect(api).toEqual([400, 429]);
  });

  it('runs as an API only when the UI has not been built', async () => {
    app = await buildTestApp({ WEB_ROOT: join(root, 'missing') });

    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
