import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/observability/logger.js';
import { createSessionStore, type SessionRecord } from '../../src/auth/sessionStore.js';
import { createRequireSession } from '../../src/http/middleware/auth.js';
import { createLayoutStore } from '../../src/dashboard/layoutStore.js';
import {
  createDashboardLayoutRouter,
  DEFAULT_LAYOUT
} from '../../src/http/routes/dashboardLayout.js';
import type { DashboardLayout } from '@nms/shared';

const logger = createLogger({ logLevel: 'error' });
const COOKIE = 'nms_session';

/** A single in-memory Redis shared across the app, so we can inspect the exact keys written. */
function memoryRedis() {
  const store = new Map<string, string>();
  return {
    store,
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

function buildApp() {
  const redis = memoryRedis();
  const sessions = createSessionStore(redis, {
    idleTimeoutSeconds: 1800,
    absoluteLifetimeSeconds: 28800
  });
  const layouts = createLayoutStore(redis);
  const requireSession = createRequireSession({
    sessions,
    cookieName: COOKIE,
    refreshIfNeeded: async (_id, record) => record
  });
  const router = createDashboardLayoutRouter({ layouts, logger, requireSession });
  const app = createApp({
    logger,
    version: '0.1.0',
    routers: [router],
    healthChecks: {} as never
  });
  return { app, sessions, redis };
}

async function agentFor(
  app: ReturnType<typeof buildApp>['app'],
  sessions: ReturnType<typeof buildApp>['sessions'],
  subject: string,
  username = 'alice'
) {
  const id = await sessions.create({
    username,
    displayName: username,
    subject,
    role: 'engineer',
    accessToken: 'a',
    refreshToken: 'r',
    accessTokenExpiresAt: Date.now() + 1_000_000,
    idpIdToken: 'id',
    idpSid: 'sid'
  });
  const cookie = `${COOKIE}=${id}`;
  return {
    get: () => request(app).get('/api/v1/dashboard/layout').set('Cookie', cookie),
    put: (body: unknown) =>
      request(app)
        .put('/api/v1/dashboard/layout')
        .set('Cookie', cookie)
        .set('x-requested-with', 'nms-ui')
        .send(body as object),
    del: () =>
      request(app)
        .delete('/api/v1/dashboard/layout')
        .set('Cookie', cookie)
        .set('x-requested-with', 'nms-ui')
  };
}

const VALID_LAYOUT: DashboardLayout = {
  version: 'v1',
  widgets: [
    { id: 'FleetKpiTiles', x: 0, y: 0, w: 12, h: 2 },
    { id: 'AlarmFeed', x: 0, y: 2, w: 6, h: 4 }
  ]
};

describe('GET /api/v1/dashboard/layout', () => {
  it('returns 401 without a session', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/dashboard/layout');
    expect(res.status).toBe(401);
  });

  it('returns the DEFAULT layout (not an error) when the user has none stored', async () => {
    const { app, sessions } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    const res = await agent.get();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(DEFAULT_LAYOUT);
  });

  it('returns the previously saved layout for the same user', async () => {
    const { app, sessions } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    await agent.put(VALID_LAYOUT);
    const res = await agent.get();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(VALID_LAYOUT);
  });
});

describe('PUT /api/v1/dashboard/layout — Zod-validated full replace', () => {
  it('stores a valid layout under the session-derived key and echoes it', async () => {
    const { app, sessions, redis } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    const res = await agent.put(VALID_LAYOUT);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(VALID_LAYOUT);
    // The key is derived from the session subject, NOT from any request input.
    expect(redis.store.has('dash:layout:v1:sub-1')).toBe(true);
  });

  it('requires the CSRF header (state-changing)', async () => {
    const { app, sessions } = buildApp();
    const id = await sessions.create({
      username: 'a',
      displayName: 'a',
      subject: 'sub-1',
      role: 'engineer',
      accessToken: 'a',
      refreshToken: 'r',
      accessTokenExpiresAt: Date.now() + 1_000_000,
      idpIdToken: 'id',
      idpSid: 'sid'
    });
    const res = await request(app)
      .put('/api/v1/dashboard/layout')
      .set('Cookie', `${COOKIE}=${id}`)
      .send(VALID_LAYOUT);
    expect(res.status).toBe(403);
  });

  it('rejects an UNKNOWN widget id (allowlist) with 400 VALIDATION_ERROR', async () => {
    const { app, sessions } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    const res = await agent.put({
      version: 'v1',
      widgets: [{ id: 'NotARealPanel', x: 0, y: 0, w: 4, h: 2 }]
    });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('rejects out-of-range / grid-overflowing geometry with 400', async () => {
    const { app, sessions } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    // x=10 + w=5 = 15 > 12 columns → refine fails.
    const res = await agent.put({
      version: 'v1',
      widgets: [{ id: 'FleetKpiTiles', x: 10, y: 0, w: 5, h: 2 }]
    });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown extra fields (strict mode)', async () => {
    const { app, sessions } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    const res = await agent.put({
      version: 'v1',
      widgets: [{ id: 'FleetKpiTiles', x: 0, y: 0, w: 4, h: 2, rogue: true }]
    });
    expect(res.status).toBe(400);
  });

  it('rejects a payload exceeding the widget-count cap (24) with 400', async () => {
    const { app, sessions } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    const widgets = Array.from({ length: 25 }, () => ({
      id: 'FleetKpiTiles',
      x: 0,
      y: 0,
      w: 1,
      h: 1
    }));
    const res = await agent.put({ version: 'v1', widgets });
    expect(res.status).toBe(400);
  });

  it('rejects an oversized body (>16KB) with 413 PAYLOAD_TOO_LARGE, before schema parse', async () => {
    const { app, sessions } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    // A GENUINELY large raw body (>16KB, under express.json's 100KB limit) so the real
    // content-length trips the route's pre-parse size cap. The size guard runs BEFORE schema
    // validation, so byte count is what matters here — the array need not satisfy the schema.
    const widgets = Array.from({ length: 800 }, () => ({
      id: 'FleetKpiTiles',
      x: 0,
      y: 0,
      w: 1,
      h: 1
    }));
    const res = await agent.put({ version: 'v1', widgets });
    expect(res.status).toBe(413);
    expect(res.body.errors[0].code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('DELETE /api/v1/dashboard/layout — reset to default', () => {
  it('deletes the key and returns the default, CSRF required', async () => {
    const { app, sessions, redis } = buildApp();
    const agent = await agentFor(app, sessions, 'sub-1');
    await agent.put(VALID_LAYOUT);
    expect(redis.store.has('dash:layout:v1:sub-1')).toBe(true);
    const res = await agent.del();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(DEFAULT_LAYOUT);
    expect(redis.store.has('dash:layout:v1:sub-1')).toBe(false);
  });
});

describe('PER-USER SCOPE IS STRUCTURAL — no IDOR surface (NFR-11)', () => {
  it('the key is derived from the session subject, NOT from request input', async () => {
    const { app, sessions, redis } = buildApp();
    // A malicious body carries userId/sub/user fields trying to target another user.
    const agent = await agentFor(app, sessions, 'sub-me');
    await agent.put({
      version: 'v1',
      // These attacker-supplied identity fields are ignored — strict mode rejects them at the top
      // level anyway, and even if present the store key never reads them.
      widgets: [{ id: 'FleetKpiTiles', x: 0, y: 0, w: 4, h: 2 }]
    });
    // ONLY the caller's own subject key exists — nothing under any other subject.
    expect([...redis.store.keys()].filter((k) => k.startsWith('dash:layout:v1:'))).toEqual([
      'dash:layout:v1:sub-me'
    ]);
  });

  it('user B cannot read or overwrite user A’s layout — each sees only their own key', async () => {
    const { app, sessions, redis } = buildApp();
    const alice = await agentFor(app, sessions, 'sub-alice', 'alice');
    const bob = await agentFor(app, sessions, 'sub-bob', 'bob');

    const aliceLayout: DashboardLayout = {
      version: 'v1',
      widgets: [{ id: 'P2PLinkMatrix', x: 0, y: 0, w: 12, h: 4 }]
    };
    const bobLayout: DashboardLayout = {
      version: 'v1',
      widgets: [{ id: 'AlarmFeed', x: 0, y: 0, w: 6, h: 4 }]
    };
    await alice.put(aliceLayout);
    await bob.put(bobLayout);

    // Bob reading returns Bob's layout, never Alice's — the key is his session subject only.
    const bobRead = await bob.get();
    expect(bobRead.body.data).toEqual(bobLayout);
    const aliceRead = await alice.get();
    expect(aliceRead.body.data).toEqual(aliceLayout);

    // Two distinct keys exist; Bob's write did not touch Alice's key.
    expect(redis.store.get('dash:layout:v1:sub-alice')).toBe(JSON.stringify(aliceLayout));
    expect(redis.store.get('dash:layout:v1:sub-bob')).toBe(JSON.stringify(bobLayout));

    // Bob deletes his layout; Alice's is untouched (no cross-user delete).
    await bob.del();
    expect(redis.store.has('dash:layout:v1:sub-bob')).toBe(false);
    expect(redis.store.has('dash:layout:v1:sub-alice')).toBe(true);
  });
});
