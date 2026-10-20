import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from './support/app.js';
import { startFixtureServer, type FixtureServer } from './support/fixture-server.js';
import { makeFixtures } from './support/fixtures.js';

let upstream: FixtureServer;
let app: FastifyInstance;
let bombBytes: number;

beforeAll(async () => {
  const f = await makeFixtures();
  // 8000x8000 = 64 MP decoded (~190 MB of RGB) from a ~200 KB file.
  const bomb = await sharp({
    create: { width: 8000, height: 8000, channels: 3, background: 'white' },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  bombBytes = bomb.length;
  const tall = await sharp({
    create: { width: 10, height: 2000, channels: 3, background: 'black' },
  })
    .png()
    .toBuffer();
  const big = Buffer.alloc(50_000, 0xff);

  upstream = await startFixtureServer({
    '/photo.jpg': { contentType: 'image/jpeg', body: f.jpeg },
    '/alpha.png': { contentType: 'image/png', body: f.png },
    '/animated.gif': { contentType: 'image/gif', body: f.animatedGif },
    '/bomb.png': { contentType: 'image/png', body: bomb },
    '/tall.png': { contentType: 'image/png', body: tall },
    '/big-declared.jpg': { contentType: 'image/jpeg', body: big },
    '/big-chunked.jpg': { contentType: 'image/jpeg', body: big, chunked: true },
    '/small-chunked.png': { contentType: 'image/png', body: f.png, chunked: true },
  });
  app = await buildTestApp();
});

afterAll(async () => {
  await Promise.all([app.close(), upstream.close()]);
});

const query = (params: Record<string, string | number>) =>
  new URLSearchParams(
    Object.entries(params).map(([k, v]): [string, string] => [
      k,
      k === 'url' ? upstream.url(String(v)) : String(v),
    ]),
  ).toString();

const process = (target: FastifyInstance, params: Record<string, string | number>) =>
  target.inject({ method: 'GET', url: `/process?${query(params)}` });

describe('limit — source size', () => {
  let small: FastifyInstance;
  beforeAll(async () => {
    small = await buildTestApp({ MAX_SOURCE_BYTES: '20000' });
  });
  afterAll(() => small.close());

  it('413 from an honest Content-Length, before downloading', async () => {
    const res = await process(small, { url: '/big-declared.jpg' });

    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({
      code: 'SOURCE_TOO_LARGE',
      message: 'The source is 49 KB, over the 20 KB limit',
    });
  });

  it('413 while streaming when there is no Content-Length', async () => {
    const res = await process(small, { url: '/big-chunked.jpg' });

    expect(res.statusCode).toBe(413);
    expect(res.json().error.message).toBe('The source is larger than the 20 KB limit');
  });

  it('accepts chunked sources under the limit', async () => {
    expect((await process(small, { url: '/small-chunked.png' })).statusCode).toBe(200);
  });
});

describe('limit — output dimensions', () => {
  it.each(['width', 'height'])('400 when %s exceeds 4000', async (param) => {
    const res = await process(app, { url: '/photo.jpg', [param]: 4001 });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'INVALID_PARAMETER',
      param,
      message: `${param} must be a whole number from 1 to 4000`,
    });
  });

  it('allows exactly 4000', async () => {
    const res = await process(app, { url: '/alpha.png', width: 4000, height: 10, crop: 'scale' });

    expect(res.statusCode).toBe(200);
  });

  it('is configurable via MAX_OUTPUT_DIMENSION', async () => {
    const tight = await buildTestApp({ MAX_OUTPUT_DIMENSION: '500' });
    const res = await process(tight, { url: '/photo.jpg', width: 501 });
    await tight.close();

    expect(res.json().error.message).toBe('width must be a whole number from 1 to 500');
  });

  it('400 when one side would explode because the other side is derived', async () => {
    // 10x2000 source at width=4000 keeps aspect ratio -> 4000x800000.
    const res = await process(app, { url: '/tall.png', width: 4000 });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_PARAMETER', param: 'width' });
    expect(res.json().error.message).toMatch(
      /^The output would be about 3200 MP; the limit is 50 MP/,
    );
  });
});

describe('limit — decompression bombs', () => {
  it(`413 for a small file that decodes to 64 MP, rejected from the header`, async () => {
    const started = Date.now();
    const res = await process(app, { url: '/bomb.png', width: 100 });

    expect(bombBytes).toBeLessThan(300_000);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({
      code: 'SOURCE_TOO_LARGE',
      message: 'The source image is 8000x8000 (64 MP); the limit is 50 MP',
    });
    expect(Date.now() - started).toBeLessThan(1_000); // never decoded
  });

  it('counts every frame of an animation', async () => {
    const tight = await buildTestApp({ MAX_INPUT_PIXELS: '10000' });
    const res = await process(tight, { url: '/animated.gif' });
    await tight.close();

    expect(res.statusCode).toBe(413);
    expect(res.json().error.message).toBe(
      'The source image is 100x80 across 2 frames (16,000 pixels); the limit is 10,000 pixels',
    );
  });

  it('counts every output frame when upscaling an animation', async () => {
    const tight = await buildTestApp({ MAX_INPUT_PIXELS: '100000' });
    // 300x240 per frame: one frame (72k px) fits, two animated frames (144k px) do not.
    const animated = await process(tight, { url: '/animated.gif', width: 300 });
    const still = await process(tight, { url: '/animated.gif', width: 300, format: 'jpeg' });
    await tight.close();

    expect(animated.statusCode).toBe(400);
    expect(animated.json().error.message).toMatch(/across 2 frames/);
    expect(still.statusCode).toBe(200);
  });
});
