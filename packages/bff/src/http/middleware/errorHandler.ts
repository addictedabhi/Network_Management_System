import type { ErrorRequestHandler } from 'express';
import type { ApiFailure, ErrorCode } from '@nms/shared';
import type { Logger } from '../../observability/logger.js';

/** Application error carrying a machine-readable code and an HTTP status. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly field?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundHandler: ErrorRequestHandler = (_err, _req, _res, next) => next();

/**
 * Centralized error boundary. Known `AppError`s map to their declared status and code;
 * anything else is logged server-side and answered with a safe summary — never a stack
 * trace, internal path, or upstream error body.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const requestId = String(res.locals.correlationId ?? 'unknown');
    if (err instanceof AppError) {
      const body: ApiFailure = {
        success: false,
        errors: [{ code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) }],
        meta: { requestId }
      };
      if (err.status >= 500) logger.error('request failed', { requestId, code: err.code });
      else logger.info('request rejected', { requestId, code: err.code });
      res.status(err.status).json(body);
      return;
    }
    // Unknown errors: log server-side, return a safe summary (no stack, no internals).
    logger.error('unhandled error', { requestId, name: (err as Error)?.name });
    const body: ApiFailure = {
      success: false,
      errors: [{ code: 'INTERNAL_ERROR', message: 'An internal error occurred.' }],
      meta: { requestId }
    };
    res.status(500).json(body);
  };
}
