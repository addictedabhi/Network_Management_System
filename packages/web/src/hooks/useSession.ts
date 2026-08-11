'use client';

/**
 * Loads the current SessionInfo from the BFF. A 401 means "not logged in" → the app shell sends
 * the browser to the BFF login (a top-level navigation, so Keycloak's redirect works). The session
 * carries ONLY presentation hints (role, capability flags); the BFF re-derives authorization on
 * every request (NFR-11).
 */
import { useEffect, useState } from 'react';
import type { SessionInfo } from '@nms/shared';
import { bffClient, BffError, LOGIN_URL } from '../lib/bffClient';

export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; session: SessionInfo }
  | { status: 'unauthenticated' }
  | { status: 'error'; code: string };

export function useSession(redirectOnUnauthenticated = false): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    bffClient
      .getSession()
      .then((session) => {
        if (!cancelled) setState({ status: 'authenticated', session });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = err instanceof BffError ? err.code : 'INTERNAL_ERROR';
        if (err instanceof BffError && (err.status === 401 || code === 'SESSION_EXPIRED')) {
          if (redirectOnUnauthenticated && typeof window !== 'undefined') {
            window.location.assign(LOGIN_URL);
            return;
          }
          setState({ status: 'unauthenticated' });
          return;
        }
        setState({ status: 'error', code });
      });
    return () => {
      cancelled = true;
    };
  }, [redirectOnUnauthenticated]);

  return state;
}
