import { describe, expect, it } from 'vitest';
import { ImageClient } from '../src/index.js';

const SRC = 'https://cdn.example.com/photos/cat.jpg?sig=a&b=1';

describe('buildUrl', () => {
  const client = new ImageClient({ baseUrl: 'https://images.example.com' });

  it('builds a /process URL with an encoded source URL', () => {
    expect(client.buildUrl({ url: SRC, width: 400 })).toBe(
      'https://images.example.com/process?url=https%3A%2F%2Fcdn.example.com%2Fphotos%2Fcat.jpg%3Fsig%3Da%26b%3D1&width=400',
    );
  });

  it('writes parameters in a fixed order, whatever order they were given in', () => {
    const a = client.buildUrl({ grayscale: true, format: 'webp', url: SRC, height: 2, width: 1 });
    const b = client.buildUrl({ url: SRC, width: 1, height: 2, format: 'webp', grayscale: true });

    expect(a).toBe(b);
    expect(new URL(a).searchParams.toString()).toMatch(
      /^url=.*&width=1&height=2&format=webp&grayscale=true$/,
    );
  });

  it('serialises every option', () => {
    const url = new URL(
      client.buildUrl({
        url: SRC,
        width: 800,
        height: 600,
        format: 'auto',
        quality: 70,
        crop: 'pad',
        rotate: -90,
        flip: 'both',
        blur: 2.5,
        grayscale: false,
      }),
    );

    expect(Object.fromEntries(url.searchParams)).toEqual({
      url: SRC,
      width: '800',
      height: '600',
      format: 'auto',
      quality: '70',
      crop: 'pad',
      rotate: '-90',
      flip: 'both',
      blur: '2.5',
      grayscale: 'false',
    });
  });

  it('omits undefined options', () => {
    expect(client.buildUrl({ url: SRC, width: undefined, format: undefined })).toBe(
      client.buildUrl({ url: SRC }),
    );
  });

  it.each([
    ['https://images.example.com/', 'https://images.example.com/process?'],
    ['https://example.com/images/api', 'https://example.com/images/api/process?'],
    ['https://example.com/images/api//', 'https://example.com/images/api/process?'],
    ['', '/process?'],
  ])('joins baseUrl %j cleanly', (baseUrl, prefix) => {
    expect(new ImageClient({ baseUrl }).buildUrl({ url: SRC })).toMatch(
      new RegExp(`^${prefix.replace(/[?/.]/g, '\\$&')}`),
    );
  });

  it('requires url', () => {
    expect(() => client.buildUrl({ url: '' })).toThrow(TypeError);
    expect(() => client.buildUrl({} as never)).toThrow('`url` is required');
  });
});

describe('videoThumbnailUrl', () => {
  it('builds a /video/thumbnail URL with time last', () => {
    const client = new ImageClient({ baseUrl: 'https://images.example.com' });

    expect(
      client.videoThumbnailUrl({ url: 'https://v.example.com/a.mp4', time: 2.5, width: 320 }),
    ).toBe(
      'https://images.example.com/video/thumbnail?url=https%3A%2F%2Fv.example.com%2Fa.mp4&width=320&time=2.5',
    );
  });
});

describe('ImageClient', () => {
  it('requires baseUrl', () => {
    expect(() => new ImageClient({} as never)).toThrow('`baseUrl` is required');
  });
});
