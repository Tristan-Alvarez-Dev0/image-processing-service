import { describe, expect, it, vi } from 'vitest';
import { ImageApiError, ImageClient, isImageApiError } from '../src/index.js';

const SRC = 'https://cdn.example.com/a.jpg';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const imageResponse = (headers: Record<string, string> = {}) =>
  new Response(PNG, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'x-output-width': '40',
      'x-output-height': '30',
      'x-original-width': '800',
      'x-original-height': '600',
      'x-original-format': 'jpeg',
      'x-original-size': '12345',
      'x-cache': 'MISS',
      etag: '"abc"',
      'x-request-id': 'req-1',
      ...headers,
    },
  });

const errorResponse = (
  status: number,
  error: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ error: { requestId: 'req-err', ...error } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A client whose fetch answers with the given responses in turn. */
function clientWith(responses: Array<Response | Error>, options: Record<string, unknown> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const r of responses) {
    if (r instanceof Error) fetch.mockRejectedValueOnce(r);
    else fetch.mockResolvedValueOnce(r);
  }
  const client = new ImageClient({
    baseUrl: 'https://images.test',
    fetch,
    retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 1000 },
    ...options,
  });
  return { client, fetch };
}

async function caught(promise: Promise<unknown>): Promise<ImageApiError> {
  try {
    await promise;
  } catch (err) {
    if (isImageApiError(err)) return err;
    throw err;
  }
  throw new Error('expected an ImageApiError');
}

describe('process()', () => {
  it('returns the image with its metadata', async () => {
    const { client, fetch } = clientWith([imageResponse()]);

    const result = await client.process({ url: SRC, width: 40 });

    expect(fetch).toHaveBeenCalledWith(client.buildUrl({ url: SRC, width: 40 }), expect.anything());
    expect(result).toMatchObject({
      contentType: 'image/png',
      width: 40,
      height: 30,
      size: 4,
      original: { width: 800, height: 600, format: 'jpeg', size: 12345 },
      cache: 'MISS',
      etag: '"abc"',
      requestId: 'req-1',
      url: client.buildUrl({ url: SRC, width: 40 }),
    });
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(PNG);
    expect(result.original.duration).toBeUndefined();
  });

  it('reports the duration for video thumbnails', async () => {
    const { client } = clientWith([imageResponse({ 'x-original-duration': '5.060' })]);

    const result = await client.videoThumbnail({ url: 'https://v.test/a.mp4', time: 1 });

    expect(result.original.duration).toBe(5.06);
  });

  it('advertises AVIF/WebP for format=auto, and lets callers override it', async () => {
    const { client, fetch } = clientWith([imageResponse(), imageResponse(), imageResponse()]);

    await client.process({ url: SRC, format: 'auto' });
    await client.process({ url: SRC, format: 'auto' }, { accept: 'image/webp' });
    await client.process({ url: SRC, format: 'png' });

    const accept = (i: number) =>
      (fetch.mock.calls[i]![1]!.headers as Record<string, string>).accept;
    expect(accept(0)).toMatch(/^image\/avif,image\/webp/);
    expect(accept(1)).toBe('image/webp');
    expect(accept(2)).toBeUndefined();
  });

  it('sends the configured headers', async () => {
    const { client, fetch } = clientWith([imageResponse()], {
      headers: { 'x-request-id': 'mine' },
    });

    await client.process({ url: SRC });

    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ 'x-request-id': 'mine' });
  });
});

describe('errors', () => {
  it('turns API errors into ImageApiError with every field', async () => {
    const { client, fetch } = clientWith([
      errorResponse(400, {
        code: 'INVALID_PARAMETER',
        message: 'width must be a whole number from 1 to 4000',
        param: 'width',
        details: [{ param: 'width', message: 'x' }],
      }),
    ]);

    const err = await caught(client.process({ url: SRC, width: 99999 }));

    expect(err).toBeInstanceOf(ImageApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      name: 'ImageApiError',
      code: 'INVALID_PARAMETER',
      status: 400,
      param: 'width',
      message: 'width must be a whole number from 1 to 4000',
      details: [{ param: 'width', message: 'x' }],
      requestId: 'req-err',
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1); // 4xx is never retried
  });

  it('reports a non-JSON error (e.g. from a proxy) as INVALID_RESPONSE', async () => {
    const { client } = clientWith([
      new Response('<html>Bad gateway</html>', { status: 400, headers: { 'x-request-id': 'r' } }),
    ]);

    const err = await caught(client.process({ url: SRC }));

    expect(err).toMatchObject({ code: 'INVALID_RESPONSE', status: 400, requestId: 'r' });
  });

  it('isImageApiError recognises errors from another copy of the SDK', () => {
    expect(isImageApiError(Object.assign(new Error('x'), { name: 'ImageApiError' }))).toBe(true);
    expect(isImageApiError(new Error('x'))).toBe(false);
    expect(isImageApiError('nope')).toBe(false);
  });
});

describe('retries', () => {
  it.each([502, 503, 504])('retries HTTP %i and then succeeds', async (status) => {
    const { client, fetch } = clientWith([
      errorResponse(status, { code: 'UPSTREAM_ERROR', message: 'down' }),
      imageResponse(),
    ]);

    await expect(client.process({ url: SRC })).resolves.toMatchObject({ width: 40 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after `retries` extra attempts', async () => {
    const down = () => errorResponse(503, { code: 'UPSTREAM_ERROR', message: 'down' });
    const { client, fetch } = clientWith([down(), down(), down(), imageResponse()]);

    const err = await caught(client.process({ url: SRC }));

    expect(err.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('honours Retry-After on 429', async () => {
    const { client, fetch } = clientWith([
      errorResponse(429, { code: 'RATE_LIMITED', message: 'slow down' }, { 'retry-after': '0' }),
      imageResponse(),
    ]);

    await client.process({ url: SRC });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not wait longer than maxDelayMs; fails fast with retryAfter instead', async () => {
    const { client, fetch } = clientWith([
      errorResponse(429, { code: 'RATE_LIMITED', message: 'slow down' }, { 'retry-after': '57' }),
    ]);

    const err = await caught(client.process({ url: SRC }));

    expect(err).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfter: 57,
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries network failures, then reports NETWORK_ERROR', async () => {
    const { client, fetch } = clientWith([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    ]);

    const err = await caught(client.process({ url: SRC }));

    expect(err).toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect(err.cause).toBeInstanceOf(TypeError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('can be disabled', async () => {
    const { client, fetch } = clientWith(
      [errorResponse(503, { code: 'UPSTREAM_ERROR', message: 'down' }), imageResponse()],
      { retry: false },
    );

    await expect(client.process({ url: SRC })).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('timeouts and cancellation', () => {
  /** A fetch that never answers until aborted. */
  const hangingFetch = vi.fn<typeof globalThis.fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
  );

  it('reports TIMEOUT after timeoutMs', async () => {
    const client = new ImageClient({
      baseUrl: 'https://images.test',
      fetch: hangingFetch,
      timeoutMs: 20,
      retry: false,
    });

    const err = await caught(client.process({ url: SRC }));

    expect(err).toMatchObject({ code: 'TIMEOUT', status: 0, message: 'No response within 20 ms' });
  });

  it("rethrows the caller's own abort untouched and does not retry", async () => {
    hangingFetch.mockClear();
    const client = new ImageClient({ baseUrl: 'https://images.test', fetch: hangingFetch });
    const controller = new AbortController();

    const pending = client.process({ url: SRC }, { signal: controller.signal });
    controller.abort(new DOMException('user navigated away', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(hangingFetch).toHaveBeenCalledTimes(1);
  });

  it('stops waiting between retries when aborted', async () => {
    const controller = new AbortController();
    const { client } = clientWith(
      [errorResponse(503, { code: 'UPSTREAM_ERROR', message: 'down' }), imageResponse()],
      { retry: { retries: 2, baseDelayMs: 5_000, maxDelayMs: 10_000 } },
    );

    const pending = client.process({ url: SRC }, { signal: controller.signal });
    setTimeout(() => controller.abort(new DOMException('stop', 'AbortError')), 10);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
