import sharp, { type FitEnum, type Metadata, type Sharp } from 'sharp';
import { AppError } from '../errors/app-error.js';
import type { CropMode, OutputFormat } from '../schemas/process.js';
import { OUTPUT_FORMATS } from '../schemas/process.js';

export interface TransformOptions {
  width?: number | undefined;
  height?: number | undefined;
  format?: OutputFormat | undefined;
  quality: number;
  crop: CropMode;
}

export interface ImageInfo {
  format: string;
  width: number;
  height: number;
  size: number;
}

export interface TransformResult {
  data: Buffer;
  output: ImageInfo & { format: OutputFormat };
  original: ImageInfo;
}

const FIT_BY_CROP: Record<CropMode, keyof FitEnum> = {
  fill: 'cover',
  fit: 'inside',
  limit: 'inside',
  pad: 'contain',
  scale: 'fill',
};

const ANIMATED_FORMATS: ReadonlySet<OutputFormat> = new Set(['gif', 'webp']);

const isOutputFormat = (f: string | undefined): f is OutputFormat =>
  (OUTPUT_FORMATS as readonly string[]).includes(f ?? '');

/** Keep the source format when we can encode it; otherwise fall back to PNG (lossless, keeps alpha). */
function resolveFormat(
  requested: OutputFormat | undefined,
  source: string | undefined,
): OutputFormat {
  if (requested) return requested;
  if (source === 'jpg') return 'jpeg';
  if (source === 'heif') return 'avif';
  return isOutputFormat(source) ? source : 'png';
}

function encode(pipeline: Sharp, format: OutputFormat, quality: number): Sharp {
  switch (format) {
    case 'jpeg':
      return pipeline.jpeg({ quality, mozjpeg: true });
    case 'webp':
      return pipeline.webp({ quality });
    case 'avif':
      return pipeline.avif({ quality });
    case 'png':
      // PNG is lossless; quality has no meaningful effect.
      return pipeline.png({ compressionLevel: 9 });
    case 'gif':
      return pipeline.gif();
  }
}

/**
 * Reads image metadata. If the bytes aren't a recognisable image, the upstream
 * Content-Type decides the error: an "image/*" response that fails to decode is
 * corrupt (422), anything else simply isn't an image (415).
 */
async function readMetadata(input: Buffer, contentType: string | undefined): Promise<Metadata> {
  try {
    return await sharp(input).metadata();
  } catch {
    const mime = contentType?.split(';')[0]?.trim().toLowerCase();
    if (mime?.startsWith('image/')) {
      throw new AppError(
        'UNPROCESSABLE_IMAGE',
        `The source is labelled ${mime} but could not be decoded; it may be corrupt or truncated`,
      );
    }
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      `The source URL did not return an image${mime ? ` (got ${mime})` : ''}`,
    );
  }
}

/** Detected from the file's bytes, never from the URL or Content-Type. `heif` covers AVIF. */
export const SUPPORTED_INPUT_FORMATS: ReadonlySet<string> = new Set([
  'jpeg',
  'png',
  'webp',
  'gif',
  'heif',
  'tiff',
  'svg',
]);

export interface ImageLimits {
  /** Max decoded pixels across all frames (decompression-bomb guard). */
  maxInputPixels: number;
  timeoutMs: number;
}

const megapixels = (px: number) =>
  px >= 1_000_000 ? `${Math.round(px / 100_000) / 10} MP` : `${px.toLocaleString('en-US')} pixels`;

/** Upper bound of the output size in pixels for a single frame. */
function estimateOutputPixels(srcW: number, srcH: number, opts: TransformOptions): number {
  const clampW = (w: number) => (opts.crop === 'limit' ? Math.min(w, srcW) : w);
  const clampH = (h: number) => (opts.crop === 'limit' ? Math.min(h, srcH) : h);
  if (opts.width && opts.height) return clampW(opts.width) * clampH(opts.height);
  if (opts.width) {
    const w = clampW(opts.width);
    return w * Math.max(1, Math.round((w * srcH) / srcW));
  }
  if (opts.height) {
    const h = clampH(opts.height);
    return h * Math.max(1, Math.round((h * srcW) / srcH));
  }
  return srcW * srcH;
}

export async function transformImage(
  input: Buffer,
  opts: TransformOptions,
  limits: ImageLimits,
  contentType?: string,
): Promise<TransformResult> {
  const meta = await readMetadata(input, contentType);

  if (!meta.format || !SUPPORTED_INPUT_FORMATS.has(meta.format)) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      `Source format '${meta.format ?? 'unknown'}' is not supported. Supported: JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG`,
    );
  }

  // Orientations 5-8 rotate by 90deg, so the visible width/height are swapped.
  const rotated = (meta.orientation ?? 1) >= 5;
  const frameHeight = meta.pageHeight ?? meta.height ?? 0;
  const srcW = (rotated ? frameHeight : meta.width) ?? 0;
  const srcH = (rotated ? meta.width : frameHeight) ?? 0;
  const frames = meta.pages ?? 1;

  // Checked from the header, before decoding a single pixel.
  const inputPixels = srcW * srcH * frames;
  if (inputPixels > limits.maxInputPixels) {
    const across = frames > 1 ? ` across ${frames} frames` : '';
    throw new AppError(
      'SOURCE_TOO_LARGE',
      `The source image is ${srcW}x${srcH}${across} (${megapixels(inputPixels)}); the limit is ${megapixels(limits.maxInputPixels)}`,
    );
  }

  const format = resolveFormat(opts.format, meta.format);
  const animated = frames > 1 && ANIMATED_FORMATS.has(format);

  const outputPixels = estimateOutputPixels(srcW, srcH, opts) * (animated ? frames : 1);
  if (outputPixels > limits.maxInputPixels) {
    const across = animated ? ` across ${frames} frames` : '';
    throw new AppError(
      'INVALID_PARAMETER',
      `The output would be about ${megapixels(outputPixels)}${across}; the limit is ${megapixels(limits.maxInputPixels)}. Request a smaller width or height`,
      opts.width ? 'width' : 'height',
    );
  }

  // EXIF orientation is applied before resizing so width/height mean what the viewer sees.
  let pipeline = sharp(input, { animated, limitInputPixels: limits.maxInputPixels })
    .timeout({ seconds: Math.max(1, Math.ceil(limits.timeoutMs / 1000)) })
    .autoOrient();

  if (opts.width || opts.height) {
    // Opaque formats can't hold transparent padding, so pad JPEGs with white.
    const background =
      format === 'jpeg' ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
    pipeline = pipeline.resize({
      width: opts.width,
      height: opts.height,
      fit: FIT_BY_CROP[opts.crop],
      withoutEnlargement: opts.crop === 'limit',
      background,
    });
  }

  if (format === 'jpeg') pipeline = pipeline.flatten({ background: '#ffffff' });

  try {
    const { data, info } = await encode(pipeline, format, opts.quality).toBuffer({
      resolveWithObject: true,
    });
    return {
      data,
      output: {
        format,
        width: info.width,
        // For animations sharp reports the full stacked height; pageHeight is one frame.
        height: info.pageHeight ?? info.height,
        size: data.length,
      },
      original: { format: meta.format, width: srcW, height: srcH, size: input.length },
    };
  } catch (err) {
    if (err instanceof Error && /timeout/i.test(err.message)) {
      throw new AppError(
        'UNPROCESSABLE_IMAGE',
        `The image took longer than ${limits.timeoutMs / 1000}s to process; try a smaller output size`,
      );
    }
    throw new AppError(
      'UNPROCESSABLE_IMAGE',
      'The source image could not be processed; it may be corrupt or truncated',
    );
  }
}
