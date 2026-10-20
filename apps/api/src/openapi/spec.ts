import { ERROR_CODES, type ErrorCode } from '../errors/app-error.js';
import {
  CROP_MODES,
  FLIP_MODES,
  MAX_URL_LENGTH,
  MAX_VIDEO_TIME_SECONDS,
  OUTPUT_FORMATS,
} from '../schemas/process.js';

/** From the running config, so the docs never go stale. */
export interface DocumentedLimits {
  version: string;
  maxDimension: number;
  maxInputPixels: number;
  maxSourceBytes: number;
  videoMaxSourceBytes: number;
  maxRedirects: number;
  fetchTimeoutMs: number;
  videoFetchTimeoutMs: number;
  processingTimeoutMs: number;
  rateLimitMax: number;
  videoRateLimitMax: number;
  rateLimitWindowMs: number;
  httpMaxAgeSeconds: number;
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
const mp = (px: number) => `${Math.round(px / 1_000_000)} MP`;

type Schema = Record<string, unknown>;
type Parameter = {
  name: string;
  in: 'query';
  required?: boolean;
  description: string;
  schema: Schema;
  example?: unknown;
};

function transformParameters(l: DocumentedLimits, kind: 'image' | 'video'): Parameter[] {
  const defaultFormat =
    kind === 'image'
      ? 'Defaults to the source format (SVG, TIFF and other formats that cannot be written become PNG).'
      : 'Defaults to `jpeg`.';
  return [
    {
      name: 'url',
      in: 'query',
      required: true,
      description: `Absolute \`http\`/\`https\` URL of the source ${kind}, URL-encoded. Must resolve to a public address; at most ${MAX_URL_LENGTH} characters.`,
      schema: { type: 'string', format: 'uri', maxLength: MAX_URL_LENGTH },
      example:
        kind === 'image'
          ? 'https://picsum.photos/id/237/1200/900.jpg'
          : 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    },
    {
      name: 'width',
      in: 'query',
      description:
        'Output width in pixels. Give width, height or both; with one, the aspect ratio is kept.',
      schema: { type: 'integer', minimum: 1, maximum: l.maxDimension },
      example: 500,
    },
    {
      name: 'height',
      in: 'query',
      description: 'Output height in pixels.',
      schema: { type: 'integer', minimum: 1, maximum: l.maxDimension },
      example: 300,
    },
    {
      name: 'format',
      in: 'query',
      description: `Output format. \`jpg\` is accepted as an alias for \`jpeg\`. \`auto\` picks AVIF, then WebP, from the \`Accept\` header, falling back to PNG (images with transparency) or JPEG, and keeps animations as WebP or GIF; the response then carries \`Vary: Accept\`. ${defaultFormat}`,
      schema: { type: 'string', enum: [...OUTPUT_FORMATS, 'jpg', 'auto'] },
      example: 'webp',
    },
    {
      name: 'quality',
      in: 'query',
      description:
        'Compression quality for JPEG, WebP and AVIF. Ignored for lossless PNG and for GIF.',
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 80 },
    },
    {
      name: 'crop',
      in: 'query',
      description: [
        'How the image fits a width × height box:',
        '- `fill`: cover the box exactly, cropping the overflow (centred)',
        '- `fit`: fit inside the box, keeping aspect ratio',
        '- `limit`: like `fit`, but never enlarge',
        '- `pad`: fit inside, then pad to the exact size (transparent, or white for JPEG)',
        '- `scale`: stretch to the exact size, ignoring aspect ratio',
      ].join('\n'),
      schema: { type: 'string', enum: [...CROP_MODES], default: 'fill' },
    },
    {
      name: 'rotate',
      in: 'query',
      description:
        'Rotate clockwise by this many degrees (negative = counter-clockwise), before resizing, so width/height describe the final image. Angles that are not multiples of 90 expand the canvas. Not available for animated output.',
      schema: { type: 'integer', minimum: -360, maximum: 360 },
      example: 90,
    },
    {
      name: 'flip',
      in: 'query',
      description:
        'Mirror the image: `horizontal` (left↔right), `vertical` (top↔bottom) or `both`. Only `horizontal` is available for animated output.',
      schema: { type: 'string', enum: [...FLIP_MODES] },
    },
    {
      name: 'blur',
      in: 'query',
      description: 'Gaussian blur strength (sigma). Decimals allowed.',
      schema: { type: 'number', minimum: 0.3, maximum: 100 },
      example: 2.5,
    },
    {
      name: 'grayscale',
      in: 'query',
      description: 'Convert to grayscale. Accepts `true`/`false` or `1`/`0`.',
      schema: { type: 'boolean' },
    },
  ];
}

const header = (description: string, schema: Schema = { type: 'string' }) => ({
  description,
  schema,
});

const imageResponseHeaders = {
  'X-Output-Width': header('Width of the returned image.', { type: 'integer' }),
  'X-Output-Height': header('Height of the returned image (one frame, for animations).', {
    type: 'integer',
  }),
  'X-Original-Width': header('Width of the source (after EXIF orientation).', { type: 'integer' }),
  'X-Original-Height': header('Height of the source.', { type: 'integer' }),
  'X-Original-Format': header('Format detected from the source bytes, e.g. `jpeg` or `mp4`.'),
  'X-Original-Size': header('Size of the source in bytes.', { type: 'integer' }),
  'X-Cache': header('`HIT` when served from the result cache, otherwise `MISS`.', {
    type: 'string',
    enum: ['HIT', 'MISS'],
  }),
  ETag: header('Hash of the output bytes; send it back in `If-None-Match` to get a 304.'),
  'Cache-Control': header('`public, max-age=…` for successful responses.'),
  'X-Request-Id': header('Unique ID of this request; also in logs and error bodies.'),
};

const rateLimitHeaders = {
  'X-RateLimit-Limit': header('Requests allowed per window.', { type: 'integer' }),
  'X-RateLimit-Remaining': header('Requests left in the current window.', { type: 'integer' }),
  'X-RateLimit-Reset': header('Seconds until the window resets.', { type: 'integer' }),
};

function codesByStatus(codes: readonly ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_CODES[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return byStatus;
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Invalid request: fix the parameter named in `error.param`.',
  401: 'Missing or wrong bearer token.',
  403: 'The source URL points somewhere this service will not fetch from.',
  404: 'The route or the source does not exist.',
  413: 'The source is too large (bytes or pixels).',
  415: 'The source is not a supported image or video.',
  422: 'The source could not be processed.',
  429: 'Rate limit exceeded; wait for `Retry-After` seconds.',
  500: 'Unexpected server error; report the `requestId`.',
  502: 'The source host failed or returned an error.',
  504: 'The source host did not respond in time.',
};

function errorResponses(codes: readonly ErrorCode[]) {
  const responses: Record<string, unknown> = {};
  for (const [status, statusCodes] of codesByStatus(codes)) {
    responses[String(status)] = {
      description: `${STATUS_TEXT[status]} Codes: ${statusCodes.map((c) => `\`${c}\``).join(', ')}.`,
      headers:
        status === 429 ? { 'Retry-After': header('Seconds to wait.', { type: 'integer' }) } : {},
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    };
  }
  return responses;
}

const PROCESS_ERRORS: ErrorCode[] = [
  'INVALID_PARAMETER',
  'MISSING_PARAMETER',
  'INVALID_URL',
  'FORBIDDEN_HOST',
  'SOURCE_NOT_FOUND',
  'SOURCE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_IMAGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
];

const VIDEO_ERRORS: ErrorCode[] = [...PROCESS_ERRORS, 'UNPROCESSABLE_VIDEO'];

const imageContent = Object.fromEntries(
  OUTPUT_FORMATS.map((f) => [`image/${f}`, { schema: { type: 'string', format: 'binary' } }]),
);

function description(l: DocumentedLimits) {
  return `
Resize, crop, convert and transform remote images, and grab thumbnails from videos, with a single GET request.
Every response is cacheable by URL, so put a CDN in front of it.

## Quick start
\`\`\`
GET /process?url=https://picsum.photos/id/237/1200/900.jpg&width=500&height=300
GET /process?url=…&format=webp&quality=80
GET /process?url=…&width=800&height=600&format=auto&crop=fill
GET /video/thumbnail?url=…/video.mp4&time=15&width=640
\`\`\`
Remember to URL-encode the \`url\` value if it has its own query string.

## Errors
Every error has the same shape, with a stable \`code\` to switch on, a \`message\` that says what to fix,
and the offending \`param\` when there is one:
\`\`\`json
{ "error": { "code": "INVALID_PARAMETER", "message": "width must be a whole number from 1 to ${l.maxDimension}", "param": "width", "requestId": "…" } }
\`\`\`

## Limits
| Limit | Value |
|---|---|
| Output width/height | ${l.maxDimension} px |
| Decoded pixels (input and output, all frames) | ${mp(l.maxInputPixels)} |
| Source size | ${mb(l.maxSourceBytes)} (videos: ${mb(l.videoMaxSourceBytes)}) |
| Fetch time (including redirects) | ${l.fetchTimeoutMs / 1000} s (videos: ${l.videoFetchTimeoutMs / 1000} s) |
| Redirects | ${l.maxRedirects} |
| Processing time | ${l.processingTimeoutMs / 1000} s |
| Rate limit per IP | ${l.rateLimitMax} requests / ${l.rateLimitWindowMs / 1000} s (video: ${l.videoRateLimitMax}) |

Sources must be public: URLs that resolve to private, loopback, link-local or other internal addresses
are refused, on every redirect hop. Only ports 80 and 443 are allowed by default.

## Caching
Successful responses carry \`Cache-Control: public, max-age=${l.httpMaxAgeSeconds}\` and a content-based \`ETag\`.
Repeated requests are served from an in-memory cache (\`X-Cache: HIT\`); identical concurrent requests share one job.
`.trim();
}

export function buildOpenApiDocument(l: DocumentedLimits) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Image Processing Service',
      version: l.version,
      description: description(l),
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Images', description: 'Transform remote images' },
      { name: 'Video', description: 'Thumbnails from remote videos' },
      { name: 'Operations', description: 'Health and metrics' },
    ],
    paths: {
      '/process': {
        get: {
          tags: ['Images'],
          operationId: 'processImage',
          summary: 'Transform an image',
          description:
            'Fetches the image at `url`, applies the requested transformations and returns the result. Steps run in this order: EXIF orientation, flip, rotate, resize/crop, blur, grayscale, encode.',
          parameters: [
            ...transformParameters(l, 'image'),
            {
              name: 'If-None-Match',
              in: 'header',
              description: 'An ETag from a previous response; answered with 304 if unchanged.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'The transformed image.',
              headers: { ...imageResponseHeaders, ...rateLimitHeaders },
              content: imageContent,
            },
            '304': { description: 'Not modified: the `If-None-Match` ETag still matches.' },
            ...errorResponses(PROCESS_ERRORS),
          },
        },
      },
      '/video/thumbnail': {
        get: {
          tags: ['Video'],
          operationId: 'videoThumbnail',
          summary: 'Extract a thumbnail from a video',
          description:
            'Fetches an MP4, MOV or WebM video, grabs the frame at `time` and returns it as an image. Every `/process` transformation is available.',
          parameters: [
            ...transformParameters(l, 'video'),
            {
              name: 'time',
              in: 'query',
              description: 'Position of the frame, in seconds. Decimals allowed.',
              schema: { type: 'number', minimum: 0, maximum: MAX_VIDEO_TIME_SECONDS, default: 0 },
              example: 2.5,
            },
          ],
          responses: {
            '200': {
              description: 'The frame as an image.',
              headers: {
                ...imageResponseHeaders,
                'X-Original-Duration': header('Length of the video in seconds.', {
                  type: 'number',
                }),
                ...rateLimitHeaders,
              },
              content: imageContent,
            },
            '304': { description: 'Not modified.' },
            ...errorResponses(VIDEO_ERRORS),
          },
        },
      },
      '/health': {
        get: {
          tags: ['Operations'],
          operationId: 'health',
          summary: 'Health check',
          description: 'For load balancers and uptime checks. Never rate limited.',
          responses: {
            '200': {
              description: 'The service is up.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'uptime', 'version'],
                    properties: {
                      status: { type: 'string', enum: ['ok'] },
                      uptime: { type: 'integer', description: 'Seconds since start' },
                      version: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/metrics': {
        get: {
          tags: ['Operations'],
          operationId: 'metrics',
          summary: 'Prometheus metrics',
          description:
            'Request counts and latency, cache hits, errors by code, fetch and processing times, in Prometheus text format. Requires `Authorization: Bearer <token>` when the server sets `METRICS_TOKEN` (use the Authorize button); otherwise it is public.',
          security: [{ metricsToken: [] }, {}],
          responses: {
            '200': {
              description: 'Prometheus text format.',
              content: { 'text/plain': { schema: { type: 'string' } } },
            },
            ...errorResponses(['UNAUTHORIZED']),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        metricsToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'The value of METRICS_TOKEN, if the server sets one. Only used by /metrics.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'requestId'],
              properties: {
                code: {
                  type: 'string',
                  enum: Object.keys(ERROR_CODES),
                  description: 'Stable, machine-readable error code.',
                },
                message: { type: 'string', description: 'What went wrong and how to fix it.' },
                param: { type: 'string', description: 'The parameter at fault, if any.' },
                details: {
                  type: 'array',
                  description: 'Every problem found, when there is more than one.',
                  items: {
                    type: 'object',
                    required: ['param', 'message'],
                    properties: { param: { type: 'string' }, message: { type: 'string' } },
                  },
                },
                requestId: { type: 'string', description: 'Quote this when reporting a problem.' },
              },
            },
          },
          example: {
            error: {
              code: 'INVALID_PARAMETER',
              message: `width must be a whole number from 1 to ${l.maxDimension}`,
              param: 'width',
              requestId: '359fbf95-5418-49b2-8d0d-4f01429cd2dc',
            },
          },
        },
      },
    },
  };
}
