'use client';

/**
 * The AIRNMS-branded application header: the staged logo asset, the product name, primary nav, the
 * signed-in user, and the sign-out control. Sign-out is a form POST to the BFF logout route (which
 * clears the session cookie and redirects to Keycloak end-session), carrying the CSRF header the
 * BFF requires on state-changing routes.
 */
import Link from 'next/link';
import type { SessionInfo } from '@nms/shared';
import { LOGOUT_URL } from '../lib/bffClient';

/**
 * Gateway subpath the app is served under (baked at build via BASE_PATH; '/app' on the deployed
 * gateway, '' for a root-origin local run). Static assets in public/ are served at
 * `${BASE_PATH}/asset` — we prefix explicitly because a plain <img> src is not basePath-aware, and
 * the Next image optimizer does not prefix its internal `url=` query under a subpath (it 400s).
 */
const ASSET_PREFIX = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface AppHeaderProps {
  readonly session?: SessionInfo;
}

export function AppHeader({ session }: AppHeaderProps) {
  const signOut = () => {
    // A POST with the CSRF header the BFF requires. We use fetch then navigate to the returned
    // location so the header is set (a plain <form> cannot set x-requested-with).
    void fetch(LOGOUT_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-requested-with': 'nms-ui' }
    })
      .then((res) => {
        // The BFF returns a 302 to Keycloak end-session; fetch follows it opaquely. Do a hard
        // navigation to the custom UI (served at /app) so the user lands on a clean signed-out
        // state — NOT the gateway root, which is the native LibreNMS UI.
        window.location.assign('/app');
        return res;
      })
      .catch(() => window.location.assign('/app'));
  };

  return (
    <header className="app-header">
      <div className="app-header__brand">
        {/* Plain <img> with an explicit basePath-aware src. Avoids both the Next image optimizer
            (400s under a subpath because it does not prefix its `url=` query) and next/image's
            unoptimized path (emits a non-prefixed root src). The asset is served by our own web
            container at `${ASSET_PREFIX}/airnms_logo.png`. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${ASSET_PREFIX}/airnms_logo.png`} alt="AIRNMS" width={170} height={32} />
      </div>
      <nav className="app-header__nav" aria-label="Primary">
        <Link href="/devices">Inventory</Link>
        <Link href="/dashboard">Dashboard</Link>
      </nav>
      <div className="app-header__user">
        {session ? (
          <>
            <span className="app-header__whoami">
              {session.displayName} · <span className="role-chip">{session.role}</span>
            </span>
            <button type="button" className="btn btn--ghost" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
