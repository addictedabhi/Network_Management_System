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
