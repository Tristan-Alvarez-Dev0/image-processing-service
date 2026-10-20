import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/errors/app-error.js';
import type { FetchedSource } from '../src/services/fetcher.js';
import { buildTestApp } from './support/app.js';
import { makeFixtures } from './support/fixtures.js';

let jpeg: Buffer;
const SRC = 'https://images.example.com/photo.jpg';

/** A fake upstream that counts calls, so we can see when the source is (re)fetched. */
const upstream = vi.fn<(url: string) => Promise<FetchedSource>>();

beforeAll(async () => {
  jpeg = (await makeFixtures()).jpeg;
});

beforeEach(() => {
  upstream.mockReset();
  upstream.mockImplementation(async () => ({ body: jpeg, contentType: 'image/jpeg' }));
});

const get = (app: FastifyInstance, qs: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/process?${qs}`, headers });

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

describe('result cache', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp({}, { fetchSource: upstream });
  });
  afterAll(() => app?.close());

  it('serves the second identical request from cache without fetching again', async () => {
    const first = await get(app, q({ url: SRC, width: '200' }));
    const second = await get(app, q({ url: SRC, width: '200' }));

    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true);
    expect(second.headers.etag).toBe(first.headers.etag);
    expect(second.headers['x-original-width']).toBe('800');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('treats reordered parameters, aliases and defaults as the same request', async () => {
    await get(app, q({ url: SRC, format: 'jpg', width: '200' }));
    const res = await get(
      app,
      q({ width: '200', quality: '80', crop: 'fill', format: 'jpeg', url: SRC }),
    );

    expect(res.headers['x-cache']).toBe('HIT');
  });

  it('normalises the source URL (host case, default port)', async () => {
    await get(app, q({ url: SRC }));
    const res = await get(app, q({ url: 'https://IMAGES.example.com:443/photo.jpg' }));

    expect(res.headers['x-cache']).toBe('HIT');
  });

  it('different parameters are different results but reuse the downloaded source', async () => {
    const a = await get(app, q({ url: SRC, width: '100' }));
    const b = await get(app, q({ url: SRC, width: '300' }));

    expect([a.headers['x-cache'], b.headers['x-cache']]).toEqual(['MISS', 'MISS']);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('runs concurrent identical requests once', async () => {
    upstream.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ body: jpeg, contentType: 'image/jpeg' }), 30),
        ),
    );

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => get(app, q({ url: SRC, width: '150' }))),
    );

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(responses.filter((r) => r.headers['x-cache'] === 'MISS')).toHaveLength(1);
  });

  it('does not cache failures', async () => {
    upstream.mockRejectedValueOnce(
      new AppError('UPSTREAM_ERROR', 'The source URL returned HTTP 503'),
    );

    const failed = await get(app, q({ url: SRC }));
    const retried = await get(app, q({ url: SRC }));

    expect(failed.statusCode).toBe(502);
    expect(retried.statusCode).toBe(200);
    expect(retried.headers['x-cache']).toBe('MISS');
  });

  it('can be disabled', async () => {
    const uncached = await buildTestApp(
      { RESULT_CACHE_MAX_BYTES: '0', SOURCE_CACHE_MAX_BYTES: '0' },
      { fetchSource: upstream },
    );
    const a = await get(uncached, q({ url: SRC }));
    const b = await get(uncached, q({ url: SRC }));
    await uncached.close();

    expect([a.headers['x-cache'], b.headers['x-cache']]).toEqual(['MISS', 'MISS']);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

describe('HTTP caching', () => {
  let app: FastifyInstance;
  let etag: string;
  beforeAll(async () => {
    app = await buildTestApp({}, { fetchSource: upstream });
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    etag = String((await get(app, q({ url: SRC, width: '120' }))).headers.etag);
  });

  it('sends Cache-Control and a strong ETag', async () => {
    const res = await get(app, q({ url: SRC, width: '120' }));

    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(etag).toMatch(/^"[\w-]+"$/);
  });

  it.each([
    ['the exact ETag', (e: string) => e],
    ['a weak form', (e: string) => `W/${e}`],
    ['a list containing it', (e: string) => `"stale", ${e}`],
    ['*', () => '*'],
  ])('304 Not Modified for If-None-Match with %s', async (_name, header) => {
    const res = await get(app, q({ url: SRC, width: '120' }), { 'if-none-match': header(etag) });

    expect(res.statusCode).toBe(304);
    expect(res.rawPayload.length).toBe(0);
    expect(res.headers.etag).toBe(etag);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('200 with the image when the ETag does not match', async () => {
    const res = await get(app, q({ url: SRC, width: '120' }), { 'if-none-match': '"stale"' });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('max-age is configurable', async () => {
    const short = await buildTestApp(
      { HTTP_CACHE_MAX_AGE_SECONDS: '60' },
      { fetchSource: upstream },
    );
    const res = await get(short, q({ url: SRC }));
    await short.close();

    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('errors are never cacheable', async () => {
    const res = await get(app, q({ url: SRC, width: 'x' }));

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.etag).toBeUndefined();
  });
});
