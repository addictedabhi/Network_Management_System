/**
 * OIDC auth routes (ADR 0003, FR-10..19; team-config §8 Keycloak `nms` realm).
 *
 *   GET  /auth/login    — start Authorization Code + PKCE; 302 to Keycloak.
 *   GET  /auth/callback — exchange code → tokens server-side, validate the id_token, map groups →
 *                         role, create the opaque session, set the HttpOnly;Secure;SameSite cookie.
 *   POST /auth/logout   — destroy the Redis session, clear the cookie, redirect to IdP end-session.
 *   GET  /api/v1/session — return SessionInfo (presentation hints only).
 *
 * SECURITY FLOOR: tokens are created and stored SERVER-SIDE (in the session record). The response
 * to the browser carries ONLY the opaque session cookie — no access/refresh/id token, no secret.
 */
import { Router, type RequestHandler } from 'express';
import type { ApiSuccess, SessionInfo, PlatformRole } from '@nms/shared';
import { AppError } from '../middleware/errorHandler.js';
import { serializeSessionCookie, clearSessionCookie } from '../../auth/sessionCookie.js';
import { createLoginIntegrity } from '../../auth/pkce.js';
import type { OidcClient } from '../../auth/oidcClient.js';
import { verifyIdToken, extractGroups } from '../../auth/tokenVerifier.js';
import { mapGroupsToRole, roleToLibreNmsLevel, canAcknowledge, canOpenAdminPortal } from '../../auth/roleMap.js';
import type { PreSessionStore } from '../../auth/preSessionStore.js';
import type { SessionStore, SessionRecord } from '../../auth/sessionStore.js';
import type { Logger } from '../../observability/logger.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { requireCsrfHeader } from '../middleware/auth.js';

/** Access-token refresh skew: refresh when within this window of expiry (FR-17). */
const REFRESH_SKEW_MS = 60_000;

export interface AuthRoutesDeps {
  readonly oidc: OidcClient;
  readonly preSessions: PreSessionStore;
  readonly sessions: SessionStore;
  readonly logger: Logger;
  readonly cookieName: string;
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly absoluteLifetimeSeconds: number;
  /** IdP group → platform role map (FR-15). Drives fail-closed authorization at callback. */
  readonly roleMap: Readonly<Record<string, string>>;
  /** Where to send the browser after login / after IdP logout — the UI base path. */
  readonly uiPostLoginPath: string;
  readonly postLogoutRedirectUri: string;
  /** Session middleware — mounted on the session + logout routes so a session is required. */
  readonly requireSession: RequestHandler;
  /** Provisions/updates the LibreNMS user at the mapped level (FR-16). */
  readonly ensureUser: (username: string, level: number) => Promise<void>;
}

export function toSessionInfo(record: SessionRecord): SessionInfo {
  return {
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    canAcknowledge: canAcknowledge(record.role),
    canOpenAdminPortal: canOpenAdminPortal(record.role)
  };
}

/**
 * Builds the proactive-refresh function the session middleware calls. On refresh failure the
 * session is DESTROYED and the error propagates → the caller answers 401 SESSION_EXPIRED (FR-17).
 */
export function createRefreshIfNeeded(deps: {
  oidc: OidcClient;
  sessions: SessionStore;
  logger: Logger;
}) {
  return async function refreshIfNeeded(
    id: string,
    record: SessionRecord
  ): Promise<SessionRecord> {
    if (record.accessTokenExpiresAt - Date.now() > REFRESH_SKEW_MS) return record;
    try {
      const tokens = await deps.oidc.refresh(record.refreshToken);
      const patch: Partial<SessionRecord> = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt
      };
      await deps.sessions.update(id, patch);
      return { ...record, ...patch };
    } catch {
      await deps.sessions.destroy(id);
      throw new AppError('SESSION_EXPIRED', 'Session expired. Please sign in again.', 401);
    }
  };
}

export function createAuthRouter(deps: AuthRoutesDeps): Router {
  const router = Router();
  const callbackLimiter = createRateLimiter({ windowMs: 60_000, max: 20, bucket: 'auth-callback' });

  // GET /auth/login — 302 to Keycloak with S256 challenge, state, nonce (AC-A#1).
  router.get('/auth/login', (_req, res, next) => {
    void (async () => {
      try {
        const integrity = createLoginIntegrity();
        await deps.preSessions.put(integrity.state, {
          nonce: integrity.nonce,
          codeVerifier: integrity.codeVerifier
        });
        const url = await deps.oidc.buildAuthorizationUrl({
          state: integrity.state,
          nonce: integrity.nonce,
          codeChallenge: integrity.codeChallenge
        });
        res.redirect(302, url);
      } catch (err) {
        next(err);
      }
    })();
  });

  // GET /auth/callback — the code→token exchange + session creation.
  router.get('/auth/callback', callbackLimiter, (req, res, next) => {
    void (async () => {
      try {
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const state = typeof req.query.state === 'string' ? req.query.state : '';
        if (!code || !state) {
          throw new AppError('VALIDATION_ERROR', 'Missing authorization parameters.', 400);
        }
        // Single-use: consume deletes the pre-session. A replayed/unknown state finds nothing.
        const pre = await deps.preSessions.consume(state);
        if (!pre) throw new AppError('VALIDATION_ERROR', 'Invalid or expired login state.', 400);

        const tokens = await deps.oidc.exchangeCode({ code, codeVerifier: pre.codeVerifier });
        const jwks = await deps.oidc.getJwks();
        const claims = await verifyIdToken(tokens.idToken, {
          issuer: deps.issuerUrl,
          audience: deps.clientId,
          nonce: pre.nonce,
          jwks
        });

        const role = mapGroupsToRole(extractGroups(claims), deps.roleMap);
        if (!role) {
          // Fail closed — an unmapped identity is denied entirely (ADR 0003).
          deps.logger.audit({
            actor: String(claims.preferred_username ?? claims.sub),
            action: 'login',
            target: 'nms',
            outcome: 'denied',
            correlationId: String(res.locals.correlationId ?? 'unknown')
          });
          throw new AppError('FORBIDDEN', 'Your account has no assigned NMS role.', 403);
        }

        const username = String(claims.preferred_username ?? claims.sub);
        const displayName = String(claims.name ?? username);

        // FR-16: provision/update the LibreNMS user at the mapped level. Best-effort — a
        // provisioning failure must not strand a validly-authenticated user; it is logged.
        try {
          await deps.ensureUser(username, roleToLibreNmsLevel(role));
        } catch {
          deps.logger.warn('librenms ensureUser failed during login; continuing', { username });
        }

        const sessionId = await deps.sessions.create({
          username,
          displayName,
          subject: claims.sub,
          role,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          idpIdToken: tokens.idToken,
          idpSid: typeof claims.sid === 'string' ? claims.sid : ''
        });

        res.setHeader(
          'Set-Cookie',
          serializeSessionCookie(deps.cookieName, sessionId, {
            maxAgeSeconds: deps.absoluteLifetimeSeconds
          })
        );
        deps.logger.audit({
          actor: username,
          action: 'login',
          target: 'nms',
          outcome: 'success',
          correlationId: String(res.locals.correlationId ?? 'unknown')
        });
        res.redirect(302, deps.uiPostLoginPath);
      } catch (err) {
        next(err);
      }
    })();
  });

  // POST /auth/logout — session + CSRF header required; destroy session, clear cookie, redirect
  // to the IdP end-session endpoint so the IdP session is torn down too (FR-18, AC-A#7).
  router.post(
    '/auth/logout',
    deps.requireSession,
    requireCsrfHeader(),
    (_req, res, next) => {
      void (async () => {
        try {
          const session = res.locals.session as SessionRecord;
          const sessionId = res.locals.sessionId as string;
          // Destroy server-side FIRST so the opaque id can never be resumed even if the cookie
          // survives in a browser.
          await deps.sessions.destroy(sessionId);
          res.setHeader('Set-Cookie', clearSessionCookie(deps.cookieName));
          deps.logger.audit({
            actor: session.username,
            action: 'logout',
            target: 'nms',
            outcome: 'success',
            correlationId: String(res.locals.correlationId ?? 'unknown')
          });
          const endSession = await deps.oidc.buildEndSessionUrl({
            idToken: session.idpIdToken,
            postLogoutRedirectUri: deps.postLogoutRedirectUri
          });
          // If the IdP advertises no end_session_endpoint, fall back to the post-logout URI so the
          // browser still lands somewhere sane — the server session is already gone.
          res.redirect(302, endSession ?? deps.postLogoutRedirectUri);
        } catch (err) {
          next(err);
        }
      })();
    }
  );

  // GET /api/v1/session — session required; SessionInfo, presentation hints only (NFR-11).
  router.get('/api/v1/session', deps.requireSession, (_req, res) => {
    const session = res.locals.session as SessionRecord;
    const body: ApiSuccess<SessionInfo> = { success: true, data: toSessionInfo(session) };
    res.status(200).json(body);
  });

  return router;
}

