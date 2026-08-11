import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TopInterfaces } from '../src/components/dashboard/TopInterfaces';
import { available, type Device } from '@nms/shared';
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const range = { from: '2026-08-11T00:00:00Z', to: '2026-08-11T01:00:00Z', step: '5m' };
const devices: Device[] = [
  { id: '1', hostname: 'sim-switch', displayName: 'sim-switch', kind: 'switch', location: 'lab', reachability: 'up', uptimeSeconds: available(1) }
];

describe('TopInterfaces (FR-26/28)', () => {
  it('ranks interfaces by real 95th-percentile throughput', async () => {
    render(<TopInterfaces devices={devices} range={range} />);
    // Device 1 has real points (100, 220) → a real rate appears for in + out.
    expect(await screen.findByText(/sim-switch \(in\)/)).toBeInTheDocument();
    expect(screen.getByText(/sim-switch \(out\)/)).toBeInTheDocument();
    expect(screen.getByText(/95th-percentile/i)).toBeInTheDocument();
  });

  it('shows an honest empty state when no series has data', async () => {
    server.use(
      http.get('/bff/api/v1/devices/:id/metrics/series', ({ params, request }) => {
        const metric = new URL(request.url).searchParams.get('metric')!;
        return HttpResponse.json({ success: true, data: { metric, deviceId: params.id, points: [] } });
      })
    );
    render(<TopInterfaces devices={devices} range={range} />);
    expect(await screen.findByText(/no interface throughput data collected/i)).toBeInTheDocument();
  });
});
