import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { DeviceKpiPanel } from '../src/components/DeviceKpiPanel';
import { available, unavailable, type Device } from '@nms/shared';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const radio: Device = {
  id: '4', hostname: 'sim-af60-withheld', displayName: 'AF60 (RSSI withheld)', kind: 'p2p', location: 'roof', reachability: 'up', uptimeSeconds: available(4243)
};
const pingHost: Device = {
  id: '2', hostname: 'ping-host', displayName: 'ping-host', kind: 'other', location: null, reachability: 'down', uptimeSeconds: unavailable('NO_DATA')
};

describe('DeviceKpiPanel (FR-24)', () => {
  it('renders a KPI as "Not available" when the metric is absent, never 0', async () => {
    render(<DeviceKpiPanel device={radio} />);
    const panel = screen.getByTestId('kpi-panel');
    // Device 4 RSSI is withheld in the mock → Not available.
    expect(await within(panel).findByText(/not available/i)).toBeInTheDocument();
  });

  it('shows the ICMP-only note for a down ping host with no uptime, never zeros', () => {
    render(<DeviceKpiPanel device={pingHost} />);
    expect(screen.getByText(/ICMP only/i)).toBeInTheDocument();
    // No CPU/mem rows are rendered at all for the ping host.
    expect(screen.queryByText('CPU')).not.toBeInTheDocument();
  });
});
