import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { server } from './msw/server';
import { DeviceMetricCard } from '../src/components/DeviceMetricCard';
import { available, type Device } from '@nms/shared';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const af60 = (id: string, name: string): Device => ({
  id,
  hostname: name,
  displayName: name,
  kind: 'p2p',
  location: 'roof',
  reachability: 'up',
  uptimeSeconds: available(1000)
});

describe('DeviceMetricCard — live metrics from the BFF (MSW)', () => {
  it('shows an available RSSI and SNR for the healthy AF60 (device 3)', async () => {
    render(<DeviceMetricCard device={af60('3', 'AF60 radio')} />);
    // RSSI -58, SNR 31 both become available values.
    await waitFor(() => expect(screen.getByText(/-58/)).toBeInTheDocument());
    expect(screen.getByText(/31/)).toBeInTheDocument();
  });

  it('shows RSSI as "Not available" (never 0) for the withheld AF60 (device 4) — FR-24', async () => {
    render(<DeviceMetricCard device={af60('4', 'AF60 (RSSI withheld)')} />);
    // RSSI row resolves to unavailable; SNR still shows.
    await waitFor(() => expect(screen.getByText(/31/)).toBeInTheDocument());
    const notAvailable = screen.getAllByText(/not available/i);
    expect(notAvailable.length).toBeGreaterThanOrEqual(1);
    // The honest state: no fabricated 0 for the withheld RSSI.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0 dBm')).not.toBeInTheDocument();
  });
});
