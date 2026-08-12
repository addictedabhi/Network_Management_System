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

  it('exposes the Phase 3 primary nav with the Dashboards group first, then Inventory, Alarms, Links, and no standalone Dashboard link', () => {
    render(<AppHeader session={makeSession()} />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    // The standalone top-level Dashboard link is GONE: no anchor whose sole text is
    // exactly "Dashboard" pointing at /dashboard. (The group summary is a <summary>, not an
    // anchor, and the in-group link to /dashboard reads "Operational", so neither matches.)
    const dashboardAnchors = Array.from(nav.querySelectorAll('a')).filter(
      (a) => a.textContent === 'Dashboard'
    );
    expect(dashboardAnchors).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();

    // Assert each primary link resolves to its expected target.
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute('href', '/devices');
    expect(screen.getByRole('link', { name: 'Alarms' })).toHaveAttribute('href', '/alarms');
    expect(screen.getByRole('link', { name: 'Links' })).toHaveAttribute('href', '/links');

    // The Dashboards group is the FIRST primary nav item: its <summary> precedes every
    // primary anchor in document order.
    const summary = screen.getByText('Dashboards');
    expect(summary.tagName.toLowerCase()).toBe('summary');
    const orderedNodes = Array.from(nav.querySelectorAll('summary, a'));
    const groupPos = orderedNodes.indexOf(summary);
    expect(groupPos).toBe(0); // Dashboards group first

    // Prove the remaining left-to-right order: Inventory, Alarms, Links after the group.
    const anchorNames = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    const positions = ['Inventory', 'Alarms', 'Links'].map((name) => anchorNames.indexOf(name));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // Group contents stay exactly as before (My Dashboard/Operational/Capacity/Top talkers/Fleet trends).
    expect(screen.getByRole('link', { name: 'My Dashboard' })).toHaveAttribute('href', '/dashboards/custom');
    expect(screen.getByRole('link', { name: 'Operational' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Capacity' })).toHaveAttribute('href', '/dashboards/capacity');
    expect(screen.getByRole('link', { name: 'Top talkers' })).toHaveAttribute('href', '/dashboards/top-talkers');
    expect(screen.getByRole('link', { name: 'Fleet trends' })).toHaveAttribute('href', '/dashboards/fleet-trends');
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
