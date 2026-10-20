import type { ProcessOptions, VideoThumbnailOptions } from './types.js';

/** Fixed order, so the same options always give the same URL (better CDN caching). */
const PARAM_ORDER = [
  'url',
  'width',
  'height',
  'format',
  'quality',
  'crop',
  'rotate',
  'flip',
  'blur',
  'grayscale',
  'time',
] as const;

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export function buildQuery(options: ProcessOptions | VideoThumbnailOptions): string {
  if (!options || typeof options.url !== 'string' || options.url === '') {
    throw new TypeError('`url` is required');
  }
  const params = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    const value = (options as unknown as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  return params.toString();
}
