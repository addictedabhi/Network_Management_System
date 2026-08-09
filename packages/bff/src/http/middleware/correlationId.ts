import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';
export const CLIENT_TRACE_HEADER = 'x-client-trace-id';

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Assigns a correlation id to every request (NFR-23).
 *
 * The server ALWAYS generates its own id (finding 18). Previously a valid-looking client
 * header was adopted as the correlation id itself, which let a caller choose or replay ids and
 * poison trace correlation — two unrelated requests could share an id, or an attacker could
 * collide with a known trace to make their own activity hard to isolate.
 *
 * The client's value is still useful for stitching a browser-side trace to a server-side one,
 * so it is preserved SEPARATELY (charset-validated, never used as the authoritative id). The
 * charset check remains essential: an unvalidated header echoed into logs is a log-injection
 * vector.
 */
export const correlationId: RequestHandler = (req, res, next) => {
  const id = randomUUID();
  const incoming = req.header(CORRELATION_HEADER) ?? req.header(CLIENT_TRACE_HEADER);
  const clientTraceId = incoming && SAFE_ID.test(incoming) ? incoming : undefined;

  res.locals.correlationId = id;
  res.locals.clientTraceId = clientTraceId;
  res.setHeader(CORRELATION_HEADER, id);
  if (clientTraceId) res.setHeader(CLIENT_TRACE_HEADER, clientTraceId);
  next();
};
