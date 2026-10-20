export const API_ERROR_CODES = [
  'INVALID_PARAMETER',
  'MISSING_PARAMETER',
  'INVALID_URL',
  'UNAUTHORIZED',
  'FORBIDDEN_HOST',
  'NOT_FOUND',
  'SOURCE_NOT_FOUND',
  'SOURCE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_IMAGE',
  'UNPROCESSABLE_VIDEO',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export type ErrorCode = ApiErrorCode | ClientErrorCode;

export interface ErrorDetail {
  param: string;
  message: string;
}

export class ImageApiError extends Error {
  override readonly name = 'ImageApiError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly param: string | undefined;
  readonly details: ErrorDetail[] | undefined;
  readonly requestId: string | undefined;
  readonly retryAfter: number | undefined;

  constructor(init: {
    code: ErrorCode;
    message: string;
    status: number;
    param?: string | undefined;
    details?: ErrorDetail[] | undefined;
    requestId?: string | undefined;
    retryAfter?: number | undefined;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.code = init.code;
    this.status = init.status;
    this.param = init.param;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
  }

  get retryable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      this.status === 429 ||
      this.status === 502 ||
      this.status === 503 ||
      this.status === 504
    );
  }
}

export function isImageApiError(err: unknown): err is ImageApiError {
  return (
    err instanceof ImageApiError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'ImageApiError')
  );
}
