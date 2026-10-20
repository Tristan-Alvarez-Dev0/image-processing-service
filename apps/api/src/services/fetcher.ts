import { AppError } from '../errors/app-error.js';

export interface FetchedSource {
  body: Buffer;
  contentType: string | undefined;
}

export interface FetchOptions {
  timeoutMs: number;
  /** Many hosts (e.g. Wikimedia) reject requests without a User-Agent. */
  userAgent: string;
}

export type SourceFetcher = (url: string) => Promise<FetchedSource>;

/**
 * Downloads a remote resource into memory.
 */
export function createFetcher(opts: FetchOptions): SourceFetcher {
  return async (url) => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': opts.userAgent, Accept: 'image/*,*/*;q=0.8' },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new AppError(
          504,
          'UPSTREAM_TIMEOUT',
          `Source did not respond within ${opts.timeoutMs}ms`,
        );
      }
      throw new AppError(502, 'UPSTREAM_ERROR', 'Could not connect to the source URL');
    }

    if (res.status === 404) {
      throw new AppError(404, 'SOURCE_NOT_FOUND', 'The source URL returned 404 Not Found');
    }
    if (!res.ok) {
      throw new AppError(502, 'UPSTREAM_ERROR', `The source URL returned HTTP ${res.status}`);
    }

    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? undefined,
    };
  };
}
