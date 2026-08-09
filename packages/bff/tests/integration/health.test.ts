import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/observability/logger.js';

const ok = async () => ({ status: 'ok' as const, latencyMs: 1 });
const logger = createLogger({ logLevel: 'error' });

function appWith(
  checks: Record<
    string,
    () => Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }>
  >
) {
  return createApp({
    logger,
    healthChecks: checks as never,
    version: '0.1.0',
    routers: []
  });
}

describe('health endpoints', () => {
  it('GET /health returns 200 and calls no dependency', async () => {
    let called = false;
    const res = await request(
      appWith({
        redis: async () => {
          called = true;
          return { status: 'ok' };
        },
        librenms: ok,
        idp: ok,
        tsdb: ok
      })
    ).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('bff');
    expect(called).toBe(false);
  });

  it('GET /ready returns 200 when all dependencies are healthy', async () => {
    const res = await request(appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok })).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.librenms.status).toBe('ok');
  });

  it('GET /ready returns 503 when LibreNMS is down while /health stays 200 (AC-E#28)', async () => {
    const checks = {
      redis: ok,
      idp: ok,
      tsdb: ok,
      librenms: async () => ({ status: 'error' as const, error: 'UPSTREAM_UNAVAILABLE' })
    };
    const ready = await request(appWith(checks)).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('not_ready');
    const live = await request(appWith(checks)).get('/health');
    expect(live.status).toBe(200);
  });

  it('never leaks a hostname, DSN, or credential in /ready output', async () => {
    const checks = {
      redis: ok,
      idp: ok,
      tsdb: ok,
      librenms: async () => ({ status: 'error' as const, error: 'UPSTREAM_UNAVAILABLE' })
    };
    const res = await request(appWith(checks)).get('/ready');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/redis:\/\/|http:\/\/|https:\/\/|token|secret/i);
  });

  it('sets security headers on responses (AC-F#33)', async () => {
    const res = await request(appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok })).get(
      '/health'
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('returns a correlation id on every response (NFR-23)', async () => {
    const res = await request(appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok })).get(
      '/health'
    );
    expect(res.headers['x-correlation-id']).toBeTruthy();
  });
});

/**
 * Finding 17: HSTS was sent unconditionally. A one-year `includeSubDomains` pin emitted from a
 * plaintext dev server can lock a whole domain tree into HTTPS-only for a year.
 */
describe('HSTS gating (finding 17)', () => {
  const checks = { redis: ok, librenms: ok, idp: ok, tsdb: ok } as never;

  it('does not send HSTS outside production', async () => {
    const res = await request(
      createApp({ logger, healthChecks: checks, version: '0.1.0', routers: [] })
    ).get('/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('sends HSTS in production', async () => {
    const res = await request(
      createApp({
        logger,
        healthChecks: checks,
        version: '0.1.0',
        routers: [],
        isProduction: true
      })
    ).get('/health');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('still sends the non-transport security headers outside production', async () => {
    const res = await request(
      createApp({ logger, healthChecks: checks, version: '0.1.0', routers: [] })
    ).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

/**
 * Finding 18: a client-supplied correlation id was adopted as the authoritative id, letting a
 * caller force or replay ids and poison trace correlation.
 */
describe('correlation id provenance (finding 18)', () => {
  const app = () => appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok });

  it('never adopts a client-supplied correlation id as its own', async () => {
    const forced = 'attacker-chosen-id-000001';
    const res = await request(app()).get('/health').set('x-correlation-id', forced);
    expect(res.headers['x-correlation-id']).toBeTruthy();
    expect(res.headers['x-correlation-id']).not.toBe(forced);
  });

  it('generates a distinct id per request', async () => {
    const a = await request(app()).get('/health');
    const b = await request(app()).get('/health');
    expect(a.headers['x-correlation-id']).not.toBe(b.headers['x-correlation-id']);
  });

  it('preserves a valid client trace id in a separate header for stitching', async () => {
    const clientId = 'client-trace-abc123';
    const res = await request(app()).get('/health').set('x-client-trace-id', clientId);
    expect(res.headers['x-client-trace-id']).toBe(clientId);
    expect(res.headers['x-correlation-id']).not.toBe(clientId);
  });

  it('drops a client trace id that fails the charset check (log injection)', async () => {
    const res = await request(app())
      .get('/health')
      .set('x-client-trace-id', 'bad\tvalue with spaces');
    expect(res.headers['x-client-trace-id']).toBeUndefined();
  });
});

/**
 * Finding H-5: `notFoundHandler` existed but was never wired, so unmatched routes emitted
 * Express's default HTML error page — bypassing the JSON envelope contract and leaking
 * framework identity.
 */
describe('unmatched routes (H-5)', () => {
  const app = () => appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok });

  it('returns 404 with the JSON failure envelope, not Express HTML', async () => {
    const res = await request(app()).get('/no/such/route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('NOT_FOUND');
    expect(res.body.meta.requestId).toBeTruthy();
  });

  it('does not leak Express framework detail or a stack trace', async () => {
    const res = await request(app()).get('/no/such/route');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/<html|<pre|Cannot GET|at \/|node_modules/i);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('applies the envelope to unmatched API routes too', async () => {
    const res = await request(app()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errors[0].code).toBe('NOT_FOUND');
  });

  it('applies the envelope to a non-GET unmatched route', async () => {
    const res = await request(app()).post('/nope').send({ a: 1 });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('still sets security headers on a 404', async () => {
    const res = await request(app()).get('/no/such/route');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

/**
 * Finding 9: `/ready` awaited its checks with no timeout. `catch` handles REJECTION, not
 * HANGING — a black-holed TCP connect leaves the probe unanswered, so the instance is neither
 * ready nor drained, breaking NFR-21 drain semantics.
 */
describe('/ready timeouts (finding 9)', () => {
  const never = () => new Promise<never>(() => {});

  it('fails closed with 503 when a dependency hangs, instead of hanging the probe', async () => {
    const res = await request(
      createApp({
        logger,
        version: '0.1.0',
        routers: [],
        healthChecks: { redis: ok, idp: ok, tsdb: ok, librenms: never } as never,
        readyTimeoutMs: 50
      })
    ).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks.librenms.status).toBe('error');
  });

  it('reports the hung dependency with a machine-readable code and no internals', async () => {
    const res = await request(
      createApp({
        logger,
        version: '0.1.0',
        routers: [],
        healthChecks: { redis: ok, idp: ok, tsdb: ok, librenms: never } as never,
        readyTimeoutMs: 50
      })
    ).get('/ready');
    expect(res.body.checks.librenms.error).toBe('UPSTREAM_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/timeout of|at Timeout|node:internal/i);
  });

  it('a slow-but-responsive dependency within the budget still reports ready', async () => {
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { status: 'ok' as const, latencyMs: 10 };
    };
    const res = await request(
      createApp({
        logger,
        version: '0.1.0',
        routers: [],
        healthChecks: { redis: ok, idp: ok, tsdb: ok, librenms: slow } as never,
        readyTimeoutMs: 500
      })
    ).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('a rejecting dependency is still reported as error (regression)', async () => {
    const res = await request(
      appWith({
        redis: ok,
        idp: ok,
        tsdb: ok,
        librenms: async () => {
          throw new Error('connection refused to librenms.internal');
        }
      })
    ).get('/ready');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('librenms.internal');
  });
});
