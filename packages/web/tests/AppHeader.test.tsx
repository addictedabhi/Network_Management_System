import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionInfo } from '@nms/shared';
import { AppHeader } from '../src/components/AppHeader';
import { bffClient } from '../src/lib/bffClient';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    username: 'test-eng',
    displayName: 'Test Engineer',
    role: 'engineer',
    canAcknowledge: true,
    canOpenAdminPortal: true,
    ...overrides
  };
}

describe('AppHeader admin-portal nav link (FR-40/42)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the admin-portal nav link when the session may open it (engineer/admin)', () => {
    render(<AppHeader session={makeSession({ canOpenAdminPortal: true })} />);
    expect(screen.getByRole('button', { name: /open admin portal/i })).toBeInTheDocument();
  });

  it('hides the admin-portal nav link when the session may not open it (readonly/operator)', () => {
    render(<AppHeader session={makeSession({ role: 'readonly', canOpenAdminPortal: false })} />);
    expect(screen.queryByRole('button', { name: /open admin portal/i })).not.toBeInTheDocument();
  });

  it('does not render the admin-portal nav link when there is no session', () => {
    render(<AppHeader />);
    expect(screen.queryByRole('button', { name: /open admin portal/i })).not.toBeInTheDocument();
  });

  it('opens the BFF-provided URL in a new tab (same target the in-body button used)', async () => {
    const spy = vi
      .spyOn(bffClient, 'getAdminPortalUrl')
      .mockResolvedValue({ url: 'https://host/librenms' });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<AppHeader session={makeSession({ canOpenAdminPortal: true })} />);
    await userEvent.click(screen.getByRole('button', { name: /open admin portal/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(openSpy).toHaveBeenCalledWith(
      'https://host/librenms',
      '_blank',
      expect.stringContaining('noopener')
    );
  });
});
