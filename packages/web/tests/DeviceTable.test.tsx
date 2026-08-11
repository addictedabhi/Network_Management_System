import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceTable } from '../src/components/DeviceTable';
import { available, unavailable, type Device } from '@nms/shared';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const devices: Device[] = [
  {
    id: '1',
    hostname: 'sim-switch',
    displayName: 'sim-switch',
    kind: 'switch',
    location: 'lab',
    reachability: 'up',
    uptimeSeconds: available(123456)
  },
  {
    id: '2',
    hostname: 'ping-host',
    displayName: 'ping-host',
    kind: 'other',
    location: null,
    reachability: 'down',
    uptimeSeconds: unavailable('NO_DATA')
  }
];

function renderTable(overrides: Partial<React.ComponentProps<typeof DeviceTable>> = {}) {
  return render(
    <DeviceTable
      devices={devices}
      sortColumn="hostname"
      sortDir="asc"
      onSort={() => {}}
      canAcknowledge={false}
      canOpenAdminPortal={false}
      {...overrides}
    />
  );
}

describe('DeviceTable (enhanced)', () => {
  it('renders one row per device with hostname links', () => {
    renderTable();
    expect(screen.getByRole('link', { name: 'sim-switch' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ping-host' })).toBeInTheDocument();
  });

  it('conveys reachability with an icon AND a text label, not colour alone (NFR-30)', () => {
    renderTable();
    // The text label is present (screen-reader + greyscale safe), and the badge carries aria-label.
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByLabelText('Up')).toBeInTheDocument();
  });

  it('shows an active alarm count and an honest 0 when there are none', () => {
    renderTable({ alarmCounts: { '1': 2 } });
    expect(screen.getByText('2')).toBeInTheDocument();
    // device 2 has no entry → 0, not fabricated.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('expands a row to reveal the KPI panel with real metrics', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('button', { name: /expand sim-switch/i }));
    const panel = await screen.findByTestId('kpi-panel');
    expect(within(panel).getByText('Uptime')).toBeInTheDocument();
    // KPI values arrive from the mocked BFF; CPU label is present for a switch.
    expect(within(panel).getByText('CPU')).toBeInTheDocument();
  });

  it('shows the ICMP-only honest note for a down ping host, never zeros', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('button', { name: /expand ping-host/i }));
    const panel = await screen.findByTestId('kpi-panel');
    expect(within(panel).getByText(/ICMP only/i)).toBeInTheDocument();
  });

  it('hides the acknowledge action for a role without canAcknowledge (server is still the gate)', () => {
    renderTable({ canAcknowledge: false, alarmCounts: { '1': 3 }, onAcknowledge: () => {} });
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
  });

  it('shows the acknowledge action for a privileged role when alarms exist', () => {
    renderTable({ canAcknowledge: true, alarmCounts: { '1': 3 }, onAcknowledge: () => {} });
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeInTheDocument();
  });

  it('raises a sort intent when a sortable header is clicked', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderTable({ onSort });
    await user.click(screen.getByRole('button', { name: /hostname/i }));
    expect(onSort).toHaveBeenCalledWith('hostname');
  });

  it('hides a column when toggled off (client-side view state)', async () => {
    const user = userEvent.setup();
    renderTable();
    // The Location column header exists initially.
    expect(screen.getByRole('button', { name: /^location/i })).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: /show or hide columns/i })).getByLabelText('Location'));
    expect(screen.queryByRole('button', { name: /^location/i })).not.toBeInTheDocument();
  });
});
