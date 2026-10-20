/** Formats the service can produce. */
export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** `jpg` is an alias for `jpeg`; `auto` negotiates the best format from the Accept header. */
export type Format = OutputFormat | 'jpg' | 'auto';

/**
 * How the image fits a width x height box:
 * - `fill`: cover the box exactly, cropping the overflow (default)
 * - `fit`: fit inside the box, keeping aspect ratio
 * - `limit`: like `fit`, but never enlarge
 * - `pad`: fit inside, then pad to the exact size
 * - `scale`: stretch to the exact size
 */
export const CROP_MODES = ['fill', 'fit', 'limit', 'pad', 'scale'] as const;
export type CropMode = (typeof CROP_MODES)[number];

export const FLIP_MODES = ['horizontal', 'vertical', 'both'] as const;
export type FlipMode = (typeof FLIP_MODES)[number];

export interface TransformOptions {
  /** Output width in pixels. With only one of width/height, the aspect ratio is kept. */
  width?: number;
  height?: number;
  /** Defaults to the source format for images and `jpeg` for video thumbnails. */
  format?: Format;
  /** 1-100, for JPEG, WebP and AVIF. Default 80. */
  quality?: number;
  /** Default `fill`. */
  crop?: CropMode;
  /** Degrees clockwise (-360 to 360), applied before resizing. */
  rotate?: number;
  flip?: FlipMode;
  /** Gaussian blur sigma, 0.3-100. */
  blur?: number;
  grayscale?: boolean;
}

export interface ProcessOptions extends TransformOptions {
  /** Absolute http(s) URL of the source image. */
  url: string;
}

export interface VideoThumbnailOptions extends TransformOptions {
  /** Absolute http(s) URL of an MP4, MOV or WebM video. */
  url: string;
  /** Position of the frame in seconds. Default 0. */
  time?: number;
}

export interface SourceInfo {
  width: number;
  height: number;
  /** Detected from the bytes, e.g. `jpeg`, `png`, `mp4`. */
  format: string;
  /** Bytes. */
  size: number;
  /** Seconds; video thumbnails only. */
  duration?: number;
}

export interface ImageResult {
  /** The processed image. Use `URL.createObjectURL(blob)` to display it in a browser. */
  blob: Blob;
  /** e.g. `image/webp`. */
  contentType: string;
  width: number;
  height: number;
  /** Bytes. */
  size: number;
  original: SourceInfo;
  /** Whether the server served it from its cache. */
  cache: 'HIT' | 'MISS' | undefined;
  etag: string | undefined;
  /** Quote this when reporting a problem. */
  requestId: string | undefined;
  /** The exact URL that was requested. */
  url: string;
}

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  version: string;
}
