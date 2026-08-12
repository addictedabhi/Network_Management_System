import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/observability/logger.js';
import { createSessionStore, type SessionRecord } from '../../src/auth/sessionStore.js';
import { createRequireSession } from '../../src/http/middleware/auth.js';
import { createDeviceRouter } from '../../src/http/routes/devices.js';
import { available, unavailable, type Device, type MetricValue } from '@nms/shared';
import type { LibreNmsClient } from '../../src/librenms/client.js';
import type { MetricsReader } from '../../src/metrics/metricsReader.js';
import { AppError } from '../../src/http/middleware/errorHandler.js';

const logger = createLogger({ logLevel: 'error' });
const COOKIE = 'nms_session';

function memoryRedis() {
  const store = new Map<string, string>();
  return {
    async set(k: string, v: string) {
      store.set(k, v);
    },
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async del(k: string) {
      store.delete(k);
    },
    async expire() {},
    async ping() {
      return 'PONG';
    }
  };
}

const SIM_DEVICES: Device[] = [
  {
    id: '1',
    hostname: 'sim-switch',
    displayName: 'sim-switch',
    kind: 'switch',
    location: 'lab',
    reachability: 'up',
    uptimeSeconds: available(123456)
  },
  {
    id: '2',
    hostname: 'sim-router',
    displayName: 'sim-router',
    kind: 'router',
    location: 'lab',
    reachability: 'up',
    uptimeSeconds: available(98765)
  },
  {
    id: '3',
    hostname: 'sim-af60',
    displayName: 'AF60 radio',
    kind: 'p2p',
    location: 'roof',
    reachability: 'up',
    uptimeSeconds: available(4242)
  },
  {
    id: '4',
    hostname: 'sim-af60-withheld',
    displayName: 'AF60 (RSSI withheld)',
    kind: 'p2p',
    location: 'roof',
    reachability: 'up',
    uptimeSeconds: available(4243)
  }
];

function fakeLibrenms(overrides: Partial<LibreNmsClient> = {}): LibreNmsClient {
  return {
    async listDevices() {
      return { items: SIM_DEVICES, total: SIM_DEVICES.length };
    },
    async getDevice(id) {
      const found = SIM_DEVICES.find((d) => d.id === id);
      if (!found) throw new AppError('NOT_FOUND', 'Device not found.', 404);
      return found;
    },
    async listAlarms() {
      return { items: [], total: 0 };
    },
    async getAlarm() {
      throw new AppError('NOT_FOUND', 'x', 404);
    },
    async acknowledgeAlarm() {},
    async listAlarmHistory() {
      return { items: [], total: 0 };
    },
    async listDeviceInterfaces() {
      return { items: [], total: 0 };
    },
    async listDeviceEvents() {
      return { items: [], total: 0 };
    },
    async ensureUser() {},
    async checkHealth() {
      return { status: 'ok', latencyMs: 1 };
    },
    ...overrides
  };
}

/**
 * A fake metrics reader modelling the withhold case: device 4's RSSI is UNAVAILABLE (the sim
 * withholds af60StaRSSI), while its SNR is available and device 3 has both.
 */
function fakeMetrics(): MetricsReader {
  return {
    async queryLatest({ deviceId, metric }) {
      let value: MetricValue<number>;
      if (metric === 'af60StaRSSI' && deviceId === '4') {
        value = unavailable<number>('OID_NOT_SUPPORTED'); // withheld — never a fabricated 0
      } else if (metric === 'af60StaRSSI') {
        value = available(-58);
      } else if (metric === 'af60StaSNR') {
        value = available(31);
      } else {
        value = available(1_000_000);
      }
      return { metric, deviceId, value };
    },
    async querySeries({ deviceId, metric }) {
      // Device 3 has real points for a throughput metric; everything else is an honest empty series.
      if (deviceId === '3' && metric === 'ifInOctets_rate') {
        return {
          metric,
          deviceId,
          points: [
            { timestamp: '2026-08-11T00:00:00Z', value: available(100, '2026-08-11T00:00:00Z') },
            { timestamp: '2026-08-11T00:05:00Z', value: available(120, '2026-08-11T00:05:00Z') }
          ]
        };
      }
      return { metric, deviceId, points: [] };
    },
    async checkHealth() {
      return { status: 'ok', latencyMs: 1 };
    }
  };
}

function buildApp(role: SessionRecord['role'], opts: { librenms?: LibreNmsClient } = {}) {
  const redis = memoryRedis();
  const sessions = createSessionStore(redis, {
    idleTimeoutSeconds: 1800,
    absoluteLifetimeSeconds: 28800
  });
  const requireSession = createRequireSession({
    sessions,
    cookieName: COOKIE,
    refreshIfNeeded: async (_id, record) => record // never expires in these tests
  });
  const deviceRouter = createDeviceRouter({
    librenms: opts.librenms ?? fakeLibrenms(),
    metrics: fakeMetrics(),
    logger,
    requireSession,
    uiBaseUrl: 'https://10.121.77.206:8443'
  });
  const app = createApp({
    logger,
    version: '0.1.0',
    routers: [deviceRouter],
    healthChecks: {} as never
  });
  return { app, sessions };
}

/**
 * Returns a supertest wrapper that attaches the opaque session cookie on every request. We set the
 * `Cookie` header EXPLICITLY rather than relying on the agent jar, because the session cookie is
 * `Secure` and supertest's jar will not resend a Secure cookie over the plaintext test transport.
 */
async function loggedInAgent(role: SessionRecord['role'], opts: { librenms?: LibreNmsClient } = {}) {
  const { app, sessions } = buildApp(role, opts);
  const id = await sessions.create({
    username: 'alice',
    displayName: 'Alice',
    subject: 'sub-1',
    role,
    accessToken: 'a',
    refreshToken: 'r',
    accessTokenExpiresAt: Date.now() + 1_000_000,
    idpIdToken: 'id',
    idpSid: 'sid'
  });
  const cookie = `${COOKIE}=${id}`;
  return {
    get: (path: string) => request(app).get(path).set('Cookie', cookie)
  };
}

describe('GET /api/v1/devices', () => {
  it('returns 401 without a session', async () => {
    const { app } = buildApp('operator');
    const res = await request(app).get('/api/v1/devices');
    expect(res.status).toBe(401);
  });

  it('lists the live sim devices for a logged-in user', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/devices');
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: Device) => d.hostname)).toEqual([
      'sim-switch',
      'sim-router',
      'sim-af60',
      'sim-af60-withheld'
    ]);
    expect(res.body.meta.total).toBe(4);
  });

  it('returns an explicit error when LibreNMS is unavailable, never empty data (NFR-22)', async () => {
    const agent = await loggedInAgent('operator', {
      librenms: fakeLibrenms({
        async listDevices() {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'down', 503);
        }
      })
    });
    const res = await agent.get('/api/v1/devices');
    expect(res.status).toBe(503);
    expect(res.body.errors[0].code).toBe('UPSTREAM_UNAVAILABLE');
    expect(res.body.data).toBeUndefined();
  });
});

describe('GET /api/v1/devices/:id/metrics/latest', () => {
  it('returns an available RSSI for the healthy AF60 (device 3)', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/devices/3/metrics/latest?metric=af60StaRSSI');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('available');
    expect(res.body.data.value).toBe(-58);
  });

  it('returns UNAVAILABLE (never 0) for the withheld-RSSI AF60 (device 4) — FR-24', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/devices/4/metrics/latest?metric=af60StaRSSI');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('unavailable');
    expect(res.body.data.value).toBeUndefined();
    // The honest signal: no fabricated 0 anywhere in the payload.
    expect(JSON.stringify(res.body.data)).not.toContain('"value"');
  });

  it('still returns SNR for the withheld device (device 4)', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/devices/4/metrics/latest?metric=af60StaSNR');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('available');
    expect(res.body.data.value).toBe(31);
  });

  it('rejects an unknown metric name (allowlist)', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/devices/3/metrics/latest?metric=rm%20-rf');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/devices/:id/metrics/series (FR-22)', () => {
  it('returns time-series points for a real series', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get(
      '/api/v1/devices/3/metrics/series?metric=ifInOctets_rate&from=2026-08-11T00:00:00Z&to=2026-08-11T01:00:00Z&step=5m'
    );
    expect(res.status).toBe(200);
    expect(res.body.data.points).toHaveLength(2);
    expect(res.body.data.points[0].value.status).toBe('available');
    expect(res.body.data.points[0].value.value).toBe(100);
  });

  it('returns an empty points array (never fabricated) when there is no series', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get(
      '/api/v1/devices/4/metrics/series?metric=ifInOctets_rate&from=2026-08-11T00:00:00Z&to=2026-08-11T01:00:00Z&step=5m'
    );
    expect(res.status).toBe(200);
    expect(res.body.data.points).toEqual([]);
  });

  it('rejects an unknown metric name (allowlist)', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get(
      '/api/v1/devices/3/metrics/series?metric=evil&from=2026-08-11T00:00:00Z&to=2026-08-11T01:00:00Z&step=5m'
    );
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing time range', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/devices/3/metrics/series?metric=ifInOctets_rate');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/devices/:id/events (N2) — session-gated eventlog/syslog', () => {
  it('returns 401 without a session', async () => {
    const { app } = buildApp('operator');
    const res = await request(app).get('/api/v1/devices/3/events');
    expect(res.status).toBe(401);
  });

  it('defaults to eventlog and pages with a real total', async () => {
    const listDeviceEvents = vi.fn(async () => ({
      items: [
        { id: '1', deviceId: '3', hostname: 'sim-switch-01', message: 'polled', type: 'poller', loggedAt: '2026-08-12 08:00:00' }
      ],
      total: 12
    }));
    const agent = await loggedInAgent('readonly', { librenms: fakeLibrenms({ listDeviceEvents }) });
    const res = await agent.get('/api/v1/devices/3/events');
    expect(res.status).toBe(200);
    expect(listDeviceEvents).toHaveBeenCalledWith('3', 'eventlog', expect.any(Object));
    expect(res.body.meta.total).toBe(12);
    expect(res.body.data[0].message).toBe('polled');
  });

  it('source=syslog selects the syslog table and honestly reports EMPTY at POC', async () => {
    const listDeviceEvents = vi.fn(async () => ({ items: [], total: 0 }));
    const agent = await loggedInAgent('operator', { librenms: fakeLibrenms({ listDeviceEvents }) });
    const res = await agent.get('/api/v1/devices/3/events?source=syslog');
    expect(res.status).toBe(200);
    expect(listDeviceEvents).toHaveBeenCalledWith('3', 'syslog', expect.any(Object));
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('surfaces a real upstream failure as an error, never empty data (NFR-22)', async () => {
    const agent = await loggedInAgent('operator', {
      librenms: fakeLibrenms({
        async listDeviceEvents() {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'down', 503);
        }
      })
    });
    const res = await agent.get('/api/v1/devices/3/events');
    expect(res.status).toBe(503);
    expect(res.body.data).toBeUndefined();
  });
});

describe('GET /api/v1/admin-portal-url (FR-42)', () => {
  it('is granted to engineer', async () => {
    const agent = await loggedInAgent('engineer');
    const res = await agent.get('/api/v1/admin-portal-url');
    expect(res.status).toBe(200);
    expect(res.body.data.url).toContain('10.121.77.206:8443');
  });

  it('is denied to operator (403)', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/admin-portal-url');
    expect(res.status).toBe(403);
  });
});
