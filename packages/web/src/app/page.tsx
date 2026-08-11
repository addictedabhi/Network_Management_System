'use client';

/**
 * Landing route. If a session exists, go to the inventory; otherwise send the browser to the BFF
 * login (a top-level navigation so Keycloak's redirect chain works). No data is shown here.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../hooks/useSession';

export default function HomePage() {
  const router = useRouter();
  const state = useSession(true); // redirect to BFF login when unauthenticated

  useEffect(() => {
    if (state.status === 'authenticated') router.replace('/devices');
  }, [state, router]);

  return (
    <main>
      <div role="status" aria-live="polite" className="data-state">
        Loading AIRNMS…
      </div>
    </main>
  );
}
