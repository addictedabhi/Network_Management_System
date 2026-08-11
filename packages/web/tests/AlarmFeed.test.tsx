import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { AlarmFeed } from '../src/components/dashboard/AlarmFeed';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AlarmFeed (FR-30/32/34)', () => {
  it('shows the 2 REAL alarms that fired', async () => {
    render(<AlarmFeed canAcknowledge={false} />);
    expect(await screen.findByText('NMS: Device down')).toBeInTheDocument();
    expect(screen.getByText('NMS: High CPU utilisation')).toBeInTheDocument();
  });

  it('shows an honest empty state (not error) when a severity filter yields none', async () => {
    render(<AlarmFeed canAcknowledge={false} />);
    await screen.findByText('NMS: Device down');
    await userEvent.click(screen.getByRole('button', { name: 'Ok' }));
    expect(await screen.findByText('No active alarms.')).toBeInTheDocument();
    // Empty is distinct from error — no alert role for the empty case.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an error state (not empty) when the backend fails', async () => {
    server.use(
      http.get('/bff/api/v1/alarms', () =>
        HttpResponse.json(
          { success: false, errors: [{ code: 'UPSTREAM_UNAVAILABLE', message: 'x' }], meta: { requestId: 'r' } },
          { status: 503 }
        )
      )
    );
    render(<AlarmFeed canAcknowledge={false} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('hides Acknowledge for a non-privileged role (server is still the gate)', async () => {
    render(<AlarmFeed canAcknowledge={false} />);
    await screen.findByText('NMS: Device down');
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
  });

  it('shows Acknowledge for a privileged role', async () => {
    render(<AlarmFeed canAcknowledge={true} />);
    await screen.findByText('NMS: Device down');
    expect(screen.getAllByRole('button', { name: /acknowledge/i }).length).toBeGreaterThan(0);
  });

  it('never fabricates an acknowledger identity when acknowledgedBy is null (FR-32)', async () => {
    server.use(
      http.get('/bff/api/v1/alarms', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              id: '99',
              deviceId: '5',
              deviceHostname: 'sim-radio-01',
              deviceKind: 'p2p',
              entity: null,
              severity: 'critical',
              ruleName: 'RSSI below threshold',
              firstRaisedAt: '2026-08-11T00:00:00Z',
              durationSeconds: 600,
              acknowledged: true,
              acknowledgedBy: null,
              acknowledgedAt: '2026-08-11T00:10:00Z'
            }
          ],
          meta: { page: 1, perPage: 50, total: 1, hasNext: false }
        })
      )
    );
    render(<AlarmFeed canAcknowledge={true} />);
    await screen.findByText('RSSI below threshold');
    // Must NOT invent a role/identity for an unknown acknowledger.
    expect(screen.queryByText(/ack by operator/i)).not.toBeInTheDocument();
    // An honest fallback is shown instead.
    expect(screen.getByText(/ack by unknown/i)).toBeInTheDocument();
  });
});
