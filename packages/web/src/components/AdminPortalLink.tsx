'use client';

/**
 * "Open Admin Portal" cross-link to the native LibreNMS UI (FR-40/42). Rendered only when the
 * session says `canOpenAdminPortal` (a PRESENTATION hint — the BFF re-checks the role server-side,
 * NFR-11). The target URL is fetched from the BFF, which builds it from server-side config; the
 * browser never learns the LibreNMS API path.
 *
 * Because the SSO session spans both UIs, following the link lands the operator in the native
 * admin portal without a second login.
 */
import { useState } from 'react';
import { bffClient } from '../lib/bffClient';

export interface AdminPortalLinkProps {
  readonly canOpenAdminPortal: boolean;
  readonly deviceId?: string;
}

export function AdminPortalLink({ canOpenAdminPortal, deviceId }: AdminPortalLinkProps) {
  const [error, setError] = useState<string | null>(null);
  if (!canOpenAdminPortal) return null;

  const open = async () => {
    setError(null);
    try {
      const { url } = await bffClient.getAdminPortalUrl(deviceId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('Could not open the admin portal.');
    }
  };

  return (
    <span className="admin-portal">
      <button type="button" className="btn btn--secondary" onClick={open}>
        Open Admin Portal
      </button>
      {error ? (
        <span role="alert" className="admin-portal__error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
