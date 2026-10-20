import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export interface CacheStatsSource {
  readonly stats: { entries: number; bytes: number };
}

export interface JobStatsSource {
  readonly stats: { active: number; waiting: number };
}

/**
 * Prometheus metrics for one app instance. Each instance owns its registry,
 * so tests can build many apps without metrics leaking between them.
 *
 * Cache hit rate and error rate are derived in PromQL, e.g.
 *   sum(rate(ips_cache_lookups_total{result="hit"}[5m])) / sum(rate(ips_cache_lookups_total[5m]))
 *   sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
 */
export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const registers = [registry];

  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by route template, method and status code',
    labelNames: ['route', 'method', 'status_code'] as const,
    registers,
  });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Time to respond, by route template and method',
    labelNames: ['route', 'method'] as const,
    // From cache hits (~1 ms) to cold video thumbnails (seconds).
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers,
  });

  const errors = new Counter({
    name: 'ips_errors_total',
    help: 'Error responses by error code',
    labelNames: ['code'] as const,
    registers,
  });

  const cacheLookups = new Counter({
    name: 'ips_cache_lookups_total',
    help: 'Cache lookups by cache and result (hit includes sharing an in-flight load)',
    labelNames: ['cache', 'result'] as const,
    registers,
  });

  const upstreamDuration = new Histogram({
    name: 'ips_upstream_fetch_duration_seconds',
    help: 'Time to download a source, by outcome',
    labelNames: ['outcome'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers,
  });

  const processingDuration = new Histogram({
    name: 'ips_processing_duration_seconds',
    help: 'Time spent transforming, by kind (image or video)',
    labelNames: ['kind'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15],
    registers,
  });

  return {
    registry,
    httpRequests,
    httpDuration,
    errors,
    cacheLookups,
    upstreamDuration,
    processingDuration,

    /** Gauges sampled from live state each time /metrics is scraped. */
    trackState(caches: Record<string, CacheStatsSource>, limiter: JobStatsSource) {
      const cacheGauge = (name: string, help: string, pick: (s: CacheStatsSource) => number) =>
        new Gauge({
          name,
          help,
          labelNames: ['cache'] as const,
          registers,
          collect() {
            for (const [cache, source] of Object.entries(caches)) this.set({ cache }, pick(source));
          },
        });
      cacheGauge('ips_cache_entries', 'Entries currently cached', (c) => c.stats.entries);
      cacheGauge('ips_cache_bytes', 'Bytes currently cached', (c) => c.stats.bytes);

      new Gauge({
        name: 'ips_jobs',
        help: 'Processing jobs by state: running, or waiting for a free slot',
        labelNames: ['state'] as const,
        registers,
        collect() {
          this.set({ state: 'active' }, limiter.stats.active);
          this.set({ state: 'waiting' }, limiter.stats.waiting);
        },
      });
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
