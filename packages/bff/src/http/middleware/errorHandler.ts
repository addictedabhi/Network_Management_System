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
 *
 * PROTOTYPE SAFETY (test finding 4). The table is a `Map`, NOT an object literal. As an object
 * literal it inherited from `Object.prototype`, so a `type` of `'constructor'`, `'toString'`,
 * `'__proto__'`, `'valueOf'`, `'hasOwnProperty'` (and every other inherited member) resolved to
 * an inherited function instead of `undefined`. That bypassed the `mapped === undefined`
 * fail-closed guard entirely and fed `res.status(undefined)`, which threw INSIDE the error
 * handler — so Express's default handler answered with an HTML stack trace and absolute
 * filesystem paths, defeating the whole no-leak guarantee.
 *
 * A `Map` was chosen over the two alternatives because it makes the failure UNREPRESENTABLE
 * rather than merely guarded: `Map.prototype.get` consults only own entries, by specification,
 * with no prototype chain to reach. `Object.create(null)` closes the same hole but is one
 * refactor away from silently reopening — any future edit that writes it back as a literal
 * (`= { ... }`), spreads it, or clones it with `{ ...table }` restores the prototype and nothing
 * fails loudly. An `Object.hasOwn()` guard is weaker still: it leaves the unsafe lookup in place
 * and relies on a caller remembering to check, which is exactly the vigilance this codebase has
 * already lost five times. With a `Map`, forgetting the safety is a type error, not a silent
 * regression: there is no index-access syntax to reach for.
 */
const FRAMEWORK_CLIENT_ERRORS: ReadonlyMap<
  string,
  { readonly status: number; readonly code: ErrorCode; readonly message: string }
> = new Map(
  Object.entries({
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
    'querystring.parse.rangeError': {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request query string is not valid.'
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
  } as const)
);

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
  // `Map.get` consults own entries only — no prototype chain to walk (finding 4).
  const mapped = FRAMEWORK_CLIENT_ERRORS.get(candidate.type);
  if (mapped === undefined) return undefined;
  const rawStatus = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  if (typeof rawStatus !== 'number' || rawStatus < 400 || rawStatus > 499) return undefined;
  return mapped;
}

/**
 * Last-resort response written when the normal envelope path itself fails (test finding 4).
 *
 * Dependency-free and built from string literals plus a PRE-VALIDATED UUID only — no logger, no
 * serializer, no value taken from the error. It exists so a throw inside the error handler can
 * never escape to Express's default handler, which answers an HTML page carrying a stack trace and
 * absolute filesystem paths. An error boundary that can crash is not a boundary.
 *
 * "Dependency-free" must not mean "silent" (test finding 5): it also emits one best-effort record
 * on raw stderr, independently contained, so a fault whose log write failed is still recorded
 * somewhere. See `writeLastResortRecord`.
 */
const FALLBACK_BODY_PREFIX =
  '{"success":false,"errors":[{"code":"INTERNAL_ERROR",' +
  '"message":"An internal error occurred."}],"meta":{"requestId":"';
const FALLBACK_BODY_SUFFIX = '"}}';
const UNKNOWN_REQUEST_ID = 'unknown';

/**
 * A correlation id is only carried into the fallback if it matches this EXACTLY (test finding 5).
 *
 * `res.locals.correlationId` is server-generated (`correlationId.ts` assigns `randomUUID()`
 * unconditionally, and a client header is stored separately), so in practice it is always a UUID.
 * The pattern is nevertheless applied at fault time because the fallback must be safe even when
 * `res.locals` has been corrupted by whatever is already going wrong: a pre-validated UUID is
 * JSON-safe and header-safe by construction, so the body can be built by plain string
 * concatenation with NO serialization, escaping, or `String()` coercion — the operations that
 * could themselves throw. Anything else degrades to the constant.
 */
const PREVALIDATED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads the correlation id and returns it ONLY if it is a pre-validated UUID string.
 *
 * `typeof` cannot throw, and `RegExp.test` on a primitive string cannot throw. The property read
 * itself is the sole operation that could (an exotic getter), so it is contained — this function
 * is total and returns the constant on every unhappy path.
 */
function prevalidatedRequestId(res: Parameters<ErrorRequestHandler>[2]): string {
  try {
    const raw: unknown = res.locals?.correlationId;
    if (typeof raw === 'string' && PREVALIDATED_UUID.test(raw)) return raw;
  } catch {
    /* fall through to the constant */
  }
  return UNKNOWN_REQUEST_ID;
}

/**
 * Best-effort last-resort record of a double fault (test finding 5).
 *
 * The fallback used to write NOTHING, which made a real incident invisible: a genuine 500-class
 * fault whose `logger.error` call threw (EPIPE on stdout — routine for a container whose log pipe
 * closes) produced a correct, safe 500 while the ERROR rate stayed flat. A leak is visible; this
 * was not, which is worse operationally.
 *
 * It deliberately does NOT go through the logger — the logger is what may have just failed — and
 * it cannot throw or recurse:
 *  - the line is a concatenation of module-level literals plus a pre-validated UUID; there is no
 *    serializer, no value from the error, and nothing derived from client input;
 *  - the raw `process.stderr.write` is wrapped in its own `try/catch`, so a second EPIPE is
 *    swallowed rather than propagated;
 *  - it calls nothing that can re-enter the error handler, so no recursion is possible.
 */
function writeLastResortRecord(requestId: string): void {
  try {
    process.stderr.write(
      '{"level":"ERROR","service":"bff","message":"error-handler double fault",' +
        '"context":{"requestId":"' +
        requestId +
        '"}}\n'
    );
  } catch {
    // stderr is gone too. There is no further channel and re-throwing would defeat the boundary.
  }
}

function writeMinimalFallback(res: Parameters<ErrorRequestHandler>[2]): void {
  const requestId = prevalidatedRequestId(res);
  writeLastResortRecord(requestId);
  try {
    if (res.headersSent) {
      // The status line and headers are already on the wire; appending a second body would
      // corrupt the response. End the stream instead.
      res.end();
      return;
    }
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(FALLBACK_BODY_PREFIX + requestId + FALLBACK_BODY_SUFFIX);
  } catch {
    // Nothing further is safe or useful. Destroy the socket rather than re-throw into Express.
    try {
      res.destroy();
    } catch {
      /* the connection is already gone */
    }
  }
}

/**
 * Centralized error boundary. Known `AppError`s map to their declared status and code;
 * recognised framework client errors map to their own 4xx (see `FRAMEWORK_CLIENT_ERRORS`);
 * anything else is logged server-side and answered with a safe summary — never a stack
 * trace, internal path, or upstream error body.
 *
 * DOUBLE-FAULT GUARD (test finding 4). The whole classification path runs inside a try/catch and
 * an already-committed response is detected before any write, so no throw originating in this
 * handler can reach Express's default handler — which would answer HTML carrying a stack trace
 * and absolute filesystem paths. An error boundary that can itself crash is not a boundary.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    try {
      handleError(logger, err, res);
    } catch {
      // DOUBLE FAULT: the handler itself threw. Do not delegate to `next(err)` — Express's
      // default handler emits HTML with a stack trace and absolute paths. Answer minimally.
      writeMinimalFallback(res);
    }
    // `req` and `next` are part of the Express error-middleware signature (4 arity is what marks
    // it as an error handler) and are deliberately unused beyond that.
    void req;
    void next;
  };
}

/**
 * The normal classification and response path. Extracted so `createErrorHandler` can wrap it in
 * a single try/catch — every `return` here is a fully-written response.
 */
function handleError(logger: Logger, err: unknown, res: Parameters<ErrorRequestHandler>[2]): void {
  const requestId = String(res.locals.correlationId ?? 'unknown');
  if (res.headersSent) {
    // Response already committed: record it, but never write a second body.
    logger.error('unhandled error after response was committed', { requestId });
    res.end();
    return;
  }
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
}
