import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { AppError, createErrorHandler, notFoundHandler } from '../../src/http/middleware/errorHandler.js';
import { correlationId } from '../../src/http/middleware/correlationId.js';
import type { Logger } from '../../src/observability/logger.js';

const ok = async () => ({ status: 'ok' as const, latencyMs: 1 });

interface LogRecord {
  readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  readonly message: string;
  readonly context?: unknown;
}

/**
 * Collects emitted records so the log LEVEL can be asserted, not just the response. A fake
 * rather than a spy on `createLogger` — the assertion under test is which method the handler
 * chose, which is exactly what a fake Logger observes.
 */
function capturingLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const push = (level: LogRecord['level']) => (message: string, context?: unknown) => {
    records.push({ level, message, context });
  };
  const logger: Logger = {
    debug: push('DEBUG'),
    info: push('INFO'),
    warn: push('WARN'),
    error: push('ERROR'),
    audit: () => {}
  };
  return { logger, records };
}

/** Body-parser errors are only reachable through the real `express.json()` middleware. */
function bodyParserApp(logger: Logger): Express {
  return createApp({
    logger,
    healthChecks: { redis: ok, librenms: ok, idp: ok, tsdb: ok } as never,
    version: '0.1.0',
    routers: []
  });
}

/** Minimal app whose single route throws whatever it is given, to drive the handler directly. */
function throwingApp(logger: Logger, err: unknown): Express {
  const app = express();
  app.use(correlationId);
  app.get('/boom', () => {
    throw err;
  });
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}

const NO_LEAK_PATTERNS = [
  /at\s+\S+:\d+:\d+/, // stack frame
  /node_modules/,
  /packages[\\/]bff/,
  /\.ts:\d+/,
  /\.js:\d+/,
  /select\s+/i,
  /Error:\s/
];

function expectNoLeak(body: unknown): void {
  const text = JSON.stringify(body);
  for (const pattern of NO_LEAK_PATTERNS) {
    expect(text, `envelope must not match ${String(pattern)}`).not.toMatch(pattern);
  }
}

function expectFailureEnvelope(body: {
  success?: unknown;
  errors?: { code?: string; message?: string }[];
  meta?: { requestId?: string };
}): void {
  expect(body.success).toBe(false);
  expect(Array.isArray(body.errors)).toBe(true);
  expect(body.errors).toHaveLength(1);
  expect(Object.keys(body.errors![0]!).sort()).toEqual(['code', 'message']);
  expect(typeof body.meta?.requestId).toBe('string');
  expect(body.meta!.requestId!.length).toBeGreaterThan(0);
  expectNoLeak(body);
}

describe('createErrorHandler — AppError branch', () => {
  it('honours the declared status and code and logs a 4xx at INFO', async () => {
    const { logger, records } = capturingLogger();
    const res = await request(
      throwingApp(logger, new AppError('FORBIDDEN', 'You may not do that.', 403))
    ).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('FORBIDDEN');
    expect(res.body.errors[0].message).toBe('You may not do that.');
    expectFailureEnvelope(res.body);
    expect(records.filter((r) => r.level === 'ERROR')).toHaveLength(0);
    expect(records.some((r) => r.level === 'INFO')).toBe(true);
  });

  it('includes `field` when the AppError carries one', async () => {
    const { logger } = capturingLogger();
    const res = await request(
      throwingApp(logger, new AppError('VALIDATION_ERROR', 'Bad email.', 422, 'email'))
    ).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('email');
    expectNoLeak(res.body);
  });

  it('logs a 5xx AppError at ERROR and still leaks nothing', async () => {
    const { logger, records } = capturingLogger();
    const res = await request(
      throwingApp(logger, new AppError('UPSTREAM_ERROR', 'Upstream failed.', 502))
    ).get('/boom');
    expect(res.status).toBe(502);
    expect(res.body.errors[0].code).toBe('UPSTREAM_ERROR');
    expectFailureEnvelope(res.body);
    expect(records.some((r) => r.level === 'ERROR')).toBe(true);
  });
});

describe('createErrorHandler — unknown error branch', () => {
  it('answers 500 INTERNAL_ERROR with no stack, path, or original message', async () => {
    const { logger, records } = capturingLogger();
    const secret = 'SELECT token FROM sessions WHERE id = 1';
    const res = await request(throwingApp(logger, new Error(secret))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');
    expect(res.body.errors[0].message).toBe('An internal error occurred.');
    expect(JSON.stringify(res.body)).not.toContain('sessions');
    expectFailureEnvelope(res.body);
    expect(records.some((r) => r.level === 'ERROR')).toBe(true);
  });

  it('handles a non-Error throw without leaking its contents', async () => {
    const { logger } = capturingLogger();
    const res = await request(throwingApp(logger, { secretField: 'hunter2' })).get('/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expectFailureEnvelope(res.body);
  });

  it('does not honour a status property on a non-AppError throw', async () => {
    const { logger } = capturingLogger();
    const rogue = Object.assign(new Error('nope'), { status: 403 });
    const res = await request(throwingApp(logger, rogue)).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');
  });
});

describe('createErrorHandler — framework body-parser errors (finding 1)', () => {
  it('answers 413 PAYLOAD_TOO_LARGE for a body over the limit and logs at WARN, not ERROR', async () => {
    const { logger, records } = capturingLogger();
    const oversized = JSON.stringify({ pad: 'x'.repeat(200 * 1024) });
    const res = await request(bodyParserApp(logger))
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(oversized);
    expect(res.status).toBe(413);
    expect(res.body.errors[0].code).toBe('PAYLOAD_TOO_LARGE');
    expectFailureEnvelope(res.body);
    expect(records.filter((r) => r.level === 'ERROR')).toHaveLength(0);
    expect(records.some((r) => r.level === 'WARN')).toBe(true);
  });

  it('answers 400 VALIDATION_ERROR for malformed JSON and does not log at ERROR', async () => {
    const { logger, records } = capturingLogger();
    const res = await request(bodyParserApp(logger))
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
    expectFailureEnvelope(res.body);
    expect(records.filter((r) => r.level === 'ERROR')).toHaveLength(0);
  });

  it('answers 415 UNSUPPORTED_MEDIA_TYPE for an unsupported charset', async () => {
    const { logger, records } = capturingLogger();
    const res = await request(bodyParserApp(logger))
      .post('/health')
      .set('Content-Type', 'application/json; charset=utf-99')
      .send('{}');
    expect(res.status).toBe(415);
    expect(res.body.errors[0].code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expectFailureEnvelope(res.body);
    expect(records.filter((r) => r.level === 'ERROR')).toHaveLength(0);
  });

  it('never puts the body-parser message or a stack on the wire', async () => {
    const { logger } = capturingLogger();
    const res = await request(bodyParserApp(logger))
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/JSON at position/i);
    expect(text).not.toMatch(/body-parser|bodyParser/);
    expectNoLeak(res.body);
  });

  it('does not re-classify an UNKNOWN `type`, even with a 4xx status', async () => {
    const { logger, records } = capturingLogger();
    const rogue = Object.assign(new Error('made up'), { status: 403, type: 'not.a.real.type' });
    const res = await request(throwingApp(logger, rogue)).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');
    expect(records.some((r) => r.level === 'ERROR')).toBe(true);
  });

  it('keeps the opaque 500 for an ALLOWLISTED type carrying a 5xx status (fail closed)', async () => {
    const { logger, records } = capturingLogger();
    // A known `type` must not be enough on its own: a genuine server fault wearing a
    // body-parser type must stay a paged 5xx, never be downgraded to a dashboard-only 4xx.
    const spoofed = Object.assign(new Error('gateway blew up'), {
      status: 502,
      type: 'entity.too.large'
    });
    const res = await request(throwingApp(logger, spoofed)).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('gateway blew up');
    expect(records.some((r) => r.level === 'ERROR')).toBe(true);
    expect(records.filter((r) => r.level === 'WARN')).toHaveLength(0);
  });

  it('keeps the opaque 500 for an allowlisted type with NO usable status', async () => {
    const { logger } = capturingLogger();
    const noStatus = Object.assign(new Error('no status'), { type: 'entity.parse.failed' });
    const res = await request(throwingApp(logger, noStatus)).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('INTERNAL_ERROR');
  });
});
