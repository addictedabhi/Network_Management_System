/**
 * Session + role enforcement (ADR 0003, NFR-11, FR-17).
 *
 * `requireSession` resolves the opaque session id from the cookie (via `readSessionId`, so no
 * cookie-parser dependency and only the FIRST cookie occurrence is honoured), looks up the
 * server-side record, proactively refreshes it if the access token is near expiry, and puts the
 * record on `res.locals.session`. Every protected route mounts it.
 *
 * `requireRole` authorizes from the SERVER-SIDE session role ONLY (NFR-11) — never from anything
 * in the request. Hiding a UI control is presentation; this is the control.
 */
import type { RequestHandler } from 'express';
import type { PlatformRole } from '@nms/shared';
import { AppError } from './errorHandler.js';
import type { SessionStore, SessionRecord } from '../../auth/sessionStore.js';
import { readSessionId } from '../../auth/sessionCookie.js';

export interface RequireSessionDeps {
  readonly sessions: SessionStore;
  readonly cookieName: string;
  /** Proactively refreshes when near expiry; throws (session destroyed) on refresh failure. */
  readonly refreshIfNeeded: (id: string, record: SessionRecord) => Promise<SessionRecord>;
}

export function createRequireSession(deps: RequireSessionDeps): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const id = readSessionId(req.headers.cookie, deps.cookieName);
      if (!id) {
        next(new AppError('AUTH_REQUIRED', 'Authentication required.', 401));
        return;
      }
      const record = await deps.sessions.get(id);
      if (!record) {
        next(new AppError('AUTH_REQUIRED', 'Authentication required.', 401));
        return;
      }
      try {
        res.locals.session = await deps.refreshIfNeeded(id, record);
        res.locals.sessionId = id;
        next();
      } catch {
        // Refresh failed → the session was destroyed inside refreshIfNeeded. Tell the UI to
        // re-authenticate with a machine-readable code (FR-17).
        next(new AppError('SESSION_EXPIRED', 'Session expired. Please sign in again.', 401));
      }
    })();
  };
}

export function requireRole(...allowed: readonly PlatformRole[]): RequestHandler {
  return (_req, res, next) => {
    const session = res.locals.session as SessionRecord | undefined;
    if (!session) {
      next(new AppError('AUTH_REQUIRED', 'Authentication required.', 401));
      return;
    }
    if (!allowed.includes(session.role)) {
      next(new AppError('FORBIDDEN', 'You do not have permission to perform this action.', 403));
      return;
    }
    next();
  };
}

/**
 * Custom-header CSRF check for state-changing routes (ADR 0003). `SameSite=Lax` already blocks
 * cross-site POST; requiring a header a cross-site HTML form cannot set is defence in depth.
 */
export function requireCsrfHeader(headerName = 'x-requested-with'): RequestHandler {
  return (req, _res, next) => {
    if (!req.headers[headerName]) {
      next(new AppError('FORBIDDEN', 'Missing required request header.', 403));
      return;
    }
    next();
  };
}
