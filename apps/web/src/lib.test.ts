import { describe, expect, it } from 'vitest';
import {
  curlCommand,
  DEFAULT_FORM,
  describeError,
  formatBytes,
  prepareRequest,
  sizeChange,
} from './lib.js';
import { ImageApiError } from '@ips/sdk';

const SRC = 'https://cdn.example.com/a.jpg';

describe('prepareRequest', () => {
  it('returns nothing without a URL', () => {
    expect(prepareRequest(DEFAULT_FORM)).toBeUndefined();
    expect(prepareRequest({ ...DEFAULT_FORM, url: '   ' })).toBeUndefined();
  });

  it('leaves defaults out of the URL', () => {
    const req = prepareRequest({ ...DEFAULT_FORM, url: SRC })!;

    expect(req.original.key).toBe('/process?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg');
    expect(req.processed.key).toBe(req.original.key);
  });

  it('adds only the transformations that were set', () => {
    const req = prepareRequest({
      ...DEFAULT_FORM,
      url: SRC,
      width: '400',
      format: 'webp',
      quality: 60,
      crop: 'pad',
      grayscale: true,
    })!;

    expect(req.processed.key).toBe(
      '/process?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg&width=400&format=webp&quality=60&crop=pad&grayscale=true',
    );
    expect(req.original.key).toBe('/process?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg');
  });

  it('passes invalid numbers through so the API can explain them', () => {
    const req = prepareRequest({ ...DEFAULT_FORM, url: SRC, width: '-5' })!;

    expect(req.processed.key).toMatch(/width=-5$/);
  });

  it('builds video thumbnail requests, with the frame time in both panels', () => {
    const req = prepareRequest({
      ...DEFAULT_FORM,
      mode: 'video',
      url: 'https://v.example.com/a.mp4',
      time: '2.5',
      width: '320',
    })!;

    expect(req.original.key).toBe(
      '/video/thumbnail?url=https%3A%2F%2Fv.example.com%2Fa.mp4&time=2.5',
    );
    expect(req.processed.key).toBe(
      '/video/thumbnail?url=https%3A%2F%2Fv.example.com%2Fa.mp4&width=320&time=2.5',
    );
  });

  it('flags format=auto as negotiated', () => {
    expect(prepareRequest({ ...DEFAULT_FORM, url: SRC, format: 'auto' })!.negotiated).toBe(true);
    expect(prepareRequest({ ...DEFAULT_FORM, url: SRC, format: 'png' })!.negotiated).toBe(false);
  });
});

describe('curlCommand', () => {
  it('quotes the URL for the shell', () => {
    expect(curlCommand("https://x.test/process?url=a'b&width=1", false)).toBe(
      `curl -sS -D - -o output 'https://x.test/process?url=a'\\''b&width=1'`,
    );
  });

  it('adds an Accept header for format=auto', () => {
    expect(curlCommand('https://x.test/p', true)).toBe(
      `curl -sS -D - -H 'Accept: image/avif,image/webp,*/*' -o output 'https://x.test/p'`,
    );
  });
});

describe('formatting', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [3 * 1024 * 1024, '3.00 MB'],
  ])('formatBytes(%i) = %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it.each([
    [50, 100, '50% smaller'],
    [150, 100, '50% larger'],
    [100, 100, 'same size'],
    [10, 0, undefined],
  ])('sizeChange(%i, %i) = %s', (output, original, text) => {
    expect(sizeChange(output, original)).toBe(text);
  });
});

describe('describeError', () => {
  it('describes API errors with a friendly title', () => {
    const err = new ImageApiError({
      code: 'FORBIDDEN_HOST',
      message: 'The url points to a private or reserved IP address',
      status: 403,
      requestId: 'r1',
    });

    expect(describeError(err)).toEqual({
      title: 'Source not allowed',
      message: 'The url points to a private or reserved IP address',
      code: 'FORBIDDEN_HOST',
      param: undefined,
      requestId: 'r1',
    });
  });

  it('handles anything else', () => {
    expect(describeError(new Error('boom'))).toMatchObject({ code: 'UNKNOWN', message: 'boom' });
  });
});
