import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ APP_VERSION: '9.9.9' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status, uptime and version', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ status: 'ok', uptime: expect.any(Number), version: '9.9.9' });
  });

  it('is never cached', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(res.statusCode).toBe(404);
  });
});
