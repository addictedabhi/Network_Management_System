import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { available, type Device } from '@nms/shared';
import { server } from './msw/server';

let lastOption: unknown = null;
vi.mock('../src/components/EChart', () => ({
  EChart: (props: { option: unknown; ariaLabel: string }) => {
    lastOption = props.option;
    return <div data-testid="echart" aria-label={props.ariaLabel} />;
  }
}));

import { ThroughputChart } from '../src/components/dashboard/ThroughputChart';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const range = { from: '2026-08-11T00:00:00Z', to: '2026-08-11T01:00:00Z', step: '5m' };
const dev: Device = {
  id: '1', hostname: 'sim-switch', displayName: 'sim-switch', kind: 'switch', location: 'lab', reachability: 'up', uptimeSeconds: available(1)
};

describe('ThroughputChart (FR-22)', () => {
  it('plots the real in/out series points', async () => {
    render(<ThroughputChart device={dev} range={range} />);
    await screen.findByTestId('echart');
    const opt = lastOption as { series: { name: string; data: [number, number][] }[] };
    const inSeries = opt.series.find((s) => s.name === 'In')!;
    expect(inSeries.data.length).toBe(2);
    expect(inSeries.data[0]![1]).toBe(100);
  });

  it('shows an honest empty state (not a fabricated 0 line) when there are no points', async () => {
    server.use(
      http.get('/bff/api/v1/devices/:id/metrics/series', ({ params, request }) => {
        const metric = new URL(request.url).searchParams.get('metric')!;
        return HttpResponse.json({ success: true, data: { metric, deviceId: params.id, points: [] } });
      })
    );
    render(<ThroughputChart device={dev} range={range} />);
    expect(await screen.findByText(/no data points in this window/i)).toBeInTheDocument();
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument();
  });
});
