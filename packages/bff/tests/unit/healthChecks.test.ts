import { describe, it, expect } from 'vitest';
import { createHealthChecks } from '../../src/health/checks.js';

const okHealth = { status: 'ok' as const, latencyMs: 1 };
const errHealth = { status: 'error' as const, error: 'UPSTREAM_UNAVAILABLE' as const };

function fakeRedis(ping: () => Promise<string>) {
  return {
    async set() {},
    async get() {
      return null;
    },
    async del() {},
    async expire() {},
    ping
  };
}

/** A stub OIDC client whose discovery + JWKS resolution both succeed unless overridden. */
function okOidc() {
  return {
    async discover() {
      return {} as never;
    },
    async getJwks() {
      return (() => {}) as never;
    }
  };
}

describe('createHealthChecks (real /ready probes)', () => {
  it('wires librenms and tsdb to the injected dependency probes', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => 'PONG'),
      librenms: { checkHealth: async () => okHealth },
      metrics: { checkHealth: async () => okHealth },
      oidc: okOidc()
    });
    await expect(checks.librenms()).resolves.toMatchObject({ status: 'ok' });
    await expect(checks.tsdb()).resolves.toMatchObject({ status: 'ok' });
  });

  it('reports librenms error when the engine probe fails (drives /ready 503)', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => 'PONG'),
      librenms: { checkHealth: async () => errHealth },
      metrics: { checkHealth: async () => okHealth },
      oidc: okOidc()
    });
    await expect(checks.librenms()).resolves.toMatchObject({ status: 'error' });
  });

  it('reports tsdb error when InfluxDB is unreachable (drives /ready 503)', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => 'PONG'),
      librenms: { checkHealth: async () => okHealth },
      metrics: { checkHealth: async () => errHealth },
      oidc: okOidc()
    });
    await expect(checks.tsdb()).resolves.toMatchObject({ status: 'error' });
  });

  it('redis probe reports ok when PING succeeds (Task 5 real probe)', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => 'PONG'),
      librenms: { checkHealth: async () => okHealth },
      metrics: { checkHealth: async () => okHealth },
      oidc: okOidc()
    });
    const health = await checks.redis();
    expect(health.status).toBe('ok');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('redis probe reports error when PING rejects (drives /ready 503)', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => {
        throw new Error('connection refused');
      }),
      librenms: { checkHealth: async () => okHealth },
      metrics: { checkHealth: async () => okHealth },
      oidc: okOidc()
    });
    const health = await checks.redis();
    expect(health.status).toBe('error');
    // No hostname/DSN/upstream body leaks through — only a machine-readable code.
    expect(health.error).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('idp probe reports ok ONLY when discovery + JWKS both resolve (REAL, not a stub)', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => 'PONG'),
      librenms: { checkHealth: async () => okHealth },
      metrics: { checkHealth: async () => okHealth },
      oidc: okOidc()
    });
    await expect(checks.idp()).resolves.toMatchObject({ status: 'ok' });
  });

  it('idp probe reports error when realm discovery fails (fail closed, no fabricated ok)', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => 'PONG'),
      librenms: { checkHealth: async () => okHealth },
      metrics: { checkHealth: async () => okHealth },
      oidc: {
        async discover() {
          throw new Error('discovery unreachable');
        },
        async getJwks() {
          return (() => {}) as never;
        }
      }
    });
    const health = await checks.idp();
    expect(health.status).toBe('error');
    expect(health.error).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('idp probe reports error when the realm JWKS cannot be fetched', async () => {
    const checks = createHealthChecks({
      redis: fakeRedis(async () => 'PONG'),
      librenms: { checkHealth: async () => okHealth },
      metrics: { checkHealth: async () => okHealth },
      oidc: {
        async discover() {
          return {} as never;
        },
        async getJwks() {
          throw new Error('jwks unreachable');
        }
      }
    });
    await expect(checks.idp()).resolves.toMatchObject({ status: 'error' });
  });
});
