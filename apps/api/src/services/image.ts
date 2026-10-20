import sharp, { type FitEnum, type Metadata, type Sharp } from 'sharp';
import { AppError } from '../errors/app-error.js';
import type { CropMode, FlipMode, OutputFormat, RequestedFormat } from '../schemas/process.js';
import { OUTPUT_FORMATS } from '../schemas/process.js';
import { chooseAutoFormat, type AcceptedFormats } from './format-negotiation.js';

export interface TransformOptions {
  width?: number | undefined;
  height?: number | undefined;
  format?: RequestedFormat | undefined;
  quality: number;
  crop: CropMode;
  /** Degrees clockwise, 0-359. Applied before resizing. */
  rotate?: number | undefined;
  flip?: FlipMode | undefined;
  blur?: number | undefined;
  grayscale?: boolean | undefined;
  /** What the client accepts; only used for format=auto. */
  accept?: AcceptedFormats | undefined;
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

/** Explicit format wins; `auto` negotiates; otherwise keep the source format, or PNG. */
function resolveFormat(opts: TransformOptions, meta: Metadata, frames: number): OutputFormat {
  const requested = opts.format;
  if (requested === 'auto') {
    return chooseAutoFormat(opts.accept ?? { avif: false, webp: false }, {
      hasAlpha: meta.hasAlpha ?? false,
      animated: frames > 1,
    });
  }
  if (requested) return requested;
  if (meta.format === 'heif') return 'avif';
  return isOutputFormat(meta.format) ? meta.format : 'png';
}

const backgroundFor = (format: OutputFormat) =>
  format === 'jpeg' ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };

function rotatedSize(w: number, h: number, deg: number): [number, number] {
  if (deg % 180 === 0) return [w, h];
  if (deg % 90 === 0) return [h, w];
  const rad = (deg * Math.PI) / 180;
  const [cos, sin] = [Math.abs(Math.cos(rad)), Math.abs(Math.sin(rad))];
  return [Math.ceil(w * cos + h * sin), Math.ceil(w * sin + h * cos)];
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

/** Undecodable bytes labelled image/* are corrupt (422); anything else isn't an image (415). */
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

/** Detected from the bytes, not the URL or Content-Type. `heif` covers AVIF. */
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

  const format = resolveFormat(opts, meta, frames);
  const animated = frames > 1 && ANIMATED_FORMATS.has(format);

  // sharp treats an animation as one tall strip of frames: it cannot rotate it,
  // and a vertical flip would also reverse the frame order.
  if (animated && opts.rotate) {
    throw new AppError(
      'INVALID_PARAMETER',
      'rotate is not supported for animated output; add format=jpeg or format=png to rotate the first frame',
      'rotate',
    );
  }
  if (animated && (opts.flip === 'vertical' || opts.flip === 'both')) {
    throw new AppError(
      'INVALID_PARAMETER',
      `flip=${opts.flip} is not supported for animated output; use flip=horizontal, or add format=jpeg or format=png to flip the first frame`,
      'flip',
    );
  }

  const [rotW, rotH] = rotatedSize(srcW, srcH, opts.rotate ?? 0);
  const outputPixels = estimateOutputPixels(rotW, rotH, opts) * (animated ? frames : 1);
  if (outputPixels > limits.maxInputPixels) {
    const across = animated ? ` across ${frames} frames` : '';
    throw new AppError(
      'INVALID_PARAMETER',
      `The output would be about ${megapixels(outputPixels)}${across}; the limit is ${megapixels(limits.maxInputPixels)}. Request a smaller width or height`,
      opts.width ? 'width' : 'height',
    );
  }

  // Orient and rotate before resizing, so width/height describe the final image.
  let pipeline = sharp(input, { animated, limitInputPixels: limits.maxInputPixels })
    .timeout({ seconds: Math.max(1, Math.ceil(limits.timeoutMs / 1000)) })
    .autoOrient();

  // sharp's flip() mirrors top/bottom and flop() mirrors left/right.
  if (opts.flip === 'vertical' || opts.flip === 'both') pipeline = pipeline.flip();
  if (opts.flip === 'horizontal' || opts.flip === 'both') pipeline = pipeline.flop();

  if (opts.rotate) pipeline = pipeline.rotate(opts.rotate, { background: backgroundFor(format) });

  if (opts.width || opts.height) {
    pipeline = pipeline.resize({
      width: opts.width,
      height: opts.height,
      fit: FIT_BY_CROP[opts.crop],
      withoutEnlargement: opts.crop === 'limit',
      // Opaque formats can't hold transparent padding, so pad JPEGs with white.
      background: backgroundFor(format),
    });
  }

  if (opts.blur) pipeline = pipeline.blur(opts.blur);
  // Single channel: about half the size for PNG.
  if (opts.grayscale) pipeline = pipeline.greyscale().toColourspace('b-w');
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
