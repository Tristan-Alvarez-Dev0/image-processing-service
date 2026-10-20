import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './support/app.js';
import { startFixtureServer, type FixtureServer } from './support/fixture-server.js';
import { makeFixtures } from './support/fixtures.js';

let app: FastifyInstance;
let upstream: FixtureServer;

beforeAll(async () => {
  const f = await makeFixtures();
  upstream = await startFixtureServer({
    '/photo.jpg': { contentType: 'image/jpeg', body: f.jpeg },
    '/alpha.png': { contentType: 'image/png', body: f.png },
    '/rotated.jpg': { contentType: 'image/jpeg', body: f.rotatedJpeg },
    '/animated.gif': { contentType: 'image/gif', body: f.animatedGif },
    '/drawing.svg': { contentType: 'image/svg+xml', body: f.svg },
    '/page.html': { contentType: 'text/html', body: '<html>hi</html>' },
    '/broken': { status: 500 },
    '/slow.jpg': { contentType: 'image/jpeg', body: f.jpeg, delayMs: 2_000 },
  });
  app = await buildTestApp({ FETCH_TIMEOUT_MS: '500' });
});

afterAll(async () => {
  await app.close();
  await upstream.close();
});

/** Builds a query string; `url` values starting with `/` point at the fixture server. */
function toQuery(params: Record<string, string | number>): string {
  const entries = Object.entries(params).map(([k, v]): [string, string] => [
    k,
    k === 'url' && String(v).startsWith('/') ? upstream.url(String(v)) : String(v),
  ]);
  return new URLSearchParams(entries).toString();
}

function process(params: Record<string, string | number>) {
  return app.inject({ method: 'GET', url: `/process?${toQuery(params)}` });
}

async function outputMeta(res: LightMyRequestResponse) {
  return sharp(res.rawPayload).metadata();
}

describe('GET /process — resize', () => {
  it('resizes to exact width and height', async () => {
    const res = await process({ url: '/photo.jpg', width: 500, height: 300 });

    expect(res.statusCode).toBe(200);
    const meta = await outputMeta(res);
    expect([meta.width, meta.height]).toEqual([500, 300]);
  });

  it('keeps aspect ratio when only width is given', async () => {
    const meta = await outputMeta(await process({ url: '/photo.jpg', width: 400 }));

    expect([meta.width, meta.height]).toEqual([400, 300]);
  });

  it('keeps aspect ratio when only height is given', async () => {
    const meta = await outputMeta(await process({ url: '/photo.jpg', height: 150 }));

    expect([meta.width, meta.height]).toEqual([200, 150]);
  });

  it('returns the original dimensions when no size is given', async () => {
    const meta = await outputMeta(await process({ url: '/photo.jpg' }));

    expect([meta.width, meta.height]).toEqual([800, 600]);
  });

  it('applies EXIF orientation before resizing', async () => {
    const res = await process({ url: '/rotated.jpg', width: 400 });
    const meta = await outputMeta(res);

    expect([meta.width, meta.height]).toEqual([400, 300]);
    expect(res.headers['x-original-width']).toBe('800');
    expect(res.headers['x-original-height']).toBe('600');
  });
});

describe('GET /process — crop modes (800x600 source into a 300x300 box)', () => {
  it.each([
    ['fill', 300, 300],
    ['fit', 300, 225],
    ['pad', 300, 300],
    ['scale', 300, 300],
  ])('crop=%s returns %ix%i', async (crop, w, h) => {
    const meta = await outputMeta(
      await process({ url: '/photo.jpg', width: 300, height: 300, crop }),
    );

    expect([meta.width, meta.height]).toEqual([w, h]);
  });

  it('crop=limit never upscales beyond the source', async () => {
    const meta = await outputMeta(
      await process({ url: '/photo.jpg', width: 2000, height: 2000, crop: 'limit' }),
    );

    expect([meta.width, meta.height]).toEqual([800, 600]);
  });

  it('crop=fit does upscale', async () => {
    const meta = await outputMeta(
      await process({ url: '/photo.jpg', width: 1600, height: 1600, crop: 'fit' }),
    );

    expect([meta.width, meta.height]).toEqual([1600, 1200]);
  });

  it('crop=pad keeps transparency for formats with alpha', async () => {
    const meta = await outputMeta(
      await process({ url: '/photo.jpg', width: 300, height: 300, crop: 'pad', format: 'png' }),
    );

    expect(meta.hasAlpha).toBe(true);
  });

  it('defaults to crop=fill', async () => {
    const meta = await outputMeta(await process({ url: '/photo.jpg', width: 300, height: 300 }));

    expect([meta.width, meta.height]).toEqual([300, 300]);
  });
});

describe('GET /process — format conversion', () => {
  it.each([
    ['jpeg', 'image/jpeg', 'jpeg'],
    ['jpg', 'image/jpeg', 'jpeg'],
    ['png', 'image/png', 'png'],
    ['webp', 'image/webp', 'webp'],
    ['avif', 'image/avif', 'heif'],
    ['gif', 'image/gif', 'gif'],
  ])('format=%s returns %s', async (format, contentType, decoded) => {
    const res = await process({ url: '/alpha.png', format });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(contentType);
    // Check the actual bytes, not just the header.
    expect((await outputMeta(res)).format).toBe(decoded);
  });

  it('is case-insensitive', async () => {
    const res = await process({ url: '/alpha.png', format: 'WEBP' });

    expect(res.headers['content-type']).toBe('image/webp');
  });

  it('keeps the source format by default', async () => {
    const res = await process({ url: '/alpha.png', width: 100 });

    expect(res.headers['content-type']).toBe('image/png');
  });

  it('falls back to PNG when the source format cannot be encoded (SVG)', async () => {
    const res = await process({ url: '/drawing.svg', width: 200 });

    expect(res.headers['content-type']).toBe('image/png');
    expect((await outputMeta(res)).width).toBe(200);
  });

  it('flattens transparency onto white when converting to JPEG', async () => {
    const res = await process({ url: '/alpha.png', format: 'jpeg' });
    const { data } = await sharp(res.rawPayload).raw().toBuffer({ resolveWithObject: true });

    // Source is rgba(0,128,255,0.5); over white that is roughly (128,191,255).
    expect(data[0]).toBeGreaterThan(110);
    expect(data[1]).toBeGreaterThan(175);
  });

  it('keeps animation for GIF output', async () => {
    const res = await process({ url: '/animated.gif', width: 50 });
    const meta = await sharp(res.rawPayload, { animated: true }).metadata();

    expect(meta.pages).toBe(2);
    expect([meta.width, meta.pageHeight]).toEqual([50, 40]);
  });

  it('uses the first frame for formats without animation', async () => {
    const meta = await outputMeta(await process({ url: '/animated.gif', format: 'jpeg' }));

    expect([meta.width, meta.height]).toEqual([100, 80]);
  });
});

describe('GET /process — quality', () => {
  it('lower quality produces a smaller file', async () => {
    const low = await process({ url: '/photo.jpg', format: 'jpeg', quality: 10 });
    const high = await process({ url: '/photo.jpg', format: 'jpeg', quality: 90 });

    expect(low.rawPayload.length).toBeLessThan(high.rawPayload.length);
  });

  it.each(['webp', 'avif'])('applies to %s', async (format) => {
    const low = await process({ url: '/photo.jpg', format, quality: 10 });
    const high = await process({ url: '/photo.jpg', format, quality: 90 });

    expect(low.rawPayload.length).toBeLessThan(high.rawPayload.length);
  });
});

describe('GET /process — response headers', () => {
  it('reports original image metadata and output size', async () => {
    const res = await process({ url: '/photo.jpg', width: 200, format: 'webp' });

    expect(res.headers).toMatchObject({
      'content-type': 'image/webp',
      'content-length': String(res.rawPayload.length),
      'content-disposition': 'inline; filename="image.webp"',
      'x-original-width': '800',
      'x-original-height': '600',
      'x-original-format': 'jpeg',
    });
    expect(Number(res.headers['x-original-size'])).toBeGreaterThan(0);
  });
});

describe('GET /process — basic failures', () => {
  it.each<{ name: string; params: Record<string, string | number> }>([
    { name: 'missing url', params: {} },
    { name: 'relative url', params: { url: 'not-a-url' } },
    { name: 'non-http url', params: { url: 'ftp://example.com/a.jpg' } },
    { name: 'zero width', params: { url: '/photo.jpg', width: 0 } },
    { name: 'non-numeric width', params: { url: '/photo.jpg', width: 'abc' } },
    { name: 'fractional height', params: { url: '/photo.jpg', height: 1.5 } },
    { name: 'quality > 100', params: { url: '/photo.jpg', quality: 101 } },
    { name: 'unknown format', params: { url: '/photo.jpg', format: 'bmp' } },
    { name: 'unknown crop', params: { url: '/photo.jpg', crop: 'zoom' } },
  ])('rejects $name with 400', async ({ params }) => {
    const res = await process(params);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_PARAMETER', message: expect.any(String) });
  });

  it('returns 404 when the source does not exist', async () => {
    const res = await process({ url: '/missing.jpg' });

    expect(res.statusCode).toBe(404);
  });

  it('returns 502 when the source errors', async () => {
    const res = await process({ url: '/broken' });

    expect(res.statusCode).toBe(502);
  });

  it('returns 504 when the source is too slow', async () => {
    const res = await process({ url: '/slow.jpg' });

    expect(res.statusCode).toBe(504);
  });

  it('returns 422 when the source is not a decodable image', async () => {
    const res = await process({ url: '/page.html' });

    expect(res.statusCode).toBe(422);
  });
});

describe('GET /process — upstream request', () => {
  it('identifies itself with a User-Agent and asks for images', async () => {
    await process({ url: '/photo.jpg' });
    const headers = upstream.lastHeaders.get('/photo.jpg');

    expect(headers?.['user-agent']).toMatch(/^ImageProcessingService\/\d+\.\d+\.\d+/);
    expect(headers?.['accept']).toMatch(/^image\/\*/);
  });
});
