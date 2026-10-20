import { Agent, request, type Dispatcher } from 'undici';
import { AppError } from '../errors/app-error.js';
import type { AddressPolicy } from '../security/address-policy.js';
import {
  assertFetchableUrl,
  BlockedAddressError,
  createGuardedLookup,
  type Resolver,
} from '../security/target-policy.js';

export interface FetchedSource {
  body: Buffer;
  contentType: string | undefined;
}

export interface FetchOptions {
  /** Total budget for the whole fetch, including redirects and body download. */
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  addresses: AddressPolicy;
  allowedPorts: ReadonlySet<number> | '*';
  /** Many hosts (e.g. Wikimedia) reject requests without a User-Agent. */
  userAgent: string;
  /** Override DNS resolution (tests only). */
  resolve?: Resolver;
}

export interface FetchCallOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

export type SourceFetcher = (url: string, callOpts?: FetchCallOptions) => Promise<FetchedSource>;

export interface Fetcher {
  fetch: SourceFetcher;
  close: () => Promise<void>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const NETWORK_ERRORS: Record<string, string> = {
  ENOTFOUND: 'Could not resolve the host name of the source URL',
  EAI_AGAIN: 'Could not resolve the host name of the source URL',
  ECONNREFUSED: 'The source host refused the connection',
  ECONNRESET: 'The source host closed the connection unexpectedly',
  EHOSTUNREACH: 'The source host is unreachable',
  UND_ERR_CONNECT_TIMEOUT: 'Timed out connecting to the source host',
  UND_ERR_SOCKET: 'The source host closed the connection unexpectedly',
  CERT_HAS_EXPIRED: 'The source host has an expired TLS certificate',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The source host has a self-signed TLS certificate',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The TLS certificate of the source host does not match its name',
};

const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${Math.round((n / 1024 / 1024) * 10) / 10} MB` : `${Math.ceil(n / 1024)} KB`;

function findCause<T>(err: unknown, pick: (e: unknown) => T | undefined): T | undefined {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const hit = pick(e);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** How far a download got, so a timeout can say what happened. */
interface Progress {
  received: number;
  expected: number | undefined;
  downloading: boolean;
}

function toAppError(
  err: unknown,
  timedOut: boolean,
  timeoutMs: number,
  progress: Progress,
): AppError {
  if (err instanceof AppError) return err;

  const blocked = findCause(err, (e) => (e instanceof BlockedAddressError ? e : undefined));
  if (blocked) {
    return new AppError(
      'FORBIDDEN_HOST',
      `The source host ${blocked.hostname} resolves to a private or reserved IP address, which is not allowed`,
    );
  }

  if (timedOut) {
    if (progress.downloading) {
      const of = progress.expected ? ` of ${formatBytes(progress.expected)}` : '';
      return new AppError(
        'UPSTREAM_TIMEOUT',
        `The source started sending but did not finish within ${timeoutMs / 1000}s (received ${formatBytes(progress.received)}${of}); it is too slow or too large`,
      );
    }
    return new AppError(
      'UPSTREAM_TIMEOUT',
      `The source URL did not respond within ${timeoutMs / 1000}s`,
    );
  }

  const code = findCause(err, (e) => {
    const c = (e as { code?: unknown }).code;
    return typeof c === 'string' && c in NETWORK_ERRORS ? c : undefined;
  });
  return new AppError(
    'UPSTREAM_ERROR',
    (code && NETWORK_ERRORS[code]) ?? 'Could not connect to the source URL',
  );
}

type Body = Dispatcher.ResponseData['body'];

/** undici emits an AbortError on destroy; left unhandled it would crash the process. */
function discard(body: Body): void {
  body.on('error', () => {});
  body.destroy();
}

async function readLimited(body: Body, maxBytes: number, progress: Progress) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += (chunk as Buffer).length;
    progress.received = size;
    if (size > maxBytes) {
      discard(body);
      throw new AppError(
        'SOURCE_TOO_LARGE',
        `The source is larger than the ${formatBytes(maxBytes)} limit`,
      );
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks, size);
}

/**
 * Fetches untrusted URLs: every redirect hop is re-validated, DNS is checked on
 * the connection itself, and one deadline and size cap cover the whole download.
 */
export function createFetcher(opts: FetchOptions): Fetcher {
  const agent = new Agent({
    connect: {
      lookup: createGuardedLookup(opts.addresses, opts.resolve),
      timeout: opts.timeoutMs,
    },
    keepAliveTimeout: 10_000,
  });
  const policy = { addresses: opts.addresses, allowedPorts: opts.allowedPorts };

  const fetchSource: SourceFetcher = async (rawUrl, callOpts) => {
    const maxBytes = callOpts?.maxBytes ?? opts.maxBytes;
    const timeoutMs = callOpts?.timeoutMs ?? opts.timeoutMs;
    const signal = AbortSignal.timeout(timeoutMs);
    const progress: Progress = { received: 0, expected: undefined, downloading: false };
    let url = new URL(rawUrl);

    try {
      for (let hop = 0; ; hop++) {
        assertFetchableUrl(url, policy, hop);

        const res = await request(url, {
          dispatcher: agent,
          method: 'GET',
          headers: { 'user-agent': opts.userAgent, accept: 'image/*,*/*;q=0.8' },
          signal,
        });

        if (REDIRECT_STATUSES.has(res.statusCode)) {
          await res.body.dump();
          const location = res.headers.location;
          if (typeof location !== 'string' || !location) {
            throw new AppError('UPSTREAM_ERROR', 'The source URL redirected without a Location');
          }
          if (hop >= opts.maxRedirects) {
            throw new AppError(
              'UPSTREAM_ERROR',
              `The source URL redirected more than ${opts.maxRedirects} times`,
            );
          }
          url = new URL(location, url);
          continue;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          await res.body.dump();
          const code =
            res.statusCode === 404 || res.statusCode === 410
              ? 'SOURCE_NOT_FOUND'
              : 'UPSTREAM_ERROR';
          throw new AppError(code, `The source URL returned HTTP ${res.statusCode}`);
        }

        // Fail fast on an honest Content-Length; readLimited catches dishonest ones.
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          discard(res.body);
          throw new AppError(
            'SOURCE_TOO_LARGE',
            `The source is ${formatBytes(declared)}, over the ${formatBytes(maxBytes)} limit`,
          );
        }

        progress.downloading = true;
        progress.expected = Number.isFinite(declared) ? declared : undefined;
        const contentType = res.headers['content-type'];
        return {
          body: await readLimited(res.body, maxBytes, progress),
          contentType: typeof contentType === 'string' ? contentType : undefined,
        };
      }
    } catch (err) {
      throw toAppError(err, signal.aborted, timeoutMs, progress);
    }
  };

  return { fetch: fetchSource, close: () => agent.close() };
}
