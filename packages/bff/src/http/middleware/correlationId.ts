import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Assigns a correlation id to every request (NFR-23).
 *
 * The inbound value is VALIDATED against a strict charset before reuse: an unvalidated
 * client header echoed into logs and responses is a log-injection vector.
 */
export const correlationId: RequestHandler = (req, res, next) => {
  const incoming = req.header(CORRELATION_HEADER);
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.locals.correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  next();
};
