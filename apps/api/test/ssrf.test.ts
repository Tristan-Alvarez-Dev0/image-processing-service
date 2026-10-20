import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AddressPolicy } from '../src/security/address-policy.js';
import type { Resolver } from '../src/security/target-policy.js';
import { createFetcher, type FetchOptions } from '../src/services/fetcher.js';
import { buildTestApp } from './support/app.js';
import { startFixtureServer, type FixtureServer } from './support/fixture-server.js';
import { makeFixtures } from './support/fixtures.js';

let upstream: FixtureServer;
let port: number;
/** Production-like: no private addresses allowed (any port, so we test addresses alone). */
let strict: FastifyInstance;
/** Production-like ports (80, 443) too. */
let strictPorts: FastifyInstance;
/** Allows only the fixture server's 127.0.0.1, so redirects away from it are tested. */
let dev: FastifyInstance;

beforeAll(async () => {
  const f = await makeFixtures();
  upstream = await startFixtureServer({
    '/photo.jpg': { contentType: 'image/jpeg', body: f.jpeg },
    '/hop1': { status: 302, headers: { Location: '/hop2' } },
    '/hop2': { status: 301, headers: { Location: '/photo.jpg' } },
    '/loop': { status: 302, headers: { Location: '/loop' } },
    '/no-location': { status: 302 },
    '/to-metadata': {
      status: 302,
      headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
    },
    '/to-private': { status: 307, headers: { Location: 'http://10.0.0.1/a.jpg' } },
    '/to-localhost': { status: 302, headers: { Location: 'http://localhost/a.jpg' } },
    '/to-decimal-ip': { status: 302, headers: { Location: 'http://167772161/a.jpg' } },
    '/to-ftp': { status: 302, headers: { Location: 'ftp://example.com/a.jpg' } },
    '/to-creds': { status: 302, headers: { Location: 'http://user:pw@example.com/a.jpg' } },
  });
  port = Number(new URL(upstream.url('/')).port);

  strict = await buildTestApp({ ALLOW_PRIVATE_ADDRESSES: '', ALLOWED_PORTS: '*' });
  strictPorts = await buildTestApp({ ALLOW_PRIVATE_ADDRESSES: '', ALLOWED_PORTS: '80,443' });
  dev = await buildTestApp();
});

afterAll(async () => {
  await Promise.all([strict.close(), strictPorts.close(), dev.close(), upstream.close()]);
});

const get = (app: FastifyInstance, url: string) =>
  app.inject({ method: 'GET', url: `/process?url=${encodeURIComponent(url)}` });

describe('SSRF — blocked destinations', () => {
  it.each([
    ['http://127.0.0.1/a.jpg', 'loopback'],
    ['http://localhost/a.jpg', 'localhost'],
    ['http://LOCALHOST./a.jpg', 'localhost with trailing dot'],
    ['http://images.localhost/a.jpg', '*.localhost'],
    ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP metadata'],
    ['http://10.0.0.1/a.jpg', 'RFC 1918'],
    ['http://172.16.0.1/a.jpg', 'RFC 1918'],
    ['http://192.168.1.1/a.jpg', 'RFC 1918'],
    ['http://0.0.0.0/a.jpg', 'unspecified'],
    ['http://100.64.0.1/a.jpg', 'CGNAT'],
    ['http://2130706433/a.jpg', 'decimal-encoded 127.0.0.1'],
    ['http://0x7f.1/a.jpg', 'hex-encoded 127.0.0.1'],
    ['http://0177.0.0.1/a.jpg', 'octal-encoded 127.0.0.1'],
    ['http://127.1/a.jpg', 'shortened 127.0.0.1'],
    ['http://[::1]/a.jpg', 'IPv6 loopback'],
    ['http://[::ffff:127.0.0.1]/a.jpg', 'IPv4-mapped IPv6'],
    ['http://[fd00::1]/a.jpg', 'IPv6 unique-local'],
    ['http://[fe80::1]/a.jpg', 'IPv6 link-local'],
  ])('403 FORBIDDEN_HOST for %s (%s)', async (url) => {
    const res = await get(strict, url);

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN_HOST');
  });

  it('blocks the fixture server itself without the dev exception', async () => {
    const res = await get(strict, upstream.url('/photo.jpg'));

    expect(res.statusCode).toBe(403);
    expect(upstream.hits.get('/photo.jpg') ?? 0).toBe(0);
  });

  it('the same URL works with the dev exception (proves the test above is meaningful)', async () => {
    expect((await get(dev, upstream.url('/photo.jpg'))).statusCode).toBe(200);
  });
});

describe('SSRF — ports', () => {
  it.each([22, 25, 3306, 6379, 8080])('403 for port %i', async (p) => {
    const res = await get(strictPorts, `http://example.com:${p}/a.jpg`);

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe(`The url uses port ${p}; only ports 80, 443 are allowed`);
  });
});

describe('SSRF — URL shape', () => {
  it('rejects credentials in the URL', async () => {
    const res = await get(strict, 'https://user:secret@example.com/a.jpg');

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_URL', param: 'url' });
  });

  it('rejects URLs longer than 2048 characters', async () => {
    const res = await get(strict, `https://example.com/${'a'.repeat(2048)}.jpg`);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'INVALID_URL',
      message: 'url must be at most 2048 characters',
    });
  });
});

describe('SSRF — redirects are re-validated on every hop', () => {
  it('follows a chain of safe redirects (relative and absolute)', async () => {
    const res = await get(dev, upstream.url('/hop1'));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
  });

  it.each([
    ['/to-metadata', 'cloud metadata'],
    ['/to-private', '10.0.0.1'],
    ['/to-localhost', 'localhost'],
    ['/to-decimal-ip', 'decimal-encoded 10.0.0.1'],
  ])('403 when %s redirects to %s', async (path) => {
    const res = await get(dev, upstream.url(path));

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN_HOST');
    expect(res.json().error.message).toMatch(/^The source URL redirected to a URL that/);
  });

  it('502 when redirected to a non-http scheme', async () => {
    const res = await get(dev, upstream.url('/to-ftp'));

    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toMatch(/is not http\(s\) \(ftp:\)/);
  });

  it('502 when redirected to a URL with credentials', async () => {
    const res = await get(dev, upstream.url('/to-creds'));

    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toMatch(/contains credentials/);
  });

  it('502 when a redirect has no Location', async () => {
    const res = await get(dev, upstream.url('/no-location'));

    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toBe('The source URL redirected without a Location');
  });

  it('stops after 3 redirects', async () => {
    upstream.hits.delete('/loop');
    const res = await get(dev, upstream.url('/loop'));

    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toBe('The source URL redirected more than 3 times');
    expect(upstream.hits.get('/loop')).toBe(4); // the original request + 3 redirects
  });
});

describe('SSRF — DNS answers are checked on the connection itself', () => {
  const baseOptions = (resolve: Resolver, exceptions: string[] = []): FetchOptions => ({
    timeoutMs: 2_000,
    maxBytes: 10_000_000,
    maxRedirects: 3,
    addresses: new AddressPolicy(exceptions),
    allowedPorts: '*',
    userAgent: 'test',
    resolve,
  });

  const resolvesTo =
    (...ips: string[]): Resolver =>
    (_host, _family, cb) =>
      cb(
        null,
        ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      );

  it('403 when a public-looking hostname resolves to a private address', async () => {
    const fetcher = createFetcher(baseOptions(resolvesTo('127.0.0.1')));

    await expect(fetcher.fetch(`http://evil.test:${port}/photo.jpg`)).rejects.toMatchObject({
      code: 'FORBIDDEN_HOST',
      message:
        'The source host evil.test resolves to a private or reserved IP address, which is not allowed',
    });
    await fetcher.close();
  });

  it('403 when any one of several resolved addresses is private', async () => {
    const fetcher = createFetcher(baseOptions(resolvesTo('93.184.216.34', '10.0.0.5')));

    await expect(fetcher.fetch('http://mixed.test/a.jpg')).rejects.toMatchObject({
      code: 'FORBIDDEN_HOST',
    });
    await fetcher.close();
  });

  it('connects to exactly the address that was validated, resolving once', async () => {
    let lookups = 0;
    const resolve: Resolver = (host, family, cb) => {
      lookups++;
      resolvesTo('127.0.0.1')(host, family, cb);
    };
    // `images.test` does not exist in real DNS, so success proves our lookup was used.
    const fetcher = createFetcher(baseOptions(resolve, ['127.0.0.1']));

    const result = await fetcher.fetch(`http://images.test:${port}/photo.jpg`);
    await fetcher.close();

    expect(result.body.length).toBeGreaterThan(0);
    expect(lookups).toBe(1);
    expect(upstream.lastHeaders.get('/photo.jpg')?.host).toBe(`images.test:${port}`);
  });
});
