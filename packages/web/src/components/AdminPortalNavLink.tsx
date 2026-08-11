'use client';

/**
 * "Open Admin Portal" cross-link to the native LibreNMS UI (FR-40/42), rendered in the primary
 * header nav so it is present on EVERY page with one canonical placement (no in-body duplicates).
 *
 * `canOpenAdminPortal` is a PRESENTATION hint only — the BFF re-checks the role server-side on the
 * `/api/v1/admin-portal-url` call (NFR-11), so readonly/operator are denied there regardless. We
 * gate the nav link the SAME way the former in-body button was gated: if the session may not open
 * it, the link is not offered at all.
 *
 * The target URL is fetched from the BFF (built from server-side config; the browser never learns
 * the LibreNMS path) and opened in a new tab — matching the in-body button's behaviour exactly.
 */
import { useState } from 'react';
import { bffClient } from '../lib/bffClient';

export interface AdminPortalNavLinkProps {
  readonly canOpenAdminPortal: boolean;
}

export function AdminPortalNavLink({ canOpenAdminPortal }: AdminPortalNavLinkProps) {
  const [error, setError] = useState(false);
  if (!canOpenAdminPortal) return null;

  const open = async () => {
    setError(false);
    try {
      const { url } = await bffClient.getAdminPortalUrl();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(true);
    }
  };

  return (
    <button
      type="button"
      className="app-header__admin-link"
      onClick={open}
      title={error ? 'Could not open the admin portal — try again.' : 'Open the native admin portal'}
      aria-label={error ? 'Open Admin Portal (last attempt failed, try again)' : 'Open Admin Portal'}
    >
      Open Admin Portal
    </button>
  );
}
