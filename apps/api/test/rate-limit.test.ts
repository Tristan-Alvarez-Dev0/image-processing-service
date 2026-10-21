import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FetchedSource } from '../src/services/fetcher.js';
import { buildTestApp } from './support/app.js';
import { makeFixtures } from './support/fixtures.js';

let png: Buffer;
const fetchSource = async (): Promise<FetchedSource> => ({ body: png, contentType: 'image/png' });
const URL_QS = `url=${encodeURIComponent('https://images.example.com/a.png')}`;

beforeAll(async () => {
  png = (await makeFixtures()).png;
});

let app: FastifyInstance;
afterEach(() => app?.close());

const hit = (opts: { ip?: string; headers?: Record<string, string>; url?: string } = {}) =>
  app.inject({
    method: 'GET',
    url: opts.url ?? `/process?${URL_QS}`,
    remoteAddress: opts.ip ?? '203.0.113.10',
    headers: opts.headers,
  });

describe('rate limiting', () => {
  it('allows RATE_LIMIT_MAX requests, then answers 429 in the standard error format', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '3' }, { fetchSource });

    const ok = [await hit(), await hit(), await hit()];
    const limited = await hit();

    expect(ok.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(ok.map((r) => r.headers['x-ratelimit-remaining'])).toEqual(['2', '1', '0']);
    expect(ok[0]!.headers['x-ratelimit-limit']).toBe('3');

    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(limited.json().error).toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringMatching(
        /^Rate limit of 3 requests per 1 minute exceeded\. Try again in \d+ (seconds?|minutes?)\.$/,
      ),
      requestId: expect.any(String),
    });
  });

  it('counts each client IP separately', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1' }, { fetchSource });

    expect((await hit({ ip: '203.0.113.1' })).statusCode).toBe(200);
    expect((await hit({ ip: '203.0.113.1' })).statusCode).toBe(429);
    expect((await hit({ ip: '203.0.113.2' })).statusCode).toBe(200);
  });

  it('ignores X-Forwarded-For unless TRUST_PROXY is on (no spoofing)', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1' }, { fetchSource });

    await hit({ headers: { 'x-forwarded-for': '198.51.100.1' } });
    const spoofed = await hit({ headers: { 'x-forwarded-for': '198.51.100.2' } });

    expect(spoofed.statusCode).toBe(429);
  });

  it('uses X-Forwarded-For behind a trusted proxy', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1', TRUST_PROXY: 'true' }, { fetchSource });

    await hit({ headers: { 'x-forwarded-for': '198.51.100.1' } });
    const otherClient = await hit({ headers: { 'x-forwarded-for': '198.51.100.2' } });

    expect(otherClient.statusCode).toBe(200);
  });

  it('with a hop count, trusts only the address our proxy appended', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1', TRUST_PROXY: '1' }, { fetchSource });
    const viaProxy = (spoofed: string, real: string) =>
      hit({ headers: { 'x-forwarded-for': `${spoofed}, ${real}` } });

    expect((await viaProxy('1.1.1.1', '198.51.100.7')).statusCode).toBe(200);
    expect((await viaProxy('2.2.2.2', '198.51.100.7')).statusCode).toBe(429);
    expect((await viaProxy('2.2.2.2', '198.51.100.8')).statusCode).toBe(200);
  });

  it("finds the real client behind Render's three proxies (chain measured live)", async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1', TRUST_PROXY: '3' }, { fetchSource });
    // What the app received on Render: spoofed value, client, Cloudflare, Render LB;
    // the connection itself comes from a local proxy on 127.0.0.1.
    const viaRender = (spoofed: string, client: string, edge: string, lb: string) =>
      hit({
        ip: '127.0.0.1',
        headers: { 'x-forwarded-for': `${spoofed},${client}, ${edge}, ${lb}` },
      });

    expect(
      (await viaRender('1.1.1.1', '54.242.141.161', '172.70.135.69', '10.27.0.14')).statusCode,
    ).toBe(200);
    // Same client through a different edge and load balancer, with a new spoofed value: still limited.
    expect(
      (await viaRender('9.9.9.9', '54.242.141.161', '104.22.104.151', '10.26.16.133')).statusCode,
    ).toBe(429);
    // A different client is counted separately.
    expect(
      (await viaRender('9.9.9.9', '203.0.113.50', '172.70.34.83', '10.26.16.133')).statusCode,
    ).toBe(200);
  });

  it('never limits /health', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '1' }, { fetchSource });
    await hit();
    await hit();

    const health = await Promise.all(Array.from({ length: 5 }, () => hit({ url: '/health' })));

    expect(health.every((r) => r.statusCode === 200)).toBe(true);
  });

  it('is off when RATE_LIMIT_MAX=0', async () => {
    app = await buildTestApp({ RATE_LIMIT_MAX: '0' }, { fetchSource });

    const responses = await Promise.all(Array.from({ length: 70 }, () => hit()));

    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(responses[0]!.headers['x-ratelimit-limit']).toBeUndefined();
  });
});

describe('GET /debug/client-ip', () => {
  it('does not exist unless DEBUG_CLIENT_IP=true', async () => {
    app = await buildTestApp({}, { fetchSource });

    expect((await app.inject({ method: 'GET', url: '/debug/client-ip' })).statusCode).toBe(404);
  });

  it('shows which address TRUST_PROXY picks as the client', async () => {
    app = await buildTestApp({ DEBUG_CLIENT_IP: 'true', TRUST_PROXY: '1' }, { fetchSource });

    const res = await hit({
      url: '/debug/client-ip',
      headers: { 'x-forwarded-for': '1.1.1.1, 198.51.100.7' },
    });

    expect(res.json()).toEqual({
      ip: '198.51.100.7',
      chain: ['203.0.113.10', '198.51.100.7'],
      forwardedFor: '1.1.1.1, 198.51.100.7',
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
