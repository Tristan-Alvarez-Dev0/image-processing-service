# Image Processing Service

[![CI](https://github.com/Tristan-Alvarez-Dev0/image-processing-service/actions/workflows/ci.yml/badge.svg)](https://github.com/Tristan-Alvarez-Dev0/image-processing-service/actions/workflows/ci.yml)

Resize, crop, convert and transform remote images, and grab thumbnails from videos, with one `GET`
request. Includes a web playground, a typed TypeScript SDK, OpenAPI docs and Prometheus metrics.

|                |                                                     |
| -------------- | --------------------------------------------------- |
| **Playground** | https://courageous-frangollo-22eb6c.netlify.app     |
| **API**        | https://image-processing-api-ut72.onrender.com      |
| **API docs**   | https://image-processing-api-ut72.onrender.com/docs |

> The API is on Render's free plan: after 15 idle minutes it sleeps, and the next request takes about
> a minute.

```bash
API=https://image-processing-api-ut72.onrender.com
IMG=https://picsum.photos/id/237/1200/900.jpg

curl -o a.jpg  "$API/process?url=$IMG&width=500&height=300"
curl -o b.webp "$API/process?url=$IMG&width=800&height=600&format=webp&crop=fill"
curl -o c.jpg  "$API/video/thumbnail?url=https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4&time=2"
```

## What's included

Everything in the brief, plus all the bonus items: video thumbnails, a typed SDK, OpenAPI docs, CI,
observability, and extra transformations. The brief suggested a couple of hours and one or two
bonuses; I chose to build them all, and the trade-offs below say where I kept things simple.

The **playground** shows the original and processed image side by side with their dimensions, format
and size, the exact API request with copy and curl buttons, and clear error messages.

## Run locally

Requires Node 20+. ffmpeg and the image library are installed by `npm install`.

```bash
npm install
npm run dev            # API on http://localhost:3000
npm run dev:web        # UI on http://localhost:5173 (second terminal)

npm run build && npm start                         # API + built UI on one port
docker build -t ips-api . && docker run -p 3000:3000 ips-api   # API as deployed
```

All settings are optional and listed in [`.env.example`](.env.example).

## Test

```bash
npm test               # API, SDK and UI tests
npm run test:e2e       # browser tests (Playwright)
npm run lint && npm run typecheck
```

| Suite   | Tests | Covers                                                                                                 |
| ------- | ----- | ------------------------------------------------------------------------------------------------------ |
| API     | 332   | Every parameter and error, SSRF, limits, caching, rate limiting, transformations, video, logs, metrics |
| SDK     | 57    | URL building, retries, timeouts, typed errors, round trip against the real API                         |
| UI      | 28    | Request building, curl snippets, CSP generation                                                        |
| Browser | 21    | The playground end to end, error states, several screen sizes                                          |

Tests use generated images and videos on a local server, so they don't need the internet. CI runs
everything, plus a Docker build, on every push.

## API

| Endpoint                           |                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /process`                     | Transform an image                                                                       |
| `GET /video/thumbnail`             | Grab a frame from an MP4, MOV or WebM video (`time=` in seconds, plus all image options) |
| `GET /health`, `/metrics`, `/docs` | Health check, Prometheus metrics, interactive docs                                       |

| Parameter                             | Values                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `url`                                 | Required. Absolute `http(s)` URL (URL-encoded)                                     |
| `width`, `height`                     | 1–4000. One alone keeps the aspect ratio                                           |
| `format`                              | `jpeg`, `png`, `webp`, `avif`, `gif`, or `auto` (best format the browser supports) |
| `quality`                             | 1–100, default 80                                                                  |
| `crop`                                | `fill` (default), `fit`, `limit`, `pad`, `scale`                                   |
| `rotate`, `flip`, `blur`, `grayscale` | −360–360 · `horizontal`/`vertical`/`both` · 0.3–100 · `true`                       |

Every error has the same shape, with a stable code and a message that says what to fix:

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "width must be a whole number from 1 to 4000",
    "param": "width",
    "requestId": "…"
  }
}
```

Responses include the output and source dimensions, format and size (`X-Output-*`, `X-Original-*`),
`X-Cache: HIT|MISS`, `ETag` and `X-Request-Id`. Full reference: [`/docs`](https://image-processing-api-ut72.onrender.com/docs).

## SDK

```ts
import { ImageClient, isImageApiError } from '@ips/sdk';

const images = new ImageClient({ baseUrl: 'https://image-processing-api-ut72.onrender.com' });
img.src = images.buildUrl({ url, width: 800, format: 'auto' }); // no network

try {
  const { blob, width, height } = await images.process({ url, width: 400 });
} catch (err) {
  if (isImageApiError(err)) console.log(err.code, err.message);
}
```

No runtime dependencies, ESM and CJS, retries with backoff, timeouts and cancellation. The playground uses
it. See [`packages/sdk`](packages/sdk/README.md).

## Architecture

```
apps/api      Fastify API: validate → cache → safe fetch → sharp / ffmpeg → response
apps/web      React playground (Vite, Tailwind, shadcn/ui), talks to the API through the SDK
packages/sdk  Typed client used by the playground and other integrations
```

A request is validated, then served from the in-memory result cache if possible. Otherwise the
source is downloaded through the safe fetcher, processed by sharp (images) or ffmpeg then sharp
(videos), cached and returned. Formats are detected from the file's bytes, and EXIF metadata
(including GPS) is stripped from every output.

## Limits and safeguards

The service fetches URLs from anyone, so:

- **SSRF:** only public IPs on ports 80/443 are fetched. Private, loopback and cloud-metadata
  addresses (`169.254.169.254`) are blocked, including encoded forms and DNS names pointing at them.
  The IP is checked on the connection itself (no DNS rebinding), and every redirect is checked again.
- **Video:** ffmpeg runs without a shell and can only read local files, so a crafted video can't make
  it fetch URLs.
- **Privacy:** logs contain the source host only, never full URLs, query strings or client IPs.
- **Caching:** processed results and downloaded sources are cached in memory, identical requests
  arriving together share one job, and responses carry `Cache-Control` and an `ETag` (repeat requests
  get a `304`). The server answers a cached request in about 1 ms.
- **UI:** strict Content-Security-Policy allowing only the API's origin.

| Limit           | Default                                                | Why                                                       |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Download time   | 10 s (video 60 s)                                      | Slow sources can't tie up the server                      |
| Source size     | 15 MB (video 100 MB)                                   | Checked while downloading                                 |
| Output size     | 4000 px per side                                       | Bounds CPU and memory                                     |
| Decoded pixels  | 50 MP                                                  | Stops "decompression bombs" (tiny files that decode huge) |
| Processing time | 15 s                                                   | Stops runaway jobs                                        |
| Parallel jobs   | one per CPU core                                       | Extra requests queue instead of exhausting memory         |
| Rate limit      | 60 req/min per IP (video 10)                           | Abuse protection                                          |
| Input types     | JPEG, PNG, WebP, AVIF, GIF, TIFF, SVG · MP4, MOV, WebM | Detected from the file's bytes, not the URL               |

The free Render instance (512 MB RAM) uses lower values, set in [`render.yaml`](render.yaml).

## Deployment

- **API on Render:** New → Blueprint → this repo. [`render.yaml`](render.yaml) defines everything
  (Docker, free plan, `/health` check, settings) and generates the metrics token.
- **UI on Netlify:** import this repo ([`netlify.toml`](netlify.toml)) and set `VITE_API_URL` to the
  API's URL. Make sure the site's visibility is **Public**.

Both redeploy on push to `main`, and only when their own files change. The
[`Dockerfile`](Dockerfile) runs on any container host. No secrets are stored in the repo.

Behind Render's proxies, `TRUST_PROXY=3` makes the rate limit use the real client IP and ignore
spoofed `X-Forwarded-For` headers. I confirmed this on the live deployment.

## Observability

- One JSON log line per request, with a request ID (also returned in `X-Request-Id`).
- `/metrics` reports request count and latency, cache hit rate, errors by code, download and
  processing time, and queued jobs. In production it needs the `METRICS_TOKEN` (use **Authorize** in
  `/docs`).

## Trade-offs and limitations

- **The cache lives in memory:** simple and fast, but cleared on restart and not shared between
  instances. HTTP cache headers and ETags let browsers and CDNs do the rest.
- **Sources are held in memory** up to the size limit, rather than streamed.
- **AVIF trades a little size for speed:** encoding uses a faster setting (about 10× faster on the
  free plan, files about 5% larger).
- **`format=auto` isn't always the smallest:** at quality 80, AVIF can be larger than WebP.
- **Animated images can't be rotated or flipped vertically;** the API explains how to get a still
  frame instead.
- **The job queue has no size cap,** and the rate limit is per instance.
- **The browser console shows one CSP message** from a script Netlify adds to the page. That's
  expected and harmless.
