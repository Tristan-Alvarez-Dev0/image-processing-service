import {
  ImageClient,
  isImageApiError,
  type CropMode,
  type FlipMode,
  type Format,
  type ImageResult,
  type ProcessOptions,
  type VideoThumbnailOptions,
} from '@ips/sdk';
import { resolveApiUrl } from './api-url';

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL);

export const client = new ImageClient({
  baseUrl: API_URL,
  // Longer than the server's limits, so its clear error arrives before a client timeout.
  timeoutMs: 120_000,
  retry: { retries: 1, baseDelayMs: 300, maxDelayMs: 3_000 },
});

export type Mode = 'image' | 'video';

/** Form fields are strings so users can clear them and type freely; the API validates. */
export interface FormState {
  mode: Mode;
  url: string;
  width: string;
  height: string;
  format: Format | '';
  quality: number;
  crop: CropMode;
  rotate: string;
  flip: FlipMode | '';
  blur: string;
  grayscale: boolean;
  time: string;
}

export const DEFAULT_QUALITY = 80;

export const DEFAULT_FORM: FormState = {
  mode: 'image',
  url: '',
  width: '',
  height: '',
  format: '',
  quality: DEFAULT_QUALITY,
  crop: 'fill',
  rotate: '',
  flip: '',
  blur: '',
  grayscale: false,
  time: '',
};

export const TRANSFORM_DEFAULTS: Omit<FormState, 'mode' | 'url' | 'time'> = {
  width: '',
  height: '',
  format: '',
  quality: DEFAULT_QUALITY,
  crop: 'fill',
  rotate: '',
  flip: '',
  blur: '',
  grayscale: false,
};

type Options = ProcessOptions | VideoThumbnailOptions;

export interface PanelRequest {
  key: string;
  /** Increments on every button press, so pressing again re-runs the same URL. */
  run: number;
  load: (signal: AbortSignal) => Promise<ImageResult>;
}

export interface PreparedRequest {
  mode: Mode;
  original: PanelRequest;
  processed: PanelRequest;
  isAuto: boolean;
}

const toNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));

function toPanelRequest(mode: Mode, options: Options, run: number): PanelRequest {
  return mode === 'video'
    ? {
        key: client.videoThumbnailUrl(options),
        run,
        load: (signal) => client.videoThumbnail(options, { signal }),
      }
    : {
        key: client.buildUrl(options),
        run,
        load: (signal) => client.process(options, { signal }),
      };
}

/** Default values are left out to keep URLs short. */
export function prepareRequest(form: FormState, run = 0): PreparedRequest | undefined {
  const url = form.url.trim();
  if (!url) return undefined;

  const base: Options = form.mode === 'video' ? { url, time: toNumber(form.time) } : { url };
  const processed: Options = {
    ...base,
    width: toNumber(form.width),
    height: toNumber(form.height),
    format: form.format || undefined,
    quality: form.quality === DEFAULT_QUALITY ? undefined : form.quality,
    crop: form.crop === 'fill' ? undefined : form.crop,
    rotate: toNumber(form.rotate),
    flip: form.flip || undefined,
    blur: toNumber(form.blur),
    grayscale: form.grayscale || undefined,
  };

  return {
    mode: form.mode,
    original: toPanelRequest(form.mode, base, run),
    processed: toPanelRequest(form.mode, processed, run),
    isAuto: form.format === 'auto',
  };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function curlCommand(absoluteUrl: string, isAuto: boolean): string {
  const accept = isAuto ? ` -H ${shellQuote('Accept: image/avif,image/webp,*/*')}` : '';
  return `curl -sS -D -${accept} -o output ${shellQuote(absoluteUrl)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function sizeChange(output: number, original: number): string | undefined {
  if (!original) return undefined;
  const change = Math.round((1 - output / original) * 100);
  if (change === 0) return 'same size';
  return change > 0 ? `${change}% smaller` : `${-change}% larger`;
}

export interface DescribedError {
  title: string;
  message: string;
  code: string;
  param?: string | undefined;
  requestId?: string | undefined;
}

const ERROR_TITLES: Record<string, string> = {
  INVALID_PARAMETER: 'Invalid parameter',
  MISSING_PARAMETER: 'Missing parameter',
  INVALID_URL: 'Invalid URL',
  FORBIDDEN_HOST: 'Source not allowed',
  SOURCE_NOT_FOUND: 'Source not found',
  SOURCE_TOO_LARGE: 'Source too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported file',
  UNPROCESSABLE_IMAGE: 'Could not process the image',
  UNPROCESSABLE_VIDEO: 'Could not process the video',
  RATE_LIMITED: 'Slow down',
  UPSTREAM_ERROR: 'Source unreachable',
  UPSTREAM_TIMEOUT: 'Source too slow',
  NETWORK_ERROR: 'API unreachable',
  TIMEOUT: 'API timed out',
};

export function describeError(error: unknown): DescribedError {
  if (isImageApiError(error)) {
    return {
      title: ERROR_TITLES[error.code] ?? 'Request failed',
      message: error.message,
      code: error.code,
      param: error.param,
      requestId: error.requestId,
    };
  }
  return {
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : String(error),
    code: 'UNKNOWN',
  };
}

export interface Sample {
  label: string;
  url: string;
  mode: Mode;
  hint: string;
}

export const SAMPLES: Sample[] = [
  {
    label: 'Photo (JPEG)',
    mode: 'image',
    url: 'https://picsum.photos/id/237/1200/900.jpg',
    hint: '1200x900 JPEG, served through a redirect',
  },
  {
    label: 'Transparent PNG',
    mode: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png',
    hint: 'Try format=jpeg (transparency becomes white) or crop=pad',
  },
  {
    label: 'Animated GIF',
    mode: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif',
    hint: 'Stays animated as GIF or WebP',
  },
  {
    label: 'Phone photo (EXIF)',
    mode: 'image',
    url: 'https://raw.githubusercontent.com/recurser/exif-orientation-examples/master/Landscape_6.jpg',
    hint: 'Stored sideways; EXIF orientation is applied',
  },
  {
    label: 'SVG',
    mode: 'image',
    url: 'https://upload.wikimedia.org/wikipedia/commons/0/02/SVG_logo.svg',
    hint: 'Rendered to PNG',
  },
  {
    label: 'Video (MP4)',
    mode: 'video',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    hint: '5 s, 960x540. Try time=2.5',
  },
  {
    label: 'Video (WebM)',
    mode: 'video',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
    hint: '5 s, 960x540',
  },
];

export const ERROR_SAMPLES: Sample[] = [
  { label: 'Not an image', mode: 'image', url: 'https://example.com/', hint: '415' },
  {
    label: 'Private address',
    mode: 'image',
    url: 'http://169.254.169.254/latest/meta-data/',
    hint: '403: SSRF protection',
  },
  { label: 'Missing file', mode: 'image', url: 'https://httpbin.org/status/404', hint: '404' },
];
