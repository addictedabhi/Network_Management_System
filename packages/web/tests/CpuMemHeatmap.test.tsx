import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { available, type Device } from '@nms/shared';
import { server } from './msw/server';

// ECharts uses <canvas> which jsdom does not implement; mock the wrapper and capture the option so
// we can assert the DATA (available vs "N/A") rather than the pixels.
let lastOption: unknown = null;
vi.mock('../src/components/EChart', () => ({
  EChart: (props: { option: unknown; ariaLabel: string }) => {
    lastOption = props.option;
    return <div data-testid="echart" aria-label={props.ariaLabel} />;
  }
}));

import { CpuMemHeatmap } from '../src/components/dashboard/CpuMemHeatmap';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const switchDev: Device = {
  id: '1', hostname: 'sim-switch', displayName: 'sim-switch', kind: 'switch', location: 'lab', reachability: 'up', uptimeSeconds: available(1)
};

describe('CpuMemHeatmap (FR-24/27)', () => {
  it('marks devices without CPU/mem as N/A cells, never 0%', async () => {
    // Force cpu + memory unavailable for device 1.
    server.use(
      http.get('/bff/api/v1/devices/:id/metrics/latest', ({ request }) => {
        const metric = new URL(request.url).searchParams.get('metric');
        if (metric === 'cpuUsage' || metric === 'memUsedBytes' || metric === 'memFreeBytes') {
          return HttpResponse.json({ success: true, data: { status: 'unavailable', reason: 'OID_NOT_SUPPORTED' } });
        }
        return HttpResponse.json({ success: true, data: { status: 'available', value: 1, timestamp: '2026-08-11T00:00:00Z' } });
      })
    );
    render(<CpuMemHeatmap devices={[switchDev]} />);
    await screen.findByTestId('echart');
    const opt = lastOption as { series: { name: string; data: unknown[] }[] };
    const unavailableSeries = opt.series.find((s) => s.name === 'unavailable')!;
    // Both cells (CPU, Memory) are unavailable → 2 N/A overlay cells; the main series has none.
    expect(unavailableSeries.data).toHaveLength(2);
    expect(screen.getByText(/not collected/i)).toBeInTheDocument();
  });

  it('plots a real available CPU value on the heatmap', async () => {
    server.use(
      http.get('/bff/api/v1/devices/:id/metrics/latest', ({ request }) => {
        const metric = new URL(request.url).searchParams.get('metric');
        if (metric === 'cpuUsage') {
          return HttpResponse.json({ success: true, data: { status: 'available', value: 34, timestamp: '2026-08-11T00:00:00Z' } });
        }
        return HttpResponse.json({ success: true, data: { status: 'unavailable', reason: 'OID_NOT_SUPPORTED' } });
      })
    );
    render(<CpuMemHeatmap devices={[switchDev]} />);
    await screen.findByTestId('echart');
    const opt = lastOption as { series: { name: string; data: [number, number, number | '-'][] }[] };
    const main = opt.series.find((s) => s.name === 'utilisation')!;
    const cpuCell = main.data.find((d) => d[0] === 0);
    expect(cpuCell?.[2]).toBe(34);
  });
});
