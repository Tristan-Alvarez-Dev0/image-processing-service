import { z } from 'zod';

export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

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

const dimension = z.coerce.number().int().positive();

export const processQuerySchema = z.object({
  url: z.url({ protocol: /^https?$/, error: 'url must be an absolute http(s) URL' }),
  width: dimension.optional(),
  height: dimension.optional(),
  format: z
    .preprocess(
      (v) => (typeof v === 'string' ? (FORMAT_ALIASES[v.toLowerCase()] ?? v.toLowerCase()) : v),
      z.enum(OUTPUT_FORMATS),
    )
    .optional(),
  quality: z.coerce.number().int().min(1).max(100).default(80),
  crop: z.enum(CROP_MODES).default('fill'),
});

export type ProcessQuery = z.infer<typeof processQuerySchema>;
