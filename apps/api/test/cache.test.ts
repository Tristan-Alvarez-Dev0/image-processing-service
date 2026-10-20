import { describe, expect, it } from 'vitest';
import { LoadingCache } from '../src/services/cache.js';
import { cacheKey, etagFor, ifNoneMatchHits } from '../src/services/http-cache.js';

const sized = (n: number) => ({ size: n });
const cache = (maxBytes = 100) =>
  new LoadingCache<{ size: number }>({ maxBytes, ttlMs: 60_000, sizeOf: (v) => v.size });

describe('LoadingCache', () => {
  it('loads once, then serves hits', async () => {
    const c = cache();
    let loads = 0;
    const load = async () => (loads++, sized(1));

    expect((await c.get('k', load)).hit).toBe(false);
    expect((await c.get('k', load)).hit).toBe(true);
    expect(loads).toBe(1);
    expect(c.stats).toMatchObject({ hits: 1, misses: 1, entries: 1, bytes: 1, inFlight: 0 });
  });

  it('shares one load between concurrent callers', async () => {
    const c = cache();
    let loads = 0;
    const load = () =>
      new Promise<{ size: number }>((r) => setTimeout(() => (loads++, r(sized(1))), 10));

    const results = await Promise.all(Array.from({ length: 5 }, () => c.get('k', load)));

    expect(loads).toBe(1);
    expect(results.filter((r) => !r.hit)).toHaveLength(1);
    expect(new Set(results.map((r) => r.value)).size).toBe(1);
  });

  it('never caches failures', async () => {
    const c = cache();
    await expect(c.get('k', () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');

    expect((await c.get('k', async () => sized(1))).hit).toBe(false);
    expect(c.stats.inFlight).toBe(0);
  });

  it('evicts least-recently-used entries to stay within the byte budget', async () => {
    const c = cache(10);
    await c.get('a', async () => sized(6));
    await c.get('b', async () => sized(6));

    expect(c.stats).toMatchObject({ entries: 1, bytes: 6 });
    expect((await c.get('a', async () => sized(6))).hit).toBe(false);
  });

  it('still de-duplicates in-flight loads when storage is disabled', async () => {
    const c = cache(0);
    let loads = 0;
    const load = () =>
      new Promise<{ size: number }>((r) => setTimeout(() => (loads++, r(sized(1))), 10));

    await Promise.all([c.get('k', load), c.get('k', load)]);
    await c.get('k', load);

    expect(loads).toBe(2);
    expect(c.stats.entries).toBe(0);
  });
});

describe('http cache helpers', () => {
  it('cacheKey ignores parameter order and undefined values', () => {
    expect(cacheKey('p', { b: 1, a: 'x', c: undefined })).toBe(cacheKey('p', { a: 'x', b: 1 }));
    expect(cacheKey('p', { a: 1 })).not.toBe(cacheKey('p', { a: 2 }));
    expect(cacheKey('p', { a: 1 })).not.toBe(cacheKey('q', { a: 1 }));
  });

  it('etagFor is a quoted, content-derived strong tag', () => {
    const tag = etagFor(Buffer.from('hello'));

    expect(tag).toMatch(/^"[\w-]{27}"$/);
    expect(etagFor(Buffer.from('hello'))).toBe(tag);
    expect(etagFor(Buffer.from('hello!'))).not.toBe(tag);
  });

  it.each([
    ['"abc"', true],
    ['W/"abc"', true],
    ['"zzz", "abc"', true],
    ['*', true],
    ['"zzz"', false],
    ['abc', false],
    [undefined, false],
  ])('If-None-Match %s -> %s', (header, expected) => {
    expect(ifNoneMatchHits(header, '"abc"')).toBe(expected);
  });
});
