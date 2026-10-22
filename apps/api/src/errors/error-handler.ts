import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type ErrorCode, type ErrorDetail } from './app-error.js';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    param?: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

function send(reply: FastifyReply, request: FastifyRequest, err: AppError) {
  request.errorCode = err.code;
  const body: ErrorBody = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.param && { param: err.param }),
      ...(err.details && err.details.length > 1 && { details: err.details }),
      requestId: request.id,
    },
  };
  // Errors must never be cached by browsers or CDNs; the next attempt may succeed.
  return reply.status(err.statusCode).header('Cache-Control', 'no-store').send(body);
}

function fromFastifyError(err: FastifyError): AppError | undefined {
  const status = err.statusCode ?? 500;
  if (status >= 500) return undefined;
  if (status === 404) return new AppError('NOT_FOUND', err.message);
  return new AppError('INVALID_PARAMETER', err.message);
}

/** One error shape everywhere; unexpected errors are logged but never leaked to clients. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler<FastifyError>((err, request, reply) => {
    const appError = err instanceof AppError ? err : fromFastifyError(err);
    if (appError) return send(reply, request, appError);

    request.log.error({ err }, 'unhandled error');
    return send(
      reply,
      request,
      new AppError('INTERNAL_ERROR', 'Something went wrong on our side. Please try again later.'),
    );
  });

  app.setNotFoundHandler((request, reply) =>
    send(
      reply,
      request,
      new AppError(
        'NOT_FOUND',
        `Route ${request.method} ${request.url.split('?')[0]} does not exist. See /docs for available endpoints.`,
      ),
    ),
  );
}
