import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/observability/logger.js';
import { createSessionStore } from '../../src/auth/sessionStore.js';
import { createPreSessionStore } from '../../src/auth/preSessionStore.js';
import { createRequireSession } from '../../src/http/middleware/auth.js';
import { createAuthRouter, createRefreshIfNeeded } from '../../src/http/routes/auth.js';
import type { OidcClient, TokenSet } from '../../src/auth/oidcClient.js';
import { makeToken, TEST_OIDC } from '../helpers/jwt.js';

const logger = createLogger({ logLevel: 'error' });
const COOKIE = 'nms_session';

/** A minimal in-memory Redis honouring the RedisLike surface (no live host). */
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

const ROLE_MAP = {
  'nms-admin': 'admin',
  'nms-engineer': 'engineer',
  'nms-operator': 'operator',
  'nms-readonly': 'readonly'
} as const;

/**
 * A fake OIDC client. `exchangeCode` returns a token set whose id_token is minted by the JWT
 * helper for the requested groups; `getJwks` returns the matching local key set, so
 * `verifyIdToken` runs for real against a real signature — no live IdP, but the full validation
 * path executes.
 */
function fakeOidc(opts: {
  groups: readonly string[];
  tamper?: (t: TokenSet) => TokenSet;
}): { oidc: OidcClient; issuedTokenIsValid: () => Promise<void> } {
  let jwks: Awaited<ReturnType<typeof makeToken>>['jwks'] | undefined;
  const oidc: OidcClient = {
    async discover() {
      return {
        authorization_endpoint: 'https://idp.test/realms/nms/protocol/openid-connect/auth',
        token_endpoint: 'https://idp.test/realms/nms/protocol/openid-connect/token',
        jwks_uri: 'https://idp.test/realms/nms/protocol/openid-connect/certs',
        end_session_endpoint: 'https://idp.test/realms/nms/protocol/openid-connect/logout',
        issuer: TEST_OIDC.issuer
      };
    },
    async getJwks() {
      if (!jwks) throw new Error('exchangeCode must run before getJwks in this fake');
      return jwks;
    },
    async buildAuthorizationUrl(params) {
      const url = new URL('https://idp.test/realms/nms/protocol/openid-connect/auth');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('state', params.state);
      url.searchParams.set('nonce', params.nonce);
      return url.toString();
    },
    async exchangeCode() {
      // The nonce must match what /auth/login stored; we read it back from the pre-session via the
      // test flow, so mint with the SAME nonce the login used. We cannot see it here, so the flow
      // helper sets it — see completeLogin, which patches nonce through a closure.
      throw new Error('exchangeCode is set per-flow in completeLogin');
    },
    async refresh() {
      throw new Error('not used');
    },
    async buildEndSessionUrl({ idToken, postLogoutRedirectUri }) {
      const url = new URL('https://idp.test/realms/nms/protocol/openid-connect/logout');
      url.searchParams.set('id_token_hint', idToken);
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      return url.toString();
    }
  };
  void opts;
  return { oidc, issuedTokenIsValid: async () => {} };
}

function buildApp(oidc: OidcClient) {
  const redis = memoryRedis();
  const sessions = createSessionStore(redis, {
    idleTimeoutSeconds: 1800,
    absoluteLifetimeSeconds: 28800
  });
  const preSessions = createPreSessionStore(redis);
  const refreshIfNeeded = createRefreshIfNeeded({ oidc, sessions, logger });
  const requireSession = createRequireSession({ sessions, cookieName: COOKIE, refreshIfNeeded });
  const authRouter = createAuthRouter({
    oidc,
    preSessions,
    sessions,
    logger,
    cookieName: COOKIE,
    issuerUrl: TEST_OIDC.issuer,
    clientId: TEST_OIDC.audience,
    absoluteLifetimeSeconds: 28800,
    roleMap: ROLE_MAP,
    uiPostLoginPath: '/',
    postLogoutRedirectUri: 'https://ui.test/',
    requireSession,
    ensureUser: async () => {}
  });
  const app = createApp({
    logger,
    version: '0.1.0',
    routers: [],
    rootRouters: [authRouter],
    healthChecks: {} as never
  });
  return { app };
}

/**
 * Drives a full login: GET /auth/login to obtain state+cookie-less redirect, extract state, then
 * mint a token for that login's nonce and complete the callback. Returns the callback response
 * plus the resulting session cookie.
 */
async function completeLogin(groups: readonly string[]) {
  // A per-flow OIDC whose exchangeCode returns a freshly-minted token bound to the login's nonce.
  let pendingNonce: string | undefined;
  let madeJwks: Awaited<ReturnType<typeof makeToken>> | undefined;
  const oidc: OidcClient = {
    async discover() {
      return {
        authorization_endpoint: 'https://idp.test/realms/nms/protocol/openid-connect/auth',
        token_endpoint: 'https://idp.test/token',
        jwks_uri: 'https://idp.test/certs',
        end_session_endpoint: 'https://idp.test/realms/nms/protocol/openid-connect/logout',
        issuer: TEST_OIDC.issuer
      };
    },
    async getJwks() {
      if (!madeJwks) throw new Error('no token minted');
      return madeJwks.jwks;
    },
    async buildAuthorizationUrl(params) {
      pendingNonce = params.nonce;
      const url = new URL('https://idp.test/realms/nms/protocol/openid-connect/auth');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('state', params.state);
      url.searchParams.set('nonce', params.nonce);
      return url.toString();
    },
    async exchangeCode() {
      madeJwks = await makeToken({ nonce: pendingNonce!, groups });
      return {
        accessToken: 'server-side-access-token',
        refreshToken: 'server-side-refresh-token',
        idToken: madeJwks.token,
        accessTokenExpiresAt: Date.now() + 300_000
      };
    },
    async refresh() {
      throw new Error('not used');
    },
    async buildEndSessionUrl({ idToken, postLogoutRedirectUri }) {
      const url = new URL('https://idp.test/realms/nms/protocol/openid-connect/logout');
      url.searchParams.set('id_token_hint', idToken);
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      return url.toString();
    }
  };
  const { app } = buildApp(oidc);
  // We drive the pre-session lifecycle with a shared in-memory Redis via the SAME app instance,
  // so /auth/login and /auth/callback share state. The session cookie is `Secure`, so we extract
  // it from the callback and set it EXPLICITLY on follow-up requests (supertest's jar will not
  // resend a Secure cookie over the plaintext test transport).
  const login = await request(app).get('/auth/login');
  const authUrl = new URL(login.headers.location!);
  const state = authUrl.searchParams.get('state')!;
  const cb = await request(app).get(`/auth/callback?code=abc&state=${encodeURIComponent(state)}`);

  let cookie = '';
  const setCookie = cb.headers['set-cookie'] as unknown as string[] | undefined;
  if (setCookie && setCookie.length > 0) {
    cookie = setCookie[0]!.split(';')[0]!; // `name=value`
  }
  const agent = {
    get: (path: string) => request(app).get(path).set('Cookie', cookie),
    post: (path: string) => request(app).post(path).set('Cookie', cookie)
  };
  return { app, agent, cb, state };
}

describe('GET /auth/login', () => {
  it('redirects with code, S256 challenge, state, and nonce (AC-A#1)', async () => {
    const { oidc } = fakeOidc({ groups: ['nms-operator'] });
    const { app } = buildApp(oidc);
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location!);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
  });
});

describe('GET /auth/callback', () => {
  it('rejects a callback with an unknown state', async () => {
    const { oidc } = fakeOidc({ groups: ['nms-operator'] });
    const { app } = buildApp(oidc);
    const res = await request(app).get('/auth/callback?code=x&state=never-issued');
    expect(res.status).toBe(400);
  });

  it('creates a session and sets a Secure HttpOnly SameSite cookie, leaking NO token (AC-A#2)', async () => {
    const { cb } = await completeLogin(['nms-operator']);
    expect(cb.status).toBe(302);
    const setCookie = (cb.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // The response body/headers carry NO token material — only the opaque cookie.
    expect(JSON.stringify(cb.headers)).not.toMatch(/access_token|refresh_token|eyJ/);
    expect(JSON.stringify(cb.body)).not.toMatch(/access_token|refresh_token|eyJ/);
    // The cookie value is the opaque id, not a JWT.
    expect(setCookie).not.toMatch(/eyJ/);
  });

  it('denies a user whose groups map to nothing (fail closed → 403)', async () => {
    const { cb } = await completeLogin(['some-unmapped-group']);
    expect(cb.status).toBe(403);
    expect(cb.body.errors[0].code).toBe('FORBIDDEN');
  });

  it('rejects a replayed state (single use)', async () => {
    const { agent, state } = await completeLogin(['nms-operator']);
    // Re-using the same state after it was consumed must fail.
    const replay = await agent.get(`/auth/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(replay.status).toBe(400);
  });
});

describe('GET /api/v1/session', () => {
  it('returns role and presentation hints for a logged-in user', async () => {
    const { agent } = await completeLogin(['nms-operator']);
    const res = await agent.get('/api/v1/session');
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('operator');
    // Operator ack is DENIED (human decision): ack is a state-change gated to admin/engineer
    // server-side, so the capability hint must equal that gate — false for operator.
    expect(res.body.data.canAcknowledge).toBe(false);
    expect(res.body.data.canOpenAdminPortal).toBe(false);
    // No token ever appears in the session payload.
    expect(JSON.stringify(res.body)).not.toMatch(/access_token|refresh_token|eyJ/);
  });

  it('returns 401 without a session', async () => {
    const { oidc } = fakeOidc({ groups: ['nms-operator'] });
    const { app } = buildApp(oidc);
    const res = await request(app).get('/api/v1/session');
    expect(res.status).toBe(401);
    expect(res.body.errors[0].code).toBe('AUTH_REQUIRED');
  });
});

describe('POST /auth/logout (FR-18)', () => {
  it('destroys the session, clears the cookie, and redirects to IdP end_session', async () => {
    const { agent } = await completeLogin(['nms-engineer']);
    const out = await agent.post('/auth/logout').set('x-requested-with', 'nms-ui');
    expect(out.status).toBe(302);
    expect(out.headers.location).toContain('logout');
    const clear = (out.headers['set-cookie'] as unknown as string[]).join(';');
    expect(clear).toMatch(/Max-Age=0/i);
    // Session is gone — a follow-up call is unauthenticated.
    const after = await agent.get('/api/v1/session');
    expect(after.status).toBe(401);
  });

  it('rejects logout without the CSRF header', async () => {
    const { agent } = await completeLogin(['nms-operator']);
    const out = await agent.post('/auth/logout');
    expect(out.status).toBe(403);
  });
});
