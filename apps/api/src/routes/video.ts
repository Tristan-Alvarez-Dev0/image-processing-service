import type { FastifyPluginAsync } from 'fastify';
import { createVideoQuerySchema } from '../schemas/process.js';
import { parseQuery } from '../schemas/validate.js';
import type { LoadingCache } from '../services/cache.js';
import type { SourceFetcher } from '../services/fetcher.js';
import { parseAccept } from '../services/format-negotiation.js';
import { cacheKey, etagFor } from '../services/http-cache.js';
import { transformImage, type ImageLimits, type TransformResult } from '../services/image.js';
import type { ConcurrencyLimiter } from '../services/limiter.js';
import type { Metrics } from '../observability/metrics.js';
import { extractFrame, type ExtractedFrame, type VideoLimits } from '../services/video.js';
import { sendImage, type ProcessedImage } from './image-response.js';

export interface VideoRouteOptions {
  fetchSource: SourceFetcher;
  limiter: ConcurrencyLimiter;
  resultCache: LoadingCache<ProcessedImage>;
  maxDimension: number;
  maxSourceBytes: number;
  imageLimits: ImageLimits;
  videoLimits: VideoLimits;
  httpMaxAgeSeconds: number;
  /** Per-route rate limit, stricter than the global one (null when rate limiting is off). */
  rateLimit: { max: number; timeWindow: number } | null;
  metrics: Metrics;
}

export const videoRoutes: FastifyPluginAsync<VideoRouteOptions> = async (app, opts) => {
  const schema = createVideoQuerySchema({ maxDimension: opts.maxDimension });

  app.get(
    '/video/thumbnail',
    { config: opts.rateLimit ? { rateLimit: opts.rateLimit } : {} },
    async (request, reply) => {
      const query = parseQuery(schema, request.query);
      const negotiated = query.format === 'auto';
      const params = {
        ...query,
        url: new URL(query.url).href,
        // A video frame has no "source format" worth keeping, so default to JPEG.
        format: query.format ?? 'jpeg',
        accept: negotiated ? parseAccept(request.headers.accept) : undefined,
      };

      const { value, hit } = await opts.resultCache.get(cacheKey('video', params), async () => {
        // Videos skip the source cache: they are large, and results are cached anyway.
        const source = await opts.fetchSource(params.url, { maxBytes: opts.maxSourceBytes });
        return opts.limiter.run(async () => {
          const end = opts.metrics.processingDuration.startTimer({ kind: 'video' });
          let frame: ExtractedFrame;
          let transformed: TransformResult;
          try {
            frame = await extractFrame(source.body, params.time, opts.videoLimits);
            transformed = await transformImage(frame.png, params, opts.imageLimits);
          } finally {
            end();
          }
          const extraHeaders: Record<string, string> = {};
          if (frame.durationSeconds !== undefined) {
            extraHeaders['X-Original-Duration'] = frame.durationSeconds.toFixed(3);
          }
          return {
            ...transformed,
            // Report the video, not the intermediate PNG frame.
            original: {
              ...transformed.original,
              format: frame.container,
              size: source.body.length,
            },
            etag: etagFor(transformed.data),
            extraHeaders,
          };
        });
      });

      return sendImage(request, reply, value, {
        hit,
        negotiated,
        httpMaxAgeSeconds: opts.httpMaxAgeSeconds,
      });
    },
  );
};
