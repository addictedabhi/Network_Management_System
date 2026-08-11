'use client';

/**
 * Wraps an authenticated page: resolves the session (redirecting to the BFF login when absent),
 * renders the AIRNMS header, and hands the resolved SessionInfo to the page via a render prop.
 * A single place for the loading / unauthenticated / error states so no page renders a blank shell.
 */
import type { ReactNode } from 'react';
import type { SessionInfo } from '@nms/shared';
import { useSession } from '../hooks/useSession';
import { AppHeader } from './AppHeader';

export interface AuthedShellProps {
  readonly children: (session: SessionInfo) => ReactNode;
}

export function AuthedShell({ children }: AuthedShellProps) {
  const state = useSession(true);

  if (state.status === 'loading' || state.status === 'unauthenticated') {
    return (
      <>
        <AppHeader />
        <main>
          <div role="status" aria-live="polite" className="data-state">
            {state.status === 'unauthenticated' ? 'Redirecting to sign in…' : 'Loading…'}
          </div>
        </main>
      </>
    );
  }

  if (state.status === 'error') {
    return (
      <>
        <AppHeader />
        <main>
          <div role="alert" className="data-state data-state--error">
            Could not load your session. Please refresh the page.
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader session={state.session} />
      <main>{children(state.session)}</main>
    </>
  );
}
