import type { FastifyReply, FastifyRequest } from 'fastify';
import { ifNoneMatchHits } from '../services/http-cache.js';
import type { TransformResult } from '../services/image.js';

export type ProcessedImage = TransformResult & {
  etag: string;
  /** Extra source details, e.g. the duration of a video. */
  extraHeaders?: Record<string, string | number>;
};

export interface ImageResponseOptions {
  hit: boolean;
  httpMaxAgeSeconds: number;
  /** True for format=auto: the bytes depend on the Accept header. */
  negotiated: boolean;
}

/** Sends a processed image with caching headers, honouring If-None-Match. */
export function sendImage(
  request: FastifyRequest,
  reply: FastifyReply,
  result: ProcessedImage,
  opts: ImageResponseOptions,
) {
  // Tell caches that the same URL yields different bytes per Accept header.
  if (opts.negotiated) reply.header('Vary', 'Accept');
  reply
    .header('Cache-Control', `public, max-age=${opts.httpMaxAgeSeconds}`)
    .header('ETag', result.etag)
    .header('X-Cache', opts.hit ? 'HIT' : 'MISS');

  if (ifNoneMatchHits(request.headers['if-none-match'], result.etag)) {
    return reply.code(304).send();
  }

  reply
    .header('Content-Type', `image/${result.output.format}`)
    .header('Content-Length', result.data.length)
    .header('Content-Disposition', `inline; filename="image.${result.output.format}"`)
    .header('X-Original-Width', result.original.width)
    .header('X-Original-Height', result.original.height)
    .header('X-Original-Format', result.original.format)
    .header('X-Original-Size', result.original.size);
  for (const [name, value] of Object.entries(result.extraHeaders ?? {})) reply.header(name, value);
  return reply.send(result.data);
}
