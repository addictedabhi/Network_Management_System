import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { DeviceInterfacesPanel } from '../src/components/DeviceInterfacesPanel';

// The BFF is mocked at the HTTP boundary (MSW) — the correct seam, never the bffClient module.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const IFACES_PATH = '/bff/api/v1/devices/:id/interfaces';

describe('DeviceInterfacesPanel (FR-39/FR-43) — three distinct states', () => {
  it('renders the HONEST empty state for a device with no interfaces (total:0), NOT an error', async () => {
    // A ping-only host with no SNMP: the BFF maps LibreNMS "No ports found" to an empty page, so
    // the panel receives data:[] and must show the empty message — never the backend-error alert.
    server.use(
      http.get(IFACES_PATH, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, perPage: 100, total: 0, hasNext: false }
        })
      )
    );
    render(<DeviceInterfacesPanel id="7" />);
    await waitFor(() =>
      expect(screen.getByText(/no interfaces available for this device/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the ERROR state (not empty) on a true upstream failure', async () => {
    server.use(
      http.get(IFACES_PATH, () =>
        HttpResponse.json(
          { success: false, errors: [{ code: 'UPSTREAM_ERROR', message: 'boom' }] },
          { status: 502 }
        )
      )
    );
    render(<DeviceInterfacesPanel id="7" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/returned an error/i);
    expect(screen.queryByText(/no interfaces available/i)).not.toBeInTheDocument();
  });

  it('renders the interface rows on a successful non-empty result', async () => {
    server.use(
      http.get(IFACES_PATH, () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: '11',
              deviceId: '1',
              name: 'eth0',
              adminState: 'up',
              operState: 'up',
              inOctetsRate: { status: 'available', value: 1000, timestamp: '2026-08-10T00:00:00Z' },
              outOctetsRate: { status: 'available', value: 2000, timestamp: '2026-08-10T00:00:00Z' }
            }
          ],
          meta: { page: 1, perPage: 100, total: 1, hasNext: false }
        })
      )
    );
    render(<DeviceInterfacesPanel id="1" />);
    await waitFor(() => expect(screen.getByText('eth0')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/no interfaces available/i)).not.toBeInTheDocument();
  });
});
