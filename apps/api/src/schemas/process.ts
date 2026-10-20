import { z } from 'zod';

export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** `auto` picks the best format the client accepts (see services/format-negotiation). */
export const REQUESTED_FORMATS = [...OUTPUT_FORMATS, 'auto'] as const;
export type RequestedFormat = (typeof REQUESTED_FORMATS)[number];

/** Mirror the image: horizontal swaps left/right, vertical swaps top/bottom. */
export const FLIP_MODES = ['horizontal', 'vertical', 'both'] as const;
export type FlipMode = (typeof FLIP_MODES)[number];

/**
 * How the image is fitted into the requested width x height box.
 * - fill:  cover the box exactly, cropping the overflow (default)
 * - fit:   fit inside the box, keeping aspect ratio (may be smaller on one side)
 * - limit: like fit, but never upscale beyond the source size
 * - pad:   fit inside the box, then pad to the exact size
 * - scale: stretch to the exact size, ignoring aspect ratio
 */
export const CROP_MODES = ['fill', 'fit', 'limit', 'pad', 'scale'] as const;
export type CropMode = (typeof CROP_MODES)[number];

const FORMAT_ALIASES: Record<string, string> = { jpg: 'jpeg' };

/**
 * Parses a query value as a whole number. Stricter than Number(): rejects
 * "1e3", "0x10", "12px", " 12" and "1.5" so typos don't silently pass.
 */
const integer = (name: string, min: number, max?: number) => {
  const range =
    max === undefined ? `a whole number >= ${min}` : `a whole number from ${min} to ${max}`;
  const message = `${name} must be ${range}`;
  return z
    .string({ error: message })
    .regex(/^\d+$/, { error: message })
    .transform(Number)
    .pipe(
      max === undefined
        ? z.number().min(min, { error: message })
        : z.number().min(min, { error: message }).max(max, { error: message }),
    );
};

/** Rotation in degrees; negatives are counter-clockwise. Normalised to 0-359. */
const angle = (name: string) => {
  const message = `${name} must be a whole number of degrees from -360 to 360`;
  return z
    .string({ error: message })
    .regex(/^-?\d+$/, { error: message })
    .transform(Number)
    .pipe(z.number().min(-360, { error: message }).max(360, { error: message }))
    .transform((deg) => ((deg % 360) + 360) % 360);
};

/** A plain decimal such as "2" or "2.5" (no exponents or hex). */
const decimal = (name: string, min: number, max: number) => {
  const message = `${name} must be a number from ${min} to ${max}`;
  return z
    .string({ error: message })
    .regex(/^\d+(\.\d+)?$/, { error: message })
    .transform(Number)
    .pipe(z.number().min(min, { error: message }).max(max, { error: message }));
};

const flag = (name: string) =>
  z
    .enum(['true', 'false', '1', '0'], { error: `${name} must be true or false` })
    .transform((v) => v === 'true' || v === '1');

const oneOf = <T extends readonly [string, ...string[]]>(name: string, values: T, extra = '') =>
  z.enum(values, {
    error: `${name} must be one of: ${[...values, extra].filter(Boolean).join(', ')}`,
  });

/** Long enough for real CDN URLs with signed query strings; stops abuse via giant URLs. */
export const MAX_URL_LENGTH = 2048;

export interface ProcessLimits {
  maxDimension: number;
}

export const sourceUrl = () =>
  z
    .string()
    .max(MAX_URL_LENGTH, { error: `url must be at most ${MAX_URL_LENGTH} characters` })
    .pipe(
      z.url({
        protocol: /^https?$/,
        error: 'url must be an absolute http:// or https:// URL (remember to URL-encode it)',
      }),
    );

export const createProcessQuerySchema = ({ maxDimension }: ProcessLimits) =>
  z
    .object({
      url: sourceUrl(),
      width: integer('width', 1, maxDimension).optional(),
      height: integer('height', 1, maxDimension).optional(),
      format: z
        .preprocess(
          (v) => (typeof v === 'string' ? (FORMAT_ALIASES[v.toLowerCase()] ?? v.toLowerCase()) : v),
          oneOf('format', REQUESTED_FORMATS, 'jpg'),
        )
        .optional(),
      quality: integer('quality', 1, 100).default(80),
      crop: oneOf('crop', CROP_MODES).default('fill'),
      rotate: angle('rotate').optional(),
      flip: oneOf('flip', FLIP_MODES).optional(),
      blur: decimal('blur', 0.3, 100).optional(),
      grayscale: flag('grayscale').optional(),
    })
    .strict();

export type ProcessQuery = z.infer<ReturnType<typeof createProcessQuerySchema>>;
