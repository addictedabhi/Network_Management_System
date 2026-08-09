import type { ErrorRequestHandler, RequestHandler } from 'express';
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

/**
 * Terminal 404 handler (finding H-5).
 *
 * Must be a PLAIN RequestHandler, not an ErrorRequestHandler: it runs when no route matched
 * and no error was raised. The previous 4-argument `ErrorRequestHandler` signature that called
 * `next()` was doubly inert — Express only invokes 4-arg middleware on the error path, and it
 * forwarded rather than responding. Unmatched routes therefore fell through to Express's
 * default HTML page, bypassing the JSON envelope and advertising the framework.
 *
 * Mounted AFTER all routers and BEFORE the error handler.
 */
export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiFailure = {
    success: false,
    errors: [{ code: 'NOT_FOUND', message: 'The requested resource was not found.' }],
    meta: { requestId: String(res.locals.correlationId ?? 'unknown') }
  };
  res.status(404).json(body);
};

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
