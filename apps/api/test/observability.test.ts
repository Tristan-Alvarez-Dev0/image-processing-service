import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { FetchedSource, SourceFetcher } from '../src/services/fetcher.js';
import { buildTestApp } from './support/app.js';
import { makeFixtures } from './support/fixtures.js';

let png: Buffer;
const fetchSource: SourceFetcher = async (): Promise<FetchedSource> => ({
  body: png,
  contentType: 'image/png',
});
const SECRET_URL = 'https://cdn.example.com/private/a.png?token=SECRET-TOKEN-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeAll(async () => {
  png = (await makeFixtures()).png;
});

function logCollector() {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        raw.push(line);
        lines.push(JSON.parse(line));
      }
      done();
    },
  });
  return {
    stream,
    lines,
    raw,
    completed: () => lines.filter((l) => l.msg === 'request completed'),
  };
}

let app: FastifyInstance;
afterEach(() => app?.close());

const processUrl = (url = SECRET_URL, extra = '') =>
  `/process?url=${encodeURIComponent(url)}${extra}`;

function sample(
  text: string,
  name: string,
  labels: Record<string, string> = {},
): number | undefined {
  const line = text
    .split('\n')
    .find(
      (l) =>
        (l.startsWith(`${name}{`) || l.startsWith(`${name} `)) &&
        Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)),
    );
  return line === undefined ? undefined : Number(line.split(' ').pop());
}

describe('request IDs', () => {
  it('sends X-Request-Id on every response, matching the error body', async () => {
    app = await buildTestApp({}, { fetchSource });

    const ok = await app.inject({ method: 'GET', url: processUrl() });
    const bad = await app.inject({ method: 'GET', url: '/process' });

    expect(ok.headers['x-request-id']).toMatch(UUID);
    expect(bad.headers['x-request-id']).toBe(bad.json().error.requestId);
    expect(ok.headers['x-request-id']).not.toBe(bad.headers['x-request-id']);
  });

  it('reuses a safe incoming X-Request-Id', async () => {
    app = await buildTestApp({}, { fetchSource });

    const res = await app.inject({
      method: 'GET',
      url: '/process',
      headers: { 'x-request-id': 'trace-abc.123:xyz' },
    });

    expect(res.headers['x-request-id']).toBe('trace-abc.123:xyz');
    expect(res.json().error.requestId).toBe('trace-abc.123:xyz');
  });

  it.each([
    ['spaces', 'a b'],
    ['quotes', '"injected"'],
    ['too long', 'x'.repeat(129)],
    ['JSON', '{"level":60}'],
  ])('replaces an unsafe incoming ID (%s)', async (_name, id) => {
    app = await buildTestApp({}, { fetchSource });

    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': id },
    });

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('is present on 304 and 429 responses too', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '2' }, { fetchSource });
    const first = await app.inject({ method: 'GET', url: processUrl() });
    const notModified = await app.inject({
      method: 'GET',
      url: processUrl(),
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    const limited = await app.inject({ method: 'GET', url: processUrl() });

    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers['x-request-id']).toMatch(UUID);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['x-request-id']).toBe(limited.json().error.requestId);
  });
});

describe('structured logs', () => {
  it('writes one JSON line per request with the useful fields', async () => {
    const logs = logCollector();
    app = await buildTestApp({ LOG_LEVEL: 'info' }, { fetchSource, logStream: logs.stream });

    const res = await app.inject({ method: 'GET', url: processUrl(SECRET_URL, '&width=50') });
    await app.inject({ method: 'GET', url: processUrl(SECRET_URL, '&width=50') });

    const [miss, hit] = logs.completed();
    expect(logs.completed()).toHaveLength(2);
    expect(miss).toMatchObject({
      level: 30,
      requestId: res.headers['x-request-id'],
      method: 'GET',
      route: '/process',
      status: 200,
      cache: 'MISS',
      sourceHost: 'cdn.example.com',
      durationMs: expect.any(Number),
    });
    expect(hit).toMatchObject({ cache: 'HIT' });
  });

  it('never logs source URLs, query strings or client IPs', async () => {
    const logs = logCollector();
    app = await buildTestApp({ LOG_LEVEL: 'trace' }, { fetchSource, logStream: logs.stream });

    await app.inject({ method: 'GET', url: processUrl(), remoteAddress: '203.0.113.77' });
    await app.inject({
      method: 'GET',
      url: processUrl(SECRET_URL, '&width=oops'),
      remoteAddress: '203.0.113.77',
    });

    const all = logs.raw.join('\n');
    expect(logs.completed().length).toBeGreaterThanOrEqual(2);
    expect(all).not.toMatch(/SECRET-TOKEN|token=|\/private\/|203\.0\.113\.77/);
  });

  it('records the error code of failed requests', async () => {
    const logs = logCollector();
    app = await buildTestApp({}, { fetchSource, logStream: logs.stream });

    await app.inject({ method: 'GET', url: processUrl(SECRET_URL, '&width=oops') });

    expect(logs.completed()[0]).toMatchObject({
      level: 30,
      status: 400,
      errorCode: 'INVALID_PARAMETER',
    });
  });

  it('logs unexpected errors at error level, with the stack, once per request', async () => {
    const logs = logCollector();
    app = await buildTestApp(
      {},
      {
        logStream: logs.stream,
        fetchSource: async () => {
          throw new Error('kaboom');
        },
      },
    );

    await app.inject({ method: 'GET', url: processUrl() });

    const unhandled = logs.lines.find((l) => l.msg === 'unhandled error') as {
      level: number;
      err: { stack: string };
    };
    expect(unhandled.level).toBe(50);
    expect(unhandled.err.stack).toMatch(/kaboom/);
    expect(logs.completed()).toEqual([
      expect.objectContaining({ level: 50, status: 500, errorCode: 'INTERNAL_ERROR' }),
    ]);
  });

  it('logs /health and /metrics at debug level only', async () => {
    const info = logCollector();
    app = await buildTestApp({ LOG_LEVEL: 'info' }, { fetchSource, logStream: info.stream });
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();

    const debug = logCollector();
    app = await buildTestApp({ LOG_LEVEL: 'debug' }, { fetchSource, logStream: debug.stream });
    await app.inject({ method: 'GET', url: '/health' });

    expect(info.completed()).toHaveLength(0);
    expect(debug.completed()).toEqual([expect.objectContaining({ level: 20, route: '/health' })]);
  });

  it('labels unknown paths as unmatched and keeps the path short', async () => {
    const logs = logCollector();
    app = await buildTestApp({}, { fetchSource, logStream: logs.stream });

    await app.inject({ method: 'GET', url: `/${'a'.repeat(500)}?q=secret` });

    const [line] = logs.completed() as [{ route: string; path: string }];
    expect(line.route).toBe('unmatched');
    expect(line.path).toHaveLength(200);
    expect(JSON.stringify(line)).not.toMatch(/secret/);
  });
});

describe('GET /metrics', () => {
  const scrape = async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    return res.body;
  };

  it('serves Prometheus text with process metrics', async () => {
    app = await buildTestApp({}, { fetchSource });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatch(/^process_cpu_user_seconds_total /m);
    expect(res.body).toMatch(/^nodejs_eventloop_lag_seconds /m);
  });

  it('counts requests and latency by route and status', async () => {
    app = await buildTestApp({}, { fetchSource });
    await app.inject({ method: 'GET', url: processUrl() });
    await app.inject({ method: 'GET', url: processUrl() });
    await app.inject({ method: 'GET', url: '/process?width=1' });

    const text = await scrape();

    const req = (status: string) =>
      sample(text, 'http_requests_total', { route: '/process', status_code: status });
    expect(req('200')).toBe(2);
    expect(req('400')).toBe(1);
    expect(
      sample(text, 'http_request_duration_seconds_count', { route: '/process', method: 'GET' }),
    ).toBe(3);
  });

  it('exposes cache hits and misses, so the hit rate can be computed', async () => {
    app = await buildTestApp({}, { fetchSource });
    await app.inject({ method: 'GET', url: processUrl() });
    await app.inject({ method: 'GET', url: processUrl() });
    await app.inject({ method: 'GET', url: processUrl(SECRET_URL, '&width=10') });

    const text = await scrape();

    expect(sample(text, 'ips_cache_lookups_total', { cache: 'result', result: 'miss' })).toBe(2);
    expect(sample(text, 'ips_cache_lookups_total', { cache: 'result', result: 'hit' })).toBe(1);
    expect(sample(text, 'ips_cache_lookups_total', { cache: 'source', result: 'miss' })).toBe(1);
    expect(sample(text, 'ips_cache_lookups_total', { cache: 'source', result: 'hit' })).toBe(1);
    expect(sample(text, 'ips_cache_entries', { cache: 'result' })).toBe(2);
    expect(sample(text, 'ips_cache_bytes', { cache: 'result' })).toBeGreaterThan(0);
  });

  it('counts errors by code', async () => {
    app = await buildTestApp({}, { fetchSource });
    await app.inject({ method: 'GET', url: '/process' });
    await app.inject({ method: 'GET', url: '/process?url=x' });
    await app.inject({ method: 'GET', url: '/nope' });

    const text = await scrape();

    expect(sample(text, 'ips_errors_total', { code: 'MISSING_PARAMETER' })).toBe(1);
    expect(sample(text, 'ips_errors_total', { code: 'INVALID_URL' })).toBe(1);
    expect(sample(text, 'ips_errors_total', { code: 'NOT_FOUND' })).toBe(1);
  });

  it('times upstream fetches and processing', async () => {
    app = await buildTestApp({}, { fetchSource });
    await app.inject({ method: 'GET', url: processUrl() });

    const text = await scrape();

    expect(sample(text, 'ips_upstream_fetch_duration_seconds_count', { outcome: 'ok' })).toBe(1);
    expect(sample(text, 'ips_processing_duration_seconds_count', { kind: 'image' })).toBe(1);
    expect(sample(text, 'ips_jobs', { state: 'active' })).toBe(0);
    expect(sample(text, 'ips_jobs', { state: 'waiting' })).toBe(0);
  });

  it('groups unknown paths into one series (no label explosion)', async () => {
    app = await buildTestApp({}, { fetchSource });
    for (const path of ['/a', '/b', '/c/d', '/wp-admin.php']) {
      await app.inject({ method: 'GET', url: path });
    }

    const text = await scrape();

    expect(sample(text, 'http_requests_total', { route: 'unmatched' })).toBe(4);
    expect(text).not.toMatch(/wp-admin/);
  });

  it('keeps metrics separate per app instance', async () => {
    const other = await buildTestApp({}, { fetchSource });
    await other.inject({ method: 'GET', url: '/nope' });
    await other.close();
    app = await buildTestApp({}, { fetchSource });

    expect(sample(await scrape(), 'http_requests_total', { route: 'unmatched' })).toBeUndefined();
  });

  it('is not rate limited', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1' }, { fetchSource });

    const statuses = await Promise.all(
      [1, 2, 3].map(async () => (await app.inject({ method: 'GET', url: '/metrics' })).statusCode),
    );

    expect(statuses).toEqual([200, 200, 200]);
  });

  describe('with METRICS_TOKEN', () => {
    const TOKEN = 'a-long-random-metrics-token';

    it.each([
      ['no header', undefined],
      ['a wrong token', 'Bearer wrong-token-of-some-length'],
      ['the token without Bearer', TOKEN],
    ])('401 with %s', async (_name, authorization) => {
      app = await buildTestApp({ METRICS_TOKEN: TOKEN }, { fetchSource });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: authorization ? { authorization } : {},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    it('200 with the right token', async () => {
      app = await buildTestApp({ METRICS_TOKEN: TOKEN }, { fetchSource });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('must be at least 16 characters', () => {
      expect(() => loadConfig({ METRICS_TOKEN: 'short' })).toThrow(/METRICS_TOKEN/);
      expect(loadConfig({ METRICS_TOKEN: '' }).METRICS_TOKEN).toBeUndefined();
    });
  });
});
