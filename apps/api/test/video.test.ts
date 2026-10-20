import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchCallOptions, FetchedSource } from '../src/services/fetcher.js';
import { buildTestApp } from './support/app.js';
import { startFixtureServer } from './support/fixture-server.js';
import { makeFixtures } from './support/fixtures.js';
import { makeVideoFixtures } from './support/videos.js';

type Videos = Awaited<ReturnType<typeof makeVideoFixtures>>;
let v: Videos;
let jpeg: Buffer;
let app: FastifyInstance;

const BODIES: Record<string, () => Buffer> = {
  'red-blue.mp4': () => v.redThenBlue,
  'green.webm': () => v.webm,
  'yellow.mov': () => v.mov,
  'corrupt.mp4': () => v.corrupt,
  'playlist.m3u8': () => v.hlsPlaylist,
  'photo.jpg': () => jpeg,
};

const upstream = vi.fn<(url: string, opts?: FetchCallOptions) => Promise<FetchedSource>>();

beforeAll(async () => {
  [v, { jpeg }] = await Promise.all([makeVideoFixtures(), makeFixtures()]);
  app = await buildTestApp({}, { fetchSource: upstream });
});
afterAll(() => app.close());

beforeEach(() => {
  upstream.mockReset();
  upstream.mockImplementation(async (url) => ({
    body: BODIES[url.split('/').pop()!]!(),
    contentType: 'application/octet-stream',
  }));
});

function thumb(
  params: Record<string, string | number>,
  opts: { app?: FastifyInstance; headers?: Record<string, string> } = {},
) {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, val]): [string, string] => [
      k,
      k === 'url' ? `https://videos.test/${val}` : String(val),
    ]),
  );
  return (opts.app ?? app).inject({
    method: 'GET',
    url: `/video/thumbnail?${qs}`,
    headers: opts.headers,
  });
}

/** Colour name of the centre pixel. */
async function centreColour(res: LightMyRequestResponse) {
  const { data, info } = await sharp(res.rawPayload)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  const bits = [data[i]!, data[i + 1]!, data[i + 2]!].map((c) => (c > 127 ? 1 : 0)).join('');
  return { '100': 'red', '001': 'blue', '010': 'green', '110': 'yellow' }[bits] ?? bits;
}

describe('GET /video/thumbnail', () => {
  it('returns the first frame as JPEG by default, with source details', async () => {
    const res = await thumb({ url: 'red-blue.mp4' });
    const meta = await sharp(res.rawPayload).metadata();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect([meta.width, meta.height]).toEqual([160, 120]);
    expect(await centreColour(res)).toBe('red');
    expect(res.headers).toMatchObject({
      'x-original-format': 'mp4',
      'x-original-width': '160',
      'x-original-height': '120',
      'x-original-size': String(v.redThenBlue.length),
      'x-original-duration': '2.000',
    });
  });

  it.each([
    ['0.5', 'red'],
    ['1', 'blue'],
    ['1.5', 'blue'],
  ])('time=%s picks the frame at that position (%s)', async (time, colour) => {
    expect(await centreColour(await thumb({ url: 'red-blue.mp4', time }))).toBe(colour);
  });

  it('applies image transformations to the frame', async () => {
    const res = await thumb({
      url: 'red-blue.mp4',
      time: 1.5,
      width: 80,
      format: 'png',
      rotate: 90,
    });
    const meta = await sharp(res.rawPayload).metadata();

    expect(res.headers['content-type']).toBe('image/png');
    // Rotated first (160x120 -> 120x160), then resized to width 80.
    expect([meta.width, meta.height]).toEqual([80, 107]);
  });

  it('supports format=auto', async () => {
    const res = await thumb(
      { url: 'red-blue.mp4', format: 'auto' },
      { headers: { accept: 'image/webp' } },
    );

    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers.vary).toBe('Accept');
  });

  it.each([
    ['green.webm', 'webm', 'green'],
    ['yellow.mov', 'mov', 'yellow'],
  ])('supports %s', async (url, container, colour) => {
    const res = await thumb({ url });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-original-format']).toBe(container);
    expect(await centreColour(res)).toBe(colour);
  });

  it('fetches with the larger video size limit', async () => {
    await thumb({ url: 'red-blue.mp4', time: 0.2 });

    expect(upstream).toHaveBeenCalledWith('https://videos.test/red-blue.mp4', {
      maxBytes: 100 * 1024 * 1024,
    });
  });
});

describe('GET /video/thumbnail — caching', () => {
  it('caches results per URL and time', async () => {
    const first = await thumb({ url: 'red-blue.mp4', time: 0.3 });
    const second = await thumb({ url: 'red-blue.mp4', time: '0.30' });
    const other = await thumb({ url: 'red-blue.mp4', time: 0.4 });

    expect([first, second, other].map((r) => r.headers['x-cache'])).toEqual([
      'MISS',
      'HIT',
      'MISS',
    ]);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('does not share cache entries with /process', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/process?url=${encodeURIComponent('https://videos.test/red-blue.mp4')}&time=0.3`,
    });

    expect(res.statusCode).toBe(400); // time is not a /process parameter
  });
});

describe('GET /video/thumbnail — errors', () => {
  it('422 with the video length when time is past the end', async () => {
    const res = await thumb({ url: 'red-blue.mp4', time: 5 });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: 'UNPROCESSABLE_VIDEO',
      param: 'time',
      message: 'time=5 is past the end of the video, which is 2.00s long',
    });
  });

  it.each([
    ['photo.jpg', 'an image'],
    ['playlist.m3u8', 'an HLS playlist pointing at the metadata IP'],
  ])('415 for %s (%s)', async (url) => {
    const res = await thumb({ url });

    expect(res.statusCode).toBe(415);
    expect(res.json().error.message).toBe(
      'The source URL did not return a supported video. Supported: MP4, MOV, WebM',
    );
  });

  it('422 for a corrupt video', async () => {
    const res = await thumb({ url: 'corrupt.mp4' });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('UNPROCESSABLE_VIDEO');
  });

  it('422 when the video resolution exceeds the pixel limit', async () => {
    const tight = await buildTestApp({ MAX_INPUT_PIXELS: '10000' }, { fetchSource: upstream });
    const res = await thumb({ url: 'red-blue.mp4' }, { app: tight }); // 160x120 = 19,200 px
    await tight.close();

    expect(res.statusCode).toBe(422);
  });

  it.each(['-1', 'abc', '1e3', '86401', ''])('400 for time=%s', async (time) => {
    const res = await thumb({ url: 'red-blue.mp4', time });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      param: 'time',
      message: 'time must be a number of seconds from 0 to 86400',
    });
  });

  it('lists time among the supported parameters', async () => {
    const res = await thumb({ url: 'red-blue.mp4', tme: 3 });

    expect(res.json().error.message).toMatch(/Supported parameters: url, .*grayscale, time$/);
  });

  it('500 without leaking details when ffmpeg is missing', async () => {
    const broken = await buildTestApp(
      { FFMPEG_PATH: '/nonexistent/ffmpeg' },
      { fetchSource: upstream },
    );
    const res = await thumb({ url: 'red-blue.mp4' }, { app: broken });
    await broken.close();

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/nonexistent/);
  });

  it('413 when the video exceeds VIDEO_MAX_SOURCE_BYTES', async () => {
    const server = await startFixtureServer({
      '/big.mp4': { contentType: 'video/mp4', body: v.redThenBlue },
    });
    const small = await buildTestApp({ VIDEO_MAX_SOURCE_BYTES: '1000' });
    const res = await small.inject({
      method: 'GET',
      url: `/video/thumbnail?url=${encodeURIComponent(server.url('/big.mp4'))}`,
    });
    await Promise.all([small.close(), server.close()]);

    expect(res.statusCode).toBe(413);
  });

  it('runs through the SSRF protection like /process', async () => {
    const strict = await buildTestApp({ ALLOW_PRIVATE_ADDRESSES: '' });
    const res = await strict.inject({
      method: 'GET',
      url: `/video/thumbnail?url=${encodeURIComponent('http://169.254.169.254/latest/video.mp4')}`,
    });
    await strict.close();

    expect(res.statusCode).toBe(403);
  });

  it('cleans up its temporary files, including after failures', async () => {
    const count = async () =>
      (await readdir(tmpdir())).filter((name) => name.startsWith('ips-video-')).length;
    const before = await count();

    await Promise.all([
      thumb({ url: 'red-blue.mp4', time: 0.7 }),
      thumb({ url: 'red-blue.mp4', time: 9 }),
      thumb({ url: 'corrupt.mp4', time: 0.1 }),
    ]);

    expect(await count()).toBe(before);
  });
});

describe('GET /video/thumbnail — rate limit', () => {
  it('has a stricter budget than /process', async () => {
    const limited = await buildTestApp(
      { RATE_LIMIT_MAX: '100', VIDEO_RATE_LIMIT_MAX: '2' },
      { fetchSource: upstream },
    );
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await thumb({ url: 'red-blue.mp4' }, { app: limited })).statusCode);
    }
    const image = await limited.inject({
      method: 'GET',
      url: `/process?url=${encodeURIComponent('https://videos.test/photo.jpg')}`,
    });
    await limited.close();

    expect(statuses).toEqual([200, 200, 429]);
    expect(image.statusCode).toBe(200);
  });
});
