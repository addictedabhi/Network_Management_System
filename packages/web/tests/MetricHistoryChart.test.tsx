import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';

let lastOption: unknown = null;
vi.mock('../src/components/EChart', () => ({
  EChart: (props: { option: unknown; ariaLabel: string }) => {
    lastOption = props.option;
    return <div data-testid="echart" aria-label={props.ariaLabel} />;
  }
}));

import { MetricHistoryChart } from '../src/components/device/MetricHistoryChart';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const range = { from: '2026-08-11T00:00:00Z', to: '2026-08-11T01:00:00Z', step: '5m' };

describe('MetricHistoryChart (Phase 3 c, FR-22)', () => {
  it('plots the real CPU history line', async () => {
    render(<MetricHistoryChart deviceId="1" hostname="sim-switch" metric="cpuUsage" label="CPU" unit="%" range={range} />);
    await screen.findByTestId('echart');
    const opt = lastOption as { series: { data: [number, number][] }[] };
    expect(opt.series[0]!.data.length).toBe(2);
    expect(opt.series[0]!.data[0]![1]).toBe(100);
  });

  it('shows an honest EMPTY state (never a fabricated 0 line) when the series is absent', async () => {
    // Device 2 is the ping-only host — no CPU series in MSW → genuine empty (not a fabricated 0).
    render(<MetricHistoryChart deviceId="2" hostname="ping-host" metric="cpuUsage" label="CPU" range={range} />);
    expect(await screen.findByText(/no cpu data points in this window/i)).toBeInTheDocument();
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument();
  });

  it('shows the ERROR state (distinct from empty) when the backend fails', async () => {
    server.use(
      http.get('/bff/api/v1/devices/:id/metrics/series', () =>
        HttpResponse.json({ success: false, errors: [{ code: 'UPSTREAM_UNAVAILABLE', message: 'down' }], meta: { requestId: 'x' } }, { status: 503 })
      )
    );
    render(<MetricHistoryChart deviceId="1" hostname="sim-switch" metric="cpuUsage" label="CPU" range={range} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
