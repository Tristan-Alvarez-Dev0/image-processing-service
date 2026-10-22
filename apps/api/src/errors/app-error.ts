export const ERROR_CODES = {
  INVALID_PARAMETER: 400,
  MISSING_PARAMETER: 400,
  INVALID_URL: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN_HOST: 403,
  NOT_FOUND: 404,
  SOURCE_NOT_FOUND: 404,
  SOURCE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_IMAGE: 422,
  UNPROCESSABLE_VIDEO: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorDetail {
  param: string;
  message: string;
}

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly param?: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = ERROR_CODES[code];
  }
}
