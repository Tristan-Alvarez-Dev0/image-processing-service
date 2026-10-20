export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type Format = OutputFormat | 'jpg' | 'auto';
export const CROP_MODES = ['fill', 'fit', 'limit', 'pad', 'scale'] as const;
export type CropMode = (typeof CROP_MODES)[number];
export const FLIP_MODES = ['horizontal', 'vertical', 'both'] as const;
export type FlipMode = (typeof FLIP_MODES)[number];

export interface TransformOptions {
  width?: number;
  height?: number;
  format?: Format;
  quality?: number;
  crop?: CropMode;
  rotate?: number;
  flip?: FlipMode;
  blur?: number;
  grayscale?: boolean;
}

export interface ProcessOptions extends TransformOptions {
  url: string;
}

export interface VideoThumbnailOptions extends TransformOptions {
  url: string;
  time?: number;
}

export interface SourceInfo {
  width: number;
  height: number;
  format: string;
  size: number;
  duration?: number;
}

export interface ImageResult {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  size: number;
  original: SourceInfo;
  cache: 'HIT' | 'MISS' | undefined;
  etag: string | undefined;
  requestId: string | undefined;
  url: string;
}

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  version: string;
}
