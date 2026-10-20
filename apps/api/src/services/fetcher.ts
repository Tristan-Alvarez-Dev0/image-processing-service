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
const NETWORK_ERRORS: Record<string, string> = {
  ENOTFOUND: 'Could not resolve the host name of the source URL',
  EAI_AGAIN: 'Could not resolve the host name of the source URL',
  ECONNREFUSED: 'The source host refused the connection',
  ECONNRESET: 'The source host closed the connection unexpectedly',
  EHOSTUNREACH: 'The source host is unreachable',
  CERT_HAS_EXPIRED: 'The source host has an expired TLS certificate',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The source host has a self-signed TLS certificate',
};

function networkErrorMessage(err: unknown): string {
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  return (code && NETWORK_ERRORS[code]) ?? 'Could not connect to the source URL';
}

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
          'UPSTREAM_TIMEOUT',
          `The source URL did not respond within ${opts.timeoutMs / 1000}s`,
        );
      }
      throw new AppError('UPSTREAM_ERROR', networkErrorMessage(err));
    }

    if (res.status === 404 || res.status === 410) {
      throw new AppError('SOURCE_NOT_FOUND', `The source URL returned HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new AppError('UPSTREAM_ERROR', `The source URL returned HTTP ${res.status}`);
    }

    try {
      return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new AppError(
          'UPSTREAM_TIMEOUT',
          `The source URL did not finish sending within ${opts.timeoutMs / 1000}s`,
        );
      }
      throw new AppError('UPSTREAM_ERROR', 'The connection to the source URL was interrupted');
    }
  };
}
