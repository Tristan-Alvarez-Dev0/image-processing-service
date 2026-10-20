import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { z } from 'zod';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// ffmpeg-static is CommonJS and exports the binary path (null on unsupported platforms).
const ffmpegStatic = createRequire(import.meta.url)('ffmpeg-static') as string | null;

const MB = 1024 * 1024;

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);

const commaList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_VERSION: z.string().default(pkg.version),
    // Only enable behind a trusted reverse proxy; otherwise clients can spoof
    // X-Forwarded-For and dodge per-IP rate limits.
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    /** Total time budget for fetching the source, across all redirects. */
    FETCH_TIMEOUT_MS: positiveInt.default(10_000),
    MAX_SOURCE_BYTES: positiveInt.default(15 * MB),
    MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
    /** Destination ports the fetcher may connect to. `*` allows any port. */
    ALLOWED_PORTS: z
      .string()
      .default('80,443')
      .transform((v, ctx) => {
        if (v.trim() === '*') return '*' as const;
        const ports = v.split(',').map((p) => Number(p.trim()));
        if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
          ctx.addIssue({ code: 'custom', message: 'must be * or a comma-separated list of ports' });
          return z.NEVER;
        }
        return new Set(ports);
      }),
    /** Private IPs to allow anyway (e.g. 127.0.0.1). Dev/test only; refused in production. */
    ALLOW_PRIVATE_ADDRESSES: commaList,

    MAX_OUTPUT_DIMENSION: positiveInt.default(4000),
    /** Decompression-bomb guard: max decoded pixels (width x height x frames). */
    MAX_INPUT_PIXELS: positiveInt.default(50_000_000),
    PROCESSING_TIMEOUT_MS: positiveInt.default(15_000),
    MAX_CONCURRENT_JOBS: positiveInt.default(availableParallelism()),

    VIDEO_MAX_SOURCE_BYTES: positiveInt.default(100 * MB),
    /** Videos are large and CDN speed varies widely (0.8-5 MB/s measured), so 10 s is too short. */
    VIDEO_FETCH_TIMEOUT_MS: positiveInt.default(60_000),
    FFMPEG_PATH: z.string().default(ffmpegStatic ?? 'ffmpeg'),

    /** Requests per client IP per window; 0 disables rate limiting. */
    RATE_LIMIT_MAX: nonNegativeInt.default(60),
    RATE_LIMIT_WINDOW_MS: positiveInt.default(60_000),
    VIDEO_RATE_LIMIT_MAX: positiveInt.default(10),

    WEB_ROOT: z.string().default(fileURLToPath(new URL('../../web/dist', import.meta.url))),

    METRICS_TOKEN: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(16, { error: 'must be at least 16 characters' }).optional(),
    ),

    /** Processed images kept in memory; 0 disables. */
    RESULT_CACHE_MAX_BYTES: nonNegativeInt.default(100 * MB),
    RESULT_CACHE_TTL_SECONDS: positiveInt.default(3600),
    /** Downloaded originals, so tweaking params doesn't re-download; 0 disables. */
    SOURCE_CACHE_MAX_BYTES: nonNegativeInt.default(50 * MB),
    SOURCE_CACHE_TTL_SECONDS: positiveInt.default(300),
    HTTP_CACHE_MAX_AGE_SECONDS: nonNegativeInt.default(86_400),
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.ALLOW_PRIVATE_ADDRESSES.length === 0, {
    path: ['ALLOW_PRIVATE_ADDRESSES'],
    message: 'must not be set in production (it disables SSRF protection for those addresses)',
  });

export type Config = z.infer<typeof configSchema>;

/** Parses env vars, failing fast with every invalid variable listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
