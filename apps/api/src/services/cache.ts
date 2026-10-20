import { LRUCache } from 'lru-cache';

export interface CacheOptions<V> {
  /** Memory budget in bytes; 0 disables caching (in-flight sharing still applies). */
  maxBytes: number;
  ttlMs: number;
  sizeOf: (value: V) => number;
}

export interface CacheResult<V> {
  value: V;
  /** True when no work was done for this caller (cached, or shared with an in-flight load). */
  hit: boolean;
}

/**
 * An in-memory LRU cache with a byte budget that also de-duplicates
 * concurrent loads: if 50 identical requests arrive at once, the loader runs
 * once and all 50 share the result. Failed loads are never cached.
 */
export class LoadingCache<V extends object> {
  private readonly lru: LRUCache<string, V> | undefined;
  private readonly inFlight = new Map<string, Promise<V>>();
  private hits = 0;
  private misses = 0;

  constructor(opts: CacheOptions<V>) {
    if (opts.maxBytes > 0) {
      this.lru = new LRUCache<string, V>({
        maxSize: opts.maxBytes,
        sizeCalculation: (value) => Math.max(1, opts.sizeOf(value)),
        ttl: opts.ttlMs,
      });
    }
  }

  get stats() {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.lru?.size ?? 0,
      bytes: this.lru?.calculatedSize ?? 0,
      inFlight: this.inFlight.size,
    };
  }

  async get(key: string, load: () => Promise<V>): Promise<CacheResult<V>> {
    const cached = this.lru?.get(key);
    if (cached) {
      this.hits++;
      return { value: cached, hit: true };
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      this.hits++;
      return { value: await pending, hit: true };
    }

    this.misses++;
    const promise = load()
      .then((value) => {
        this.lru?.set(key, value);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return { value: await promise, hit: false };
  }
}
