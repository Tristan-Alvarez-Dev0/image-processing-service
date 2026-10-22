import type { z } from 'zod';
import { AppError, type ErrorDetail } from '../errors/app-error.js';

export function parseQuery<S extends z.ZodObject>(schema: S, query: unknown): z.infer<S> {
  const raw = (query ?? {}) as Record<string, unknown>;

  // `?width=1&width=2` arrives as an array; reject it before schema coercion
  // turns it into a confusing "not a number" message.
  const repeated = Object.keys(raw).filter((key) => Array.isArray(raw[key]));
  if (repeated.length > 0) {
    const param = repeated[0]!;
    throw new AppError('INVALID_PARAMETER', `${param} must be given only once`, param);
  }

  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  const details: ErrorDetail[] = result.error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      const supported = Object.keys(schema.shape).join(', ');
      // `?url=https://cdn/a.jpg?w=1&h=2` splits into url + an unknown `h`.
      const hint =
        typeof raw.url === 'string' && raw.url.includes('?')
          ? '. If it belongs to the source URL, URL-encode the url value'
          : '';
      return issue.keys.map((key) => ({
        param: key,
        message: `Unknown parameter '${key}'. Supported parameters: ${supported}${hint}`,
      }));
    }
    return [{ param: issue.path.join('.'), message: issue.message }];
  });

  const first = details[0]!;
  const field = schema.shape[first.param] as z.ZodType | undefined;
  const isMissing = raw[first.param] === undefined || raw[first.param] === '';
  const isRequired = field !== undefined && !field.safeParse(undefined).success;
  if (isMissing && isRequired) {
    throw new AppError('MISSING_PARAMETER', `${first.param} is required`, first.param, details);
  }
  const code = first.param === 'url' ? 'INVALID_URL' : 'INVALID_PARAMETER';
  throw new AppError(code, first.message, first.param, details);
}
