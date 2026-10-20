import { createHash } from 'node:crypto';

/** A strong ETag derived from the response bytes. */
export function etagFor(data: Buffer): string {
  return `"${createHash('sha256').update(data).digest('base64url').slice(0, 27)}"`;
}

/**
 * Evaluates If-None-Match against our ETag using weak comparison, as
 * RFC 9110 requires for this header: `W/"x"` matches `"x"`, and `*` matches anything.
 */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  const ours = strip(etag);
  return header.split(',').some((tag) => strip(tag) === ours);
}

/**
 * A stable cache key for a set of already-validated, normalised parameters.
 * Validation fills in defaults and aliases (jpg -> jpeg), so
 * `?format=jpg&url=X` and `?url=X&quality=80&format=jpeg` share an entry.
 */
export function cacheKey(namespace: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined)
    .map((k) => [k, params[k]]);
  return `${namespace}:${createHash('sha256').update(JSON.stringify(sorted)).digest('hex')}`;
}
