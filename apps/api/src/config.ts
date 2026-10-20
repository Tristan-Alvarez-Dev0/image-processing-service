import { readFileSync } from 'node:fs';
import { z } from 'zod';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().default(pkg.version),
  // Only enable behind a trusted reverse proxy; otherwise clients can spoof
  // X-Forwarded-For and dodge per-IP rate limits.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parses config from environment variables. Throws a readable error listing
 * every invalid variable so a misconfigured deploy fails fast at boot.
 */
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
