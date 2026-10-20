import { createHash } from 'node:crypto';

export function etagFor(data: Buffer): string {
  return `"${createHash('sha256').update(data).digest('base64url').slice(0, 27)}"`;
}

/** Weak comparison, as RFC 9110 requires for If-None-Match. */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  const ours = strip(etag);
  return header.split(',').some((tag) => strip(tag) === ours);
}

/** Built from validated params, so aliases, defaults and order don't create extra entries. */
export function cacheKey(namespace: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined)
    .map((k) => [k, params[k]]);
  return `${namespace}:${createHash('sha256').update(JSON.stringify(sorted)).digest('hex')}`;
}
