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
 * Framework-level client errors we recognise and re-classify (test finding 1).
 *
 * Express's body parser throws errors that already carry a correct HTTP status
 * (`PayloadTooLargeError.status = 413`, `entity.parse.failed` = 400, an unsupported charset
 * = 415). Answering all of them `500 INTERNAL_ERROR` was wrong twice over: it told a client
 * its own malformed request was a server fault — inviting a retry that can never succeed —
 * and it logged at ERROR, so any unauthenticated caller sending bad JSON could inflate the
 * ERROR-rate signal that alerting is built on.
 *
 * This is an ALLOWLIST keyed on body-parser's stable `type` discriminator, deliberately NOT a
 * blanket "trust any `status` property". Trusting an arbitrary `status`/`statusCode` would let
 * any upstream client library (or an attacker-influenced error object) choose our response
 * status, and would silently downgrade genuine server faults to 4xx so they stop being paged.
 * Unrecognised errors keep the 500 INTERNAL_ERROR path — fail CLOSED.
 *
 * Only the CODE and STATUS come from the error; the message is a fixed string per entry, so no
 * framework text, offset, stack, or internal path can reach the wire.
 */
const FRAMEWORK_CLIENT_ERRORS: Readonly<
  Record<string, { readonly status: number; readonly code: ErrorCode; readonly message: string }>
> = {
  'entity.too.large': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request body exceeds the maximum allowed size.'
  },
  'entity.parse.failed': {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Request body is not valid JSON.'
  },
  'entity.verify.failed': {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Request body failed verification.'
  },
  'request.aborted': {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Request was aborted before the body was received.'
  },
  'request.size.invalid': {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Request body size did not match the Content-Length header.'
  },
  'parameters.too.many': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request contains too many parameters.'
  },
  'charset.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Request charset is not supported.'
  },
  'encoding.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Request content encoding is not supported.'
  }
};

/**
 * Classifies a thrown value as a recognised framework client error, or `undefined`.
 *
 * Both guards must hold: the `type` must be allowlisted AND the error's own status must still
 * be a 4xx. A 5xx wearing a known `type` is treated as unknown, so it keeps ERROR-level logging
 * and the opaque 500 response.
 */
function classifyFrameworkError(
  err: unknown
): { readonly status: number; readonly code: ErrorCode; readonly message: string } | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof candidate.type !== 'string') return undefined;
  const mapped = FRAMEWORK_CLIENT_ERRORS[candidate.type];
  if (mapped === undefined) return undefined;
  const rawStatus = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  if (typeof rawStatus !== 'number' || rawStatus < 400 || rawStatus > 499) return undefined;
  return mapped;
}

/**
 * Centralized error boundary. Known `AppError`s map to their declared status and code;
 * recognised framework client errors map to their own 4xx (see `FRAMEWORK_CLIENT_ERRORS`);
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
    const framework = classifyFrameworkError(err);
    if (framework !== undefined) {
      const body: ApiFailure = {
        success: false,
        errors: [{ code: framework.code, message: framework.message }],
        meta: { requestId }
      };
      // A client sending a bad body is not a server fault, so this must NOT be ERROR — it would
      // pollute the alerting signal. WARN keeps it visible on a dashboard without paging.
      logger.warn('request rejected by body parser', {
        requestId,
        code: framework.code,
        status: framework.status
      });
      res.status(framework.status).json(body);
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
