/**
 * Runs the SDK against the real API server, so URL building, headers and
 * error parsing are checked end to end, not against assumptions.
 */
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app.js';
import { loadConfig } from '../../../apps/api/src/config.js';
import { ERROR_CODES } from '../../../apps/api/src/errors/app-error.js';
import {
  CROP_MODES as API_CROP_MODES,
  FLIP_MODES as API_FLIP_MODES,
  OUTPUT_FORMATS as API_OUTPUT_FORMATS,
} from '../../../apps/api/src/schemas/process.js';
import { makeFixtures } from '../../../apps/api/test/support/fixtures.js';
import { makeVideoFixtures } from '../../../apps/api/test/support/videos.js';
import {
  API_ERROR_CODES,
  CROP_MODES,
  FLIP_MODES,
  ImageClient,
  isImageApiError,
  OUTPUT_FORMATS,
  type ProcessOptions,
} from '../src/index.js';

let server: FastifyInstance;
let client: ImageClient;

beforeAll(async () => {
  const [images, videos] = await Promise.all([makeFixtures(), makeVideoFixtures()]);
  const sources: Record<string, Buffer> = {
    'photo.jpg': images.jpeg,
    'alpha.png': images.png,
    'clip.mp4': videos.redThenBlue,
  };
  server = await buildApp(loadConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX: '0' }), {
    fetchSource: async (url) => {
      const body = sources[url.split('/').pop()!];
      if (!body) throw Object.assign(new Error('missing fixture'), { code: 'TEST' });
      return { body, contentType: 'application/octet-stream' };
    },
  });
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  client = new ImageClient({ baseUrl: address, retry: false });
});

afterAll(() => server.close());

const src = (name: string) => `https://fixtures.test/${name}`;

describe('SDK against the real API', () => {
  it('process() returns the image and accurate metadata', async () => {
    const result = await client.process({ url: src('photo.jpg'), width: 200, format: 'webp' });
    const meta = await sharp(Buffer.from(await result.blob.arrayBuffer())).metadata();

    expect(result).toMatchObject({
      contentType: 'image/webp',
      width: 200,
      height: 150,
      original: { width: 800, height: 600, format: 'jpeg' },
      cache: 'MISS',
    });
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 200, 150]);
    expect(result.size).toBe(result.blob.size);
    expect(result.etag).toMatch(/^"/);
    expect(result.requestId).toBeTruthy();
  });

  it('sees cache hits', async () => {
    await client.process({ url: src('photo.jpg'), width: 99 });
    const again = await client.process({ url: src('photo.jpg'), width: 99 });

    expect(again.cache).toBe('HIT');
  });

  it('negotiates format=auto', async () => {
    const result = await client.process({ url: src('photo.jpg'), width: 50, format: 'auto' });

    expect(result.contentType).toBe('image/avif');
  });

  // Every option combination the SDK can express must be accepted by the server.
  const everyOption: ProcessOptions[] = [
    ...OUTPUT_FORMATS.map((format) => ({ url: src('photo.jpg'), width: 40, format })),
    { url: src('photo.jpg'), width: 40, format: 'jpg' },
    ...CROP_MODES.map((crop) => ({ url: src('photo.jpg'), width: 40, height: 40, crop })),
    ...FLIP_MODES.map((flip) => ({ url: src('photo.jpg'), width: 40, flip })),
    {
      url: src('alpha.png'),
      width: 64,
      height: 64,
      format: 'png',
      quality: 55,
      crop: 'pad',
      rotate: -45,
      flip: 'both',
      blur: 1.5,
      grayscale: true,
    },
    { url: src('photo.jpg'), grayscale: false, rotate: 0 },
  ];
  it.each(everyOption.map((o) => [JSON.stringify(o), o] as const))(
    'the server accepts %s',
    async (_name, options) => {
      await expect(client.process(options)).resolves.toMatchObject({ width: expect.any(Number) });
    },
  );

  it('videoThumbnail() returns a frame with the duration', async () => {
    const result = await client.videoThumbnail({ url: src('clip.mp4'), time: 1.5, width: 80 });

    expect(result).toMatchObject({
      contentType: 'image/jpeg',
      width: 80,
      height: 60,
      original: { format: 'mp4', width: 160, height: 120, duration: 2 },
    });
  });

  it('surfaces validation errors as typed errors', async () => {
    try {
      await client.process({ url: src('photo.jpg'), width: 99999 });
      expect.unreachable();
    } catch (err) {
      expect(isImageApiError(err)).toBe(true);
      expect(err).toMatchObject({
        code: 'INVALID_PARAMETER',
        status: 400,
        param: 'width',
        message: 'width must be a whole number from 1 to 4000',
      });
    }
  });

  it('surfaces source errors as typed errors', async () => {
    await expect(client.videoThumbnail({ url: src('clip.mp4'), time: 30 })).rejects.toMatchObject({
      code: 'UNPROCESSABLE_VIDEO',
      status: 422,
      param: 'time',
    });
  });

  it('health() works', async () => {
    await expect(client.health()).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('SDK constants match the API (drift checks)', () => {
  it('formats, crop modes and flip modes', () => {
    expect([...OUTPUT_FORMATS]).toEqual([...API_OUTPUT_FORMATS]);
    expect([...CROP_MODES]).toEqual([...API_CROP_MODES]);
    expect([...FLIP_MODES]).toEqual([...API_FLIP_MODES]);
  });

  it('error codes', () => {
    expect([...API_ERROR_CODES].sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });
});
