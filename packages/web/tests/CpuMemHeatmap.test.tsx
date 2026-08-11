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
    const opt = lastOption as {
      visualMap: { seriesIndex?: number; inRange?: { color?: string[] } };
      series: {
        name: string;
        data: unknown[];
        itemStyle?: { color?: string };
      }[];
    };
    const unavailableSeries = opt.series.find((s) => s.name === 'unavailable')!;
    const mainSeries = opt.series.find((s) => s.name === 'utilisation')!;
    // Both cells (CPU, Memory) are unavailable → 2 N/A overlay cells; the main series has none.
    expect(unavailableSeries.data).toHaveLength(2);
    // Main (colour-mapped) series must carry NO placeholder cell for the N/A ones — an N/A cell
    // must never sit on the visualMap scale (where min→green would read as "healthy").
    expect(mainSeries.data).toHaveLength(0);

    // The visualMap must be scoped to ONLY the real-numeric series (index 0), so it can never
    // colour the N/A overlay green at its scale min.
    expect(opt.visualMap.seriesIndex).toBe(0);

    // The N/A overlay carries a FIXED neutral-grey itemStyle (not a scale colour), and that colour
    // must not be the visualMap's low/green end.
    const naColor = unavailableSeries.itemStyle?.color?.toLowerCase();
    const scaleColors = (opt.visualMap.inRange?.color ?? []).map((c) => c.toLowerCase());
    expect(naColor).toBeTruthy();
    expect(scaleColors).not.toContain(naColor);

    expect(screen.getByText(/not collected/i)).toBeInTheDocument();
  });

  it('excludes N/A cells from the visualMap and keeps a real 0% distinct from N/A', async () => {
    // One cell is a GENUINE 0% (a real, collected value), the other is unavailable.
    server.use(
      http.get('/bff/api/v1/devices/:id/metrics/latest', ({ request }) => {
        const metric = new URL(request.url).searchParams.get('metric');
        if (metric === 'cpuUsage') {
          return HttpResponse.json({
            success: true,
            data: { status: 'available', value: 0, timestamp: '2026-08-11T00:00:00Z' }
          });
        }
        // memory unavailable
        return HttpResponse.json({ success: true, data: { status: 'unavailable', reason: 'OID_NOT_SUPPORTED' } });
      })
    );
    render(<CpuMemHeatmap devices={[switchDev]} />);
    await screen.findByTestId('echart');
    const opt = lastOption as {
      visualMap: { seriesIndex?: number; min: number };
      series: { name: string; data: [number, number, number][] }[];
    };
    const main = opt.series.find((s) => s.name === 'utilisation')!;
    const unavailable = opt.series.find((s) => s.name === 'unavailable')!;
    // The genuine 0% is a real numeric cell on the colour-mapped series (visualMap min = 0 → low/green).
    expect(main.data).toEqual([[0, 0, 0]]);
    // The unavailable memory cell is on the overlay, NOT the colour scale.
    expect(unavailable.data).toHaveLength(1);
    expect(opt.visualMap.min).toBe(0);
    expect(opt.visualMap.seriesIndex).toBe(0);
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
