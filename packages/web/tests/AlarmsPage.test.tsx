import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import AlarmsPage from '../src/app/alarms/page';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Override the session so the ack gate can be tested for a non-privileged role. */
function sessionAs(role: string, canAcknowledge: boolean) {
  server.use(
    http.get('/bff/api/v1/session', () =>
      HttpResponse.json({
        success: true,
        data: {
          username: 'u',
          displayName: 'U',
          role,
          canAcknowledge,
          canOpenAdminPortal: false
        }
      })
    )
  );
}

describe('Alarm console page (Phase 3 a)', () => {
  it('lists the real active alarms in a table', async () => {
    render(<AlarmsPage />);
    expect(await screen.findByText('NMS: Device down')).toBeInTheDocument();
    expect(screen.getByText('NMS: High CPU utilisation')).toBeInTheDocument();
  });

  it('shows the Acknowledge button for engineer (canAcknowledge)', async () => {
    render(<AlarmsPage />);
    // MSW default session is an engineer with canAcknowledge: true.
    expect(await screen.findAllByRole('button', { name: /acknowledge/i })).not.toHaveLength(0);
  });

  it('HIDES the Acknowledge button for a readonly session (presentation only; 403 is the control)', async () => {
    sessionAs('readonly', false);
    render(<AlarmsPage />);
    await screen.findByText('NMS: Device down');
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
  });

  it('opens the per-alarm history timeline on demand', async () => {
    render(<AlarmsPage />);
    const rows = await screen.findAllByRole('row');
    // Find the "Device down" alarm's row (alarm id 1 → has a real timeline in MSW).
    const downRow = rows.find((r) => within(r).queryByText('NMS: Device down'));
    await userEvent.click(within(downRow!).getByRole('button', { name: /history/i }));
    // The timeline detail text is unambiguous (the "Raised" label collides with a table header).
    expect(await screen.findByText('ICMP unreachable')).toBeInTheDocument();
  });
});
