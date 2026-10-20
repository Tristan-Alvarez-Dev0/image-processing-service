# @ips/sdk

Typed client for the Image Processing Service. No runtime dependencies; works in
browsers and Node 20+ (anything with `fetch`). Ships ESM, CJS and type declarations.

```ts
import { ImageClient, isImageApiError } from '@ips/sdk';

const images = new ImageClient({ baseUrl: 'https://images.example.com' });
```

## Build URLs (no network)

Use these for `<img src>`: the browser fetches, caches and negotiates formats itself.

```ts
img.src = images.buildUrl({
  url: 'https://cdn.example.com/cat.jpg',
  width: 800,
  height: 600,
  crop: 'fill',
  format: 'auto', // AVIF/WebP when the browser supports them
});

poster.src = images.videoThumbnailUrl({
  url: 'https://cdn.example.com/clip.mp4',
  time: 3,
  width: 640,
});
```

Parameters are always written in the same order, so equal options give equal URLs
and CDN caches stay effective.

## Fetch images with metadata

```ts
const result = await images.process({ url, width: 400, format: 'webp' });

result.blob; // Blob: URL.createObjectURL(result.blob) to display it
result.contentType; // 'image/webp'
result.width; // 400
result.height; // 300
result.size; // bytes
result.original; // { width, height, format, size, duration? }
result.cache; // 'HIT' | 'MISS'
result.requestId; // quote this when reporting problems
```

`videoThumbnail({ url, time, ...transforms })` works the same way and adds
`original.duration`.

## Options

| Option      | Type                                                              | Notes                                |
| ----------- | ----------------------------------------------------------------- | ------------------------------------ |
| `url`       | `string`                                                          | Required. Absolute http(s) URL.      |
| `width`     | `number`                                                          | Pixels; keeps aspect ratio if alone. |
| `height`    | `number`                                                          |                                      |
| `format`    | `'jpeg' \| 'jpg' \| 'png' \| 'webp' \| 'avif' \| 'gif' \| 'auto'` |                                      |
| `quality`   | `number`                                                          | 1-100, default 80.                   |
| `crop`      | `'fill' \| 'fit' \| 'limit' \| 'pad' \| 'scale'`                  | Default `fill`.                      |
| `rotate`    | `number`                                                          | Degrees clockwise, -360 to 360.      |
| `flip`      | `'horizontal' \| 'vertical' \| 'both'`                            |                                      |
| `blur`      | `number`                                                          | Sigma, 0.3-100.                      |
| `grayscale` | `boolean`                                                         |                                      |
| `time`      | `number`                                                          | Video thumbnails only; seconds.      |

## Errors

Every failure is an `ImageApiError` with a typed `code`:

```ts
try {
  await images.process({ url, width: 99999 });
} catch (err) {
  if (isImageApiError(err)) {
    err.code; // 'INVALID_PARAMETER' (a closed union of all codes)
    err.status; // 400
    err.param; // 'width'
    err.message; // 'width must be a whole number from 1 to 4000'
    err.requestId;
    err.retryable; // false
  }
}
```

Besides the API's codes, the SDK adds `NETWORK_ERROR`, `TIMEOUT` and
`INVALID_RESPONSE` (an error that isn't the API's JSON format, e.g. from a proxy).

## Retries, timeouts and cancellation

```ts
const images = new ImageClient({
  baseUrl: 'https://images.example.com',
  timeoutMs: 30_000, // per attempt (default)
  retry: { retries: 2, baseDelayMs: 300, maxDelayMs: 10_000 }, // defaults; or `false`
});

const controller = new AbortController();
await images.process({ url }, { signal: controller.signal });
```

- Retries `429`, `502`, `503`, `504`, timeouts and network errors, with exponential
  backoff and jitter. `4xx` errors are never retried.
- `Retry-After` is honoured. If it asks for longer than `maxDelayMs`, the call fails
  right away with `err.retryAfter` set, instead of blocking.
- Aborting rejects with your abort reason and stops any pending retry.
