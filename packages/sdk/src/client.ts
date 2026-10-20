import { ImageApiError, type ErrorDetail } from './errors.js';
import type {
  HealthStatus,
  ImageResult,
  ProcessOptions,
  SourceInfo,
  VideoThumbnailOptions,
} from './types.js';
import { buildQuery, joinUrl } from './url.js';

export interface RetryOptions {
  /** Extra attempts after the first. Default 2. */
  retries?: number;
  /** First backoff delay; doubles each attempt, with jitter. Default 300 ms. */
  baseDelayMs?: number;
  /** Never wait longer than this; a longer Retry-After fails immediately. Default 10 s. */
  maxDelayMs?: number;
}

export interface ClientOptions {
  /** Where the API lives, e.g. `https://images.example.com`. Use `''` for the same origin. */
  baseUrl: string;
  /** Per-attempt timeout. Default 30 s. */
  timeoutMs?: number;
  /** `false` disables retries. */
  retry?: RetryOptions | false;
  /** Custom fetch, e.g. for testing or older runtimes. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /**
   * Accept header, which only matters for `format: 'auto'`. Defaults to
   * advertising AVIF and WebP, which current browsers and Node can handle.
   */
  accept?: string;
}

const DEFAULT_ACCEPT = 'image/avif,image/webp,image/*;q=0.8,*/*;q=0.5';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

const intHeader = (headers: Headers, name: string) => {
  const value = headers.get(name);
  return value === null || value === '' ? undefined : Number(value);
};

/**
 * Client for the Image Processing Service.
 *
 * ```ts
 * const images = new ImageClient({ baseUrl: 'https://images.example.com' });
 * img.src = images.buildUrl({ url: photoUrl, width: 400, format: 'auto' });
 * const { blob, width, height } = await images.process({ url: photoUrl, width: 400 });
 * ```
 */
export class ImageClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryOptions>;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: ClientOptions) {
    if (typeof options?.baseUrl !== 'string') throw new TypeError('`baseUrl` is required');
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retry =
      options.retry === false
        ? { retries: 0, baseDelayMs: 0, maxDelayMs: 0 }
        : { retries: 2, baseDelayMs: 300, maxDelayMs: 10_000, ...options.retry };
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
  }

  /** The URL for an image transformation. Pure: no network. Ideal for `<img src>`. */
  buildUrl(options: ProcessOptions): string {
    return `${joinUrl(this.baseUrl, '/process')}?${buildQuery(options)}`;
  }

  /** The URL for a video thumbnail. Pure: no network. */
  videoThumbnailUrl(options: VideoThumbnailOptions): string {
    return `${joinUrl(this.baseUrl, '/video/thumbnail')}?${buildQuery(options)}`;
  }

  /** Fetches a transformed image with its metadata. Throws ImageApiError on failure. */
  process(options: ProcessOptions, request: RequestOptions = {}): Promise<ImageResult> {
    return this.fetchImage(this.buildUrl(options), options.format === 'auto', request);
  }

  /** Fetches a video thumbnail with its metadata. Throws ImageApiError on failure. */
  videoThumbnail(
    options: VideoThumbnailOptions,
    request: RequestOptions = {},
  ): Promise<ImageResult> {
    return this.fetchImage(this.videoThumbnailUrl(options), options.format === 'auto', request);
  }

  async health(request: RequestOptions = {}): Promise<HealthStatus> {
    const res = await this.send(joinUrl(this.baseUrl, '/health'), {}, request.signal);
    return (await res.json()) as HealthStatus;
  }

  private async fetchImage(
    url: string,
    negotiated: boolean,
    request: RequestOptions,
  ): Promise<ImageResult> {
    const headers: Record<string, string> = negotiated
      ? { accept: request.accept ?? DEFAULT_ACCEPT }
      : {};
    const res = await this.send(url, headers, request.signal);
    const blob = await res.blob();
    const h = res.headers;
    const duration = h.get('x-original-duration');
    const original: SourceInfo = {
      width: intHeader(h, 'x-original-width') ?? 0,
      height: intHeader(h, 'x-original-height') ?? 0,
      format: h.get('x-original-format') ?? 'unknown',
      size: intHeader(h, 'x-original-size') ?? 0,
      ...(duration !== null && { duration: Number(duration) }),
    };
    const cache = h.get('x-cache');
    return {
      blob,
      contentType: h.get('content-type') ?? blob.type,
      width: intHeader(h, 'x-output-width') ?? 0,
      height: intHeader(h, 'x-output-height') ?? 0,
      size: blob.size,
      original,
      cache: cache === 'HIT' || cache === 'MISS' ? cache : undefined,
      etag: h.get('etag') ?? undefined,
      requestId: h.get('x-request-id') ?? undefined,
      url,
    };
  }

  /** GET with timeout, retries and typed errors. Returns only 2xx responses. */
  private async send(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(url, headers, signal);
      } catch (err) {
        if (!(err instanceof ImageApiError) || !err.retryable || attempt >= this.retry.retries) {
          throw err;
        }
        const backoff = this.retry.baseDelayMs * 2 ** attempt * (0.5 + Math.random() / 2);
        const delay = err.retryAfter !== undefined ? err.retryAfter * 1000 : backoff;
        // Don't block the caller for longer than they agreed to wait.
        if (delay > this.retry.maxDelayMs) throw err;
        await sleep(delay, signal);
      }
    }
  }

  private async attempt(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { ...this.headers, ...headers },
        signal: combined,
      });
    } catch (err) {
      // The caller's own abort is not an API error: rethrow it untouched.
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted) {
        throw new ImageApiError({
          code: 'TIMEOUT',
          status: 0,
          message: `No response within ${this.timeoutMs} ms`,
          cause: err,
        });
      }
      throw new ImageApiError({
        code: 'NETWORK_ERROR',
        status: 0,
        message: `Could not reach the image service: ${(err as Error).message}`,
        cause: err,
      });
    }

    if (res.ok) return res;
    throw await toApiError(res);
  }
}

async function toApiError(res: Response): Promise<ImageApiError> {
  const retryAfter = intHeader(res.headers, 'retry-after');
  const requestId = res.headers.get('x-request-id') ?? undefined;
  try {
    const body = (await res.json()) as {
      error?: {
        code?: string;
        message?: string;
        param?: string;
        details?: ErrorDetail[];
        requestId?: string;
      };
    };
    if (body?.error?.code && body.error.message) {
      return new ImageApiError({
        code: body.error.code as ImageApiError['code'],
        message: body.error.message,
        status: res.status,
        param: body.error.param,
        details: body.error.details,
        requestId: body.error.requestId ?? requestId,
        retryAfter,
      });
    }
  } catch {
    // Not JSON: fall through.
  }
  return new ImageApiError({
    code: 'INVALID_RESPONSE',
    message: `Unexpected HTTP ${res.status} response from the image service`,
    status: res.status,
    requestId,
    retryAfter,
  });
}
