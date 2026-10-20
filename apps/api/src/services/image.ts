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

export async function transformImage(
  input: Buffer,
  opts: TransformOptions,
  contentType?: string,
): Promise<TransformResult> {
  const meta = await readMetadata(input, contentType);

  const format = resolveFormat(opts.format, meta.format);
  const animated = (meta.pages ?? 1) > 1 && ANIMATED_FORMATS.has(format);

  // EXIF orientation is applied before resizing so width/height mean what the viewer sees.
  let pipeline = sharp(input, { animated }).autoOrient();

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
    // Orientations 5-8 rotate by 90deg, so the visible width/height are swapped.
    const autoOriented = (meta.orientation ?? 1) >= 5;
    const sourceHeight = meta.pageHeight ?? meta.height;
    return {
      data,
      output: {
        format,
        width: info.width,
        // For animations sharp reports the full stacked height; pageHeight is one frame.
        height: info.pageHeight ?? info.height,
        size: data.length,
      },
      original: {
        format: meta.format ?? 'unknown',
        width: (autoOriented ? sourceHeight : meta.width) ?? 0,
        height: (autoOriented ? meta.width : sourceHeight) ?? 0,
        size: input.length,
      },
    };
  } catch {
    throw new AppError(
      'UNPROCESSABLE_IMAGE',
      'The source image could not be processed; it may be corrupt or truncated',
    );
  }
}
