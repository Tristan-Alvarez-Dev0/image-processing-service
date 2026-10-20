/**
 * An expected, client-facing error. `statusCode` is picked up by Fastify's
 * error handling; `code` is a stable machine-readable identifier.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly param?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
