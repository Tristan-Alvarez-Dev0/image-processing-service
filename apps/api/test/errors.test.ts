import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { ErrorCode } from '../src/errors/app-error.js';
import { buildTestApp, testConfig } from './support/app.js';
import { startFixtureServer, type FixtureServer } from './support/fixture-server.js';
import { makeFixtures } from './support/fixtures.js';

let app: FastifyInstance;
let upstream: FixtureServer;
let closedPortUrl: string;

beforeAll(async () => {
  const f = await makeFixtures();
  upstream = await startFixtureServer({
    '/photo.jpg': { contentType: 'image/jpeg', body: f.jpeg },
    '/page.html': { contentType: 'text/html; charset=utf-8', body: '<html>hi</html>' },
    '/data.json': { contentType: 'application/json', body: '{"a":1}' },
    '/truncated.jpg': { contentType: 'image/jpeg', body: f.jpeg.subarray(0, f.jpeg.length / 3) },
    '/garbage.png': { contentType: 'image/png', body: Buffer.from('definitely not a png') },
    '/gone.jpg': { status: 410 },
    '/forbidden.jpg': { status: 403 },
    '/broken.jpg': { status: 500 },
    '/slow.jpg': { contentType: 'image/jpeg', body: f.jpeg, delayMs: 2_000 },
  });

  // Grab a free port, then close it so connections are refused.
  const tmp = await startFixtureServer({});
  closedPortUrl = tmp.url('/photo.jpg');
  await tmp.close();

  app = await buildTestApp({ FETCH_TIMEOUT_MS: '500' });
});

afterAll(async () => {
  await app.close();
  await upstream.close();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function get(path: string) {
  return app.inject({ method: 'GET', url: path });
}

function processUrl(params: Record<string, string>) {
  const entries = Object.entries(params).map(([k, v]): [string, string] => [
    k,
    k === 'url' && v.startsWith('/') ? upstream.url(v) : v,
  ]);
  return get(`/process?${new URLSearchParams(entries)}`);
}

/** Asserts the response follows the error contract and returns the error object. */
function expectError(res: LightMyRequestResponse, status: number, code: ErrorCode) {
  expect(res.statusCode).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/json/);
  expect(res.headers['cache-control']).toBe('no-store');
  const body = res.json();
  expect(Object.keys(body)).toEqual(['error']);
  expect(body.error).toMatchObject({ code, message: expect.any(String) });
  expect(body.error.requestId).toMatch(UUID);
  expect(body.error.message.length).toBeGreaterThan(10);
  return body.error as { code: string; message: string; param?: string; details?: unknown[] };
}

describe('error contract — 400 validation', () => {
  it('MISSING_PARAMETER when url is absent', async () => {
    const err = expectError(await get('/process?width=100'), 400, 'MISSING_PARAMETER');

    expect(err).toMatchObject({ param: 'url', message: 'url is required' });
  });

  it('MISSING_PARAMETER when url is empty', async () => {
    const err = expectError(await get('/process?url='), 400, 'MISSING_PARAMETER');

    expect(err.param).toBe('url');
  });

  it.each([
    ['relative', 'not-a-url'],
    ['ftp scheme', 'ftp://example.com/a.jpg'],
    ['file scheme', 'file:///etc/passwd'],
    ['javascript scheme', 'javascript:alert(1)'],
  ])('INVALID_URL for a %s url', async (_name, url) => {
    const err = expectError(await processUrl({ url }), 400, 'INVALID_URL');

    expect(err.param).toBe('url');
    expect(err.message).toMatch(/http:\/\/ or https:\/\//);
  });

  it.each([
    ['width', '0', /width must be a whole number from 1 to 4000/],
    ['width', 'abc', /width must be a whole number/],
    ['width', '-5', /width must be a whole number/],
    ['width', '12px', /width must be a whole number/],
    ['width', '1e3', /width must be a whole number/],
    ['width', '', /width must be a whole number/],
    ['height', '1.5', /height must be a whole number/],
    ['quality', '0', /quality must be a whole number from 1 to 100/],
    ['quality', '101', /quality must be a whole number from 1 to 100/],
    ['format', 'bmp', /format must be one of: jpeg, png, webp, avif, gif, jpg/],
    ['crop', 'zoom', /crop must be one of: fill, fit, limit, pad, scale/],
  ])('INVALID_PARAMETER for %s=%s', async (param, value, message) => {
    const err = expectError(
      await processUrl({ url: '/photo.jpg', [param]: value }),
      400,
      'INVALID_PARAMETER',
    );

    expect(err.param).toBe(param);
    expect(err.message).toMatch(message);
  });

  it('rejects unknown parameters and lists the supported ones', async () => {
    const err = expectError(
      await processUrl({ url: '/photo.jpg', widht: '100' }),
      400,
      'INVALID_PARAMETER',
    );

    expect(err.param).toBe('widht');
    expect(err.message).toBe(
      "Unknown parameter 'widht'. Supported parameters: url, width, height, format, quality, crop",
    );
  });

  it('hints at URL-encoding when the source URL looks split', async () => {
    const src = upstream.url('/photo.jpg');
    const err = expectError(await get(`/process?url=${src}?w=1&h=2`), 400, 'INVALID_PARAMETER');

    expect(err.param).toBe('h');
    expect(err.message).toMatch(/URL-encode the url value$/);
  });

  it('rejects a parameter given twice', async () => {
    const err = expectError(
      await get(`/process?url=${encodeURIComponent(upstream.url('/photo.jpg'))}&width=1&width=2`),
      400,
      'INVALID_PARAMETER',
    );

    expect(err).toMatchObject({ param: 'width', message: 'width must be given only once' });
  });

  it('reports every problem in details when there are several', async () => {
    const err = expectError(
      await processUrl({ url: '/photo.jpg', width: 'x', quality: '500' }),
      400,
      'INVALID_PARAMETER',
    );

    expect(err.details).toEqual([
      { param: 'width', message: expect.stringMatching(/^width/) },
      { param: 'quality', message: expect.stringMatching(/^quality/) },
    ]);
  });

  it('omits details when there is a single problem', async () => {
    const err = expectError(
      await processUrl({ url: '/photo.jpg', width: 'x' }),
      400,
      'INVALID_PARAMETER',
    );

    expect(err.details).toBeUndefined();
  });
});

describe('error contract — routing', () => {
  it('NOT_FOUND for unknown routes', async () => {
    const err = expectError(await get('/nope?x=1'), 404, 'NOT_FOUND');

    expect(err.message).toBe('Route GET /nope does not exist. See /docs for available endpoints.');
  });

  it('NOT_FOUND for unsupported methods', async () => {
    const res = await app.inject({ method: 'POST', url: '/process' });

    expectError(res, 404, 'NOT_FOUND');
  });
});

describe('error contract — source problems', () => {
  it.each(['/missing.jpg', '/gone.jpg'])('SOURCE_NOT_FOUND for %s', async (path) => {
    expectError(await processUrl({ url: path }), 404, 'SOURCE_NOT_FOUND');
  });

  it('UNSUPPORTED_MEDIA_TYPE for an HTML page, naming the type received', async () => {
    const err = expectError(await processUrl({ url: '/page.html' }), 415, 'UNSUPPORTED_MEDIA_TYPE');

    expect(err.message).toBe('The source URL did not return an image (got text/html)');
  });

  it('UNSUPPORTED_MEDIA_TYPE for JSON', async () => {
    expectError(await processUrl({ url: '/data.json' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it.each(['/truncated.jpg', '/garbage.png'])(
    'UNPROCESSABLE_IMAGE for corrupt %s',
    async (path) => {
      const err = expectError(await processUrl({ url: path }), 422, 'UNPROCESSABLE_IMAGE');

      expect(err.message).toMatch(/corrupt or truncated/);
    },
  );
});

describe('error contract — upstream failures', () => {
  it.each([
    ['/forbidden.jpg', 'HTTP 403'],
    ['/broken.jpg', 'HTTP 500'],
  ])('UPSTREAM_ERROR when the source returns an error (%s)', async (path, status) => {
    const err = expectError(await processUrl({ url: path }), 502, 'UPSTREAM_ERROR');

    expect(err.message).toBe(`The source URL returned ${status}`);
  });

  it('UPSTREAM_ERROR with a specific message when the connection is refused', async () => {
    const err = expectError(await processUrl({ url: closedPortUrl }), 502, 'UPSTREAM_ERROR');

    expect(err.message).toBe('The source host refused the connection');
  });

  it('UPSTREAM_TIMEOUT when the source is too slow', async () => {
    const err = expectError(await processUrl({ url: '/slow.jpg' }), 504, 'UPSTREAM_TIMEOUT');

    expect(err.message).toBe('The source URL did not respond within 0.5s');
  });
});

describe('error contract — unexpected errors', () => {
  it('INTERNAL_ERROR without leaking internals', async () => {
    const crashing = await buildApp(testConfig(), {
      fetchSource: async () => {
        throw new Error('db password is hunter2 at /srv/app/secret.ts:42');
      },
    });

    const res = await crashing.inject({
      method: 'GET',
      url: `/process?url=${encodeURIComponent('https://example.com/a.jpg')}`,
    });
    await crashing.close();

    const err = expectError(res, 500, 'INTERNAL_ERROR');
    expect(res.body).not.toMatch(/hunter2|secret\.ts|stack/);
    expect(err.message).toBe('Something went wrong on our side. Please try again later.');
  });
});

describe('request IDs', () => {
  it('gives every request a unique id', async () => {
    const a = (await get('/nope')).json().error.requestId;
    const b = (await get('/nope')).json().error.requestId;

    expect(a).not.toBe(b);
  });
});
