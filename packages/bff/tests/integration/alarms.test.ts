import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/observability/logger.js';
import { createSessionStore, type SessionRecord } from '../../src/auth/sessionStore.js';
import { createRequireSession } from '../../src/http/middleware/auth.js';
import { createAlarmRouter } from '../../src/http/routes/alarms.js';
import type { Alarm } from '@nms/shared';
import type { LibreNmsClient } from '../../src/librenms/client.js';
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

const ALARMS: Alarm[] = [
  {
    id: '10',
    deviceId: '5',
    deviceHostname: 'sim-radio-01',
    deviceKind: 'p2p',
    entity: 'Local RSSI',
    severity: 'critical',
    ruleName: 'RSSI below threshold',
    firstRaisedAt: '2026-08-11T00:00:00Z',
    durationSeconds: 600,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null
  },
  {
    id: '11',
    deviceId: '3',
    deviceHostname: 'sim-switch-01',
    deviceKind: 'switch',
    entity: null,
    severity: 'warning',
    ruleName: 'High CPU',
    firstRaisedAt: '2026-08-11T00:05:00Z',
    durationSeconds: 300,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null
  }
];

function fakeLibrenms(overrides: Partial<LibreNmsClient> = {}): LibreNmsClient {
  return {
    async listDevices() {
      return { items: [], total: 0 };
    },
    async getDevice() {
      throw new AppError('NOT_FOUND', 'x', 404);
    },
    async listAlarms(q) {
      const start = (q.page - 1) * q.perPage;
      return { items: ALARMS.slice(start, start + q.perPage), total: ALARMS.length };
    },
    async getAlarm(id) {
      const found = ALARMS.find((a) => a.id === id);
      if (!found) throw new AppError('NOT_FOUND', 'Alarm not found.', 404);
      return found;
    },
    async acknowledgeAlarm() {},
    async listDeviceInterfaces() {
      return { items: [], total: 0 };
    },
    async ensureUser() {},
    async checkHealth() {
      return { status: 'ok', latencyMs: 1 };
    },
    ...overrides
  };
}

function buildApp(opts: { librenms?: LibreNmsClient } = {}) {
  const redis = memoryRedis();
  const sessions = createSessionStore(redis, {
    idleTimeoutSeconds: 1800,
    absoluteLifetimeSeconds: 28800
  });
  const requireSession = createRequireSession({
    sessions,
    cookieName: COOKIE,
    refreshIfNeeded: async (_id, record) => record
  });
  const alarmRouter = createAlarmRouter({
    librenms: opts.librenms ?? fakeLibrenms(),
    logger,
    requireSession
  });
  const app = createApp({
    logger,
    version: '0.1.0',
    routers: [alarmRouter],
    healthChecks: {} as never
  });
  return { app, sessions };
}

async function loggedInAgent(
  role: SessionRecord['role'],
  opts: { librenms?: LibreNmsClient } = {}
) {
  const { app, sessions } = buildApp(opts);
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
    get: (path: string) => request(app).get(path).set('Cookie', cookie),
    ack: (path: string) =>
      request(app).post(path).set('Cookie', cookie).set('x-requested-with', 'nms-ui')
  };
}

describe('GET /api/v1/alarms (FR-30/38)', () => {
  it('returns 401 without a session', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/alarms');
    expect(res.status).toBe(401);
  });

  it('lists active alarms with a real total for a logged-in user', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/alarms');
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: Alarm) => a.ruleName)).toEqual([
      'RSSI below threshold',
      'High CPU'
    ]);
    expect(res.body.meta.total).toBe(2);
  });

  it('windows to a single page (server-side pagination via windowPage)', async () => {
    const agent = await loggedInAgent('operator');
    const res = await agent.get('/api/v1/alarms?page=1&perPage=1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.hasNext).toBe(true);
  });

  it('passes severity + acknowledged filters through to the client', async () => {
    const listAlarms = vi.fn(async () => ({ items: [], total: 0 }));
    const agent = await loggedInAgent('operator', {
      librenms: fakeLibrenms({ listAlarms })
    });
    await agent.get('/api/v1/alarms?severity=critical&acknowledged=false');
    expect(listAlarms).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', acknowledged: false })
    );
  });

  it('shows the honest empty state (no rows, total 0) when no alarms are active', async () => {
    const agent = await loggedInAgent('operator', {
      librenms: fakeLibrenms({ async listAlarms() {
        return { items: [], total: 0 };
      } })
    });
    const res = await agent.get('/api/v1/alarms');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('surfaces an explicit error when LibreNMS is unavailable, never empty data (NFR-22)', async () => {
    const agent = await loggedInAgent('operator', {
      librenms: fakeLibrenms({
        async listAlarms() {
          throw new AppError('UPSTREAM_UNAVAILABLE', 'down', 503);
        }
      })
    });
    const res = await agent.get('/api/v1/alarms');
    expect(res.status).toBe(503);
    expect(res.body.errors[0].code).toBe('UPSTREAM_UNAVAILABLE');
    expect(res.body.data).toBeUndefined();
  });
});

describe('POST /api/v1/alarms/:id/ack (FR-33/34/35) — server-side role gate', () => {
  it('engineer CAN acknowledge, passing the actor identity server-side', async () => {
    const acknowledgeAlarm = vi.fn(async () => {});
    const agent = await loggedInAgent('engineer', {
      librenms: fakeLibrenms({ acknowledgeAlarm })
    });
    const res = await agent.ack('/api/v1/alarms/10/ack');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Actor identity comes from the SERVER-SIDE session, never from the request body.
    expect(acknowledgeAlarm).toHaveBeenCalledWith('10', 'alice');
  });

  it('admin CAN acknowledge', async () => {
    const acknowledgeAlarm = vi.fn(async () => {});
    const agent = await loggedInAgent('admin', {
      librenms: fakeLibrenms({ acknowledgeAlarm })
    });
    const res = await agent.ack('/api/v1/alarms/10/ack');
    expect(res.status).toBe(200);
    expect(acknowledgeAlarm).toHaveBeenCalledWith('10', 'alice');
  });

  it('READONLY is DENIED server-side (403) and the ack is NEVER called — not a hidden button', async () => {
    const acknowledgeAlarm = vi.fn(async () => {});
    const agent = await loggedInAgent('readonly', {
      librenms: fakeLibrenms({ acknowledgeAlarm })
    });
    const res = await agent.ack('/api/v1/alarms/10/ack');
    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('FORBIDDEN');
    expect(acknowledgeAlarm).not.toHaveBeenCalled();
  });

  it('operator is DENIED server-side (403) — ack requires engineer/admin', async () => {
    const acknowledgeAlarm = vi.fn(async () => {});
    const agent = await loggedInAgent('operator', {
      librenms: fakeLibrenms({ acknowledgeAlarm })
    });
    const res = await agent.ack('/api/v1/alarms/10/ack');
    expect(res.status).toBe(403);
    expect(acknowledgeAlarm).not.toHaveBeenCalled();
  });

  it('requires a session (401) with no cookie', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/v1/alarms/10/ack').set('x-requested-with', 'nms-ui');
    expect(res.status).toBe(401);
  });

  it('requires the CSRF header on the state-changing ack', async () => {
    const { app, sessions } = buildApp();
    const id = await sessions.create({
      username: 'eng',
      displayName: 'Eng',
      subject: 's',
      role: 'engineer',
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: Date.now() + 1_000_000,
      idpIdToken: 'id',
      idpSid: 'sid'
    });
    // No x-requested-with header → CSRF guard rejects.
    const res = await request(app).post('/api/v1/alarms/10/ack').set('Cookie', `${COOKIE}=${id}`);
    expect(res.status).toBe(403);
  });
});
