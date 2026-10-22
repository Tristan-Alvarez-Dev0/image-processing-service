import { z } from 'zod';

export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const REQUESTED_FORMATS = [...OUTPUT_FORMATS, 'auto'] as const;
export type RequestedFormat = (typeof REQUESTED_FORMATS)[number];

export const FLIP_MODES = ['horizontal', 'vertical', 'both'] as const;
export type FlipMode = (typeof FLIP_MODES)[number];

export const CROP_MODES = ['fill', 'fit', 'limit', 'pad', 'scale'] as const;
export type CropMode = (typeof CROP_MODES)[number];

const FORMAT_ALIASES: Record<string, string> = { jpg: 'jpeg' };

/** Stricter than Number(): rejects "1e3", "0x10", "12px" and "1.5". */
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

const angle = (name: string) => {
  const message = `${name} must be a whole number of degrees from -360 to 360`;
  return z
    .string({ error: message })
    .regex(/^-?\d+$/, { error: message })
    .transform(Number)
    .pipe(z.number().min(-360, { error: message }).max(360, { error: message }))
    .transform((deg) => ((deg % 360) + 360) % 360);
};

const decimal = (name: string, min: number, max: number, unit?: string) => {
  const message = `${name} must be a number${unit ? ` of ${unit}` : ''} from ${min} to ${max}`;
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

const transformShape = ({ maxDimension }: ProcessLimits) => ({
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
});

export const createProcessQuerySchema = (limits: ProcessLimits) =>
  z.object(transformShape(limits)).strict();

export type ProcessQuery = z.infer<ReturnType<typeof createProcessQuerySchema>>;

export const MAX_VIDEO_TIME_SECONDS = 86_400;

export const createVideoQuerySchema = (limits: ProcessLimits) =>
  z
    .object({
      ...transformShape(limits),
      time: decimal('time', 0, MAX_VIDEO_TIME_SECONDS, 'seconds').default(0),
    })
    .strict();

export type VideoQuery = z.infer<ReturnType<typeof createVideoQuerySchema>>;
