import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FetchedSource } from '../src/services/fetcher.js';
import { buildTestApp } from './support/app.js';
import { makeFixtures } from './support/fixtures.js';

type Fixtures = Awaited<ReturnType<typeof makeFixtures>>;
let f: Fixtures;
let app: FastifyInstance;

const SOURCES: Record<string, keyof Fixtures> = {
  'https://img.test/quadrants.png': 'quadrants',
  'https://img.test/photo.jpg': 'jpeg',
  'https://img.test/alpha.png': 'png',
  'https://img.test/animated.gif': 'animatedGif',
};

beforeAll(async () => {
  f = await makeFixtures();
  const fetchSource = async (url: string): Promise<FetchedSource> => ({
    body: f[SOURCES[url]!],
    contentType: 'image/*',
  });
  app = await buildTestApp({}, { fetchSource });
});
afterAll(() => app.close());

function get(params: Record<string, string | number>, headers: Record<string, string> = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]): [string, string] => [
      k,
      k === 'url' ? `https://img.test/${v}` : String(v),
    ]),
  );
  return app.inject({ method: 'GET', url: `/process?${qs}`, headers });
}

const meta = (res: LightMyRequestResponse) => sharp(res.rawPayload).metadata();

const COLOUR_NAMES: Record<string, string> = {
  '100': 'red',
  '001': 'blue',
  '010': 'green',
  '110': 'yellow',
  '000': 'black',
  '111': 'white',
};

/** Colour name of the pixel at a relative position (0-1) in the output. */
async function colourAt(res: LightMyRequestResponse, fx: number, fy: number) {
  const { data, info } = await sharp(res.rawPayload)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const x = Math.min(info.width - 1, Math.floor(info.width * fx));
  const y = Math.min(info.height - 1, Math.floor(info.height * fy));
  const i = (y * info.width + x) * info.channels;
  const bits = [data[i]!, data[i + 1]!, data[i + 2]!].map((v) => (v > 127 ? 1 : 0)).join('');
  return COLOUR_NAMES[bits] ?? `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
}

/** Colours at the four corners: [top-left, top-right, bottom-left, bottom-right]. */
const corners = (res: LightMyRequestResponse) =>
  Promise.all([
    colourAt(res, 0.1, 0.1),
    colourAt(res, 0.9, 0.1),
    colourAt(res, 0.1, 0.9),
    colourAt(res, 0.9, 0.9),
  ]);

describe('rotate', () => {
  it('rotate=90 turns the image clockwise and swaps width and height', async () => {
    const res = await get({ url: 'quadrants.png', rotate: 90 });
    const m = await meta(res);

    expect([m.width, m.height]).toEqual([100, 200]);
    // Clockwise: the top-left (red) moves to the top-right.
    expect(await corners(res)).toEqual(['green', 'red', 'yellow', 'blue']);
  });

  it('negative angles rotate counter-clockwise (-90 = 270)', async () => {
    expect(await corners(await get({ url: 'quadrants.png', rotate: -90 }))).toEqual(
      await corners(await get({ url: 'quadrants.png', rotate: 270 })),
    );
  });

  it('normalises angles so equivalent requests share a cache entry', async () => {
    await get({ url: 'quadrants.png', rotate: 180 });
    const res = await get({ url: 'quadrants.png', rotate: -180 });

    expect(res.headers['x-cache']).toBe('HIT');
  });

  it('rotate=360 is a no-op', async () => {
    const m = await meta(await get({ url: 'quadrants.png', rotate: 360 }));

    expect([m.width, m.height]).toEqual([200, 100]);
  });

  it('rotates before resizing, so width/height describe the final image', async () => {
    const m = await meta(await get({ url: 'photo.jpg', rotate: 90, width: 500, height: 300 }));

    expect([m.width, m.height]).toEqual([500, 300]);
  });

  it('expands the canvas for arbitrary angles, transparent for PNG', async () => {
    const res = await get({ url: 'photo.jpg', rotate: 45, format: 'png' });
    const m = await meta(res);
    const { data } = await sharp(res.rawPayload).raw().toBuffer({ resolveWithObject: true });

    expect([m.width, m.height]).toEqual([990, 990]);
    expect(m.hasAlpha).toBe(true);
    expect(data[3]).toBe(0); // top-left corner is fully transparent
  });

  it('fills the expanded canvas with white for JPEG', async () => {
    expect(await colourAt(await get({ url: 'photo.jpg', rotate: 45 }), 0, 0)).toBe('white');
  });

  it('rejects rotating an animation, and explains how to rotate a still frame', async () => {
    const animated = await get({ url: 'animated.gif', rotate: 90 });
    const still = await get({ url: 'animated.gif', rotate: 90, format: 'png' });

    expect(animated.statusCode).toBe(400);
    expect(animated.json().error).toMatchObject({ code: 'INVALID_PARAMETER', param: 'rotate' });
    expect(animated.json().error.message).toMatch(/format=jpeg or format=png/);
    expect(still.statusCode).toBe(200);
  });

  it.each(['361', '-361', '45.5', 'ninety', ''])('rejects rotate=%s', async (rotate) => {
    const res = await get({ url: 'photo.jpg', rotate });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe(
      'rotate must be a whole number of degrees from -360 to 360',
    );
  });
});

describe('flip', () => {
  it.each([
    ['horizontal', ['blue', 'red', 'yellow', 'green']],
    ['vertical', ['green', 'yellow', 'red', 'blue']],
    ['both', ['yellow', 'green', 'blue', 'red']],
  ])('flip=%s mirrors correctly', async (flip, expected) => {
    expect(await corners(await get({ url: 'quadrants.png', flip }))).toEqual(expected);
  });

  it('flips before rotating', async () => {
    // Mirror left/right, then turn clockwise.
    const res = await get({ url: 'quadrants.png', flip: 'horizontal', rotate: 90 });

    expect(await corners(res)).toEqual(['yellow', 'blue', 'green', 'red']);
  });

  it('flip=horizontal keeps animations animated, frames in order', async () => {
    const res = await get({ url: 'animated.gif', flip: 'horizontal' });
    const frames = await Promise.all(
      [0, 1].map(async (page) =>
        colourAt(
          {
            rawPayload: await sharp(res.rawPayload, { page }).png().toBuffer(),
          } as LightMyRequestResponse,
          0.5,
          0.5,
        ),
      ),
    );

    expect(frames).toEqual(['red', 'blue']);
  });

  it.each(['vertical', 'both'])(
    'rejects flip=%s for animations (it would reverse the frames)',
    async (flip) => {
      const animated = await get({ url: 'animated.gif', flip });
      const still = await get({ url: 'animated.gif', flip, format: 'png' });

      expect(animated.statusCode).toBe(400);
      expect(animated.json().error).toMatchObject({ code: 'INVALID_PARAMETER', param: 'flip' });
      expect(still.statusCode).toBe(200);
    },
  );

  it('rejects unknown modes', async () => {
    const res = await get({ url: 'photo.jpg', flip: 'diagonal' });

    expect(res.json().error.message).toBe('flip must be one of: horizontal, vertical, both');
  });
});

describe('blur', () => {
  it('softens the image', async () => {
    const sharpness = async (res: LightMyRequestResponse) =>
      (await sharp(res.rawPayload).stats()).sharpness;

    const plain = await sharpness(await get({ url: 'quadrants.png' }));
    const blurred = await sharpness(await get({ url: 'quadrants.png', blur: 5 }));

    expect(blurred).toBeLessThan(plain);
  });

  it('accepts decimals', async () => {
    expect((await get({ url: 'quadrants.png', blur: '2.5' })).statusCode).toBe(200);
  });

  it.each(['0', '0.2', '101', '1e2', '-3', 'max'])('rejects blur=%s', async (blur) => {
    const res = await get({ url: 'photo.jpg', blur });

    expect(res.json().error.message).toBe('blur must be a number from 0.3 to 100');
  });
});

describe('grayscale', () => {
  async function isGray(res: LightMyRequestResponse) {
    const { data } = await sharp(res.rawPayload)
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 3) {
      if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false;
    }
    return true;
  }

  it.each(['true', '1'])('grayscale=%s removes colour', async (grayscale) => {
    expect(await isGray(await get({ url: 'quadrants.png', grayscale }))).toBe(true);
  });

  it.each(['false', '0'])('grayscale=%s keeps colour', async (grayscale) => {
    expect(await isGray(await get({ url: 'quadrants.png', grayscale }))).toBe(false);
  });

  it.each(['jpeg', 'png', 'webp', 'avif', 'gif'])('works with %s output', async (format) => {
    const res = await get({ url: 'photo.jpg', grayscale: 'true', format, width: 100 });

    expect(res.statusCode).toBe(200);
    // AVIF and WebP are lossy in chroma, so R = G = B is only exact for the others.
    if (format === 'png' || format === 'jpeg' || format === 'gif') {
      expect(await isGray(res)).toBe(true);
    }
  });

  it('stores PNG and JPEG as a single channel (smaller files)', async () => {
    const png = await get({ url: 'photo.jpg', grayscale: 'true', format: 'png' });
    const colourPng = await get({ url: 'photo.jpg', format: 'png' });

    expect((await meta(png)).channels).toBe(1);
    expect((await meta(await get({ url: 'photo.jpg', grayscale: 'true' }))).channels).toBe(1);
    expect(png.rawPayload.length).toBeLessThan(colourPng.rawPayload.length);
  });

  it('keeps transparency', async () => {
    expect((await meta(await get({ url: 'alpha.png', grayscale: 'true' }))).hasAlpha).toBe(true);
  });

  it('rejects other values', async () => {
    const res = await get({ url: 'photo.jpg', grayscale: 'yes' });

    expect(res.json().error.message).toBe('grayscale must be true or false');
  });
});

describe('format=auto', () => {
  const auto = (url: string, accept?: string) =>
    get({ url, format: 'auto' }, accept === undefined ? {} : { accept });

  it.each([
    ['image/avif,image/webp,*/*', 'photo.jpg', 'image/avif'],
    ['image/webp,*/*', 'photo.jpg', 'image/webp'],
    ['image/avif;q=0,image/webp', 'photo.jpg', 'image/webp'],
    ['image/*', 'photo.jpg', 'image/jpeg'],
    ['*/*', 'photo.jpg', 'image/jpeg'],
    [undefined, 'photo.jpg', 'image/jpeg'],
    ['*/*', 'alpha.png', 'image/png'],
    ['IMAGE/WEBP', 'photo.jpg', 'image/webp'],
  ])('Accept %s with %s -> %s', async (accept, url, expected) => {
    const res = await auto(url, accept);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(expected);
  });

  it('keeps animations animated: WebP when accepted', async () => {
    const res = await auto('animated.gif', 'image/avif,image/webp');
    const m = await sharp(res.rawPayload, { animated: true }).metadata();

    expect(res.headers['content-type']).toBe('image/webp');
    expect(m.pages).toBe(2);
  });

  it('keeps animations animated: GIF otherwise', async () => {
    const res = await auto('animated.gif', 'image/avif');

    expect(res.headers['content-type']).toBe('image/gif');
  });

  it('sends Vary: Accept, and only for format=auto', async () => {
    expect((await auto('photo.jpg', 'image/webp')).headers.vary).toBe('Accept');
    expect((await get({ url: 'photo.jpg', format: 'webp' })).headers.vary).toBeUndefined();
  });

  it('caches each negotiated format separately', async () => {
    const avif = await get(
      { url: 'photo.jpg', format: 'auto', width: 77 },
      { accept: 'image/avif' },
    );
    const webp = await get(
      { url: 'photo.jpg', format: 'auto', width: 77 },
      { accept: 'image/webp' },
    );
    const avifAgain = await get(
      { url: 'photo.jpg', format: 'auto', width: 77 },
      { accept: 'image/avif' },
    );

    expect([
      avif.headers['x-cache'],
      webp.headers['x-cache'],
      avifAgain.headers['x-cache'],
    ]).toEqual(['MISS', 'MISS', 'HIT']);
    expect(avifAgain.headers['content-type']).toBe('image/avif');
  });

  it('ignores Accept for explicit formats (shares one cache entry)', async () => {
    await get({ url: 'photo.jpg', format: 'png', width: 66 }, { accept: 'image/avif' });
    const res = await get({ url: 'photo.jpg', format: 'png', width: 66 }, { accept: 'image/webp' });

    expect(res.headers['x-cache']).toBe('HIT');
  });
});

describe('combined', () => {
  it('applies every transformation in one request', async () => {
    const res = await get({
      url: 'quadrants.png',
      width: 300,
      height: 300,
      crop: 'pad',
      format: 'webp',
      quality: 90,
      rotate: 90,
      flip: 'both',
      blur: 0.5,
      grayscale: 'true',
    });
    const m = await meta(res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect([m.width, m.height]).toEqual([300, 300]);
  });
});
