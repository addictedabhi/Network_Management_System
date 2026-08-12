'use client';

/**
 * Fleet CPU trend (Phase 3 d.3) — mean and max CPU across all SNMP-polled devices over a window,
 * computed CLIENT-SIDE from each device's real `cpuUsage` series (querySeries). No new backend.
 *
 * Honesty: only devices that actually return CPU points contribute; a device with no series does
 * not distort the aggregate (it is absent, not a 0). If NO device returns CPU points, the panel
 * shows the honest EMPTY state — never a fabricated flat line. A real backend outage surfaces as the
 * error state (any series throw). ECharts line, canvas renderer → strict nonce CSP compatible.
 */
import { useEffect, useState } from 'react';
import type { Device, SeriesResponse } from '@nms/shared';
import { isAvailable } from '@nms/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '../EChart';
import { bffClient } from '../../lib/bffClient';

export interface FleetCpuTrendProps {
  readonly devices: readonly Device[];
  readonly range: { from: string; to: string; step: string };
}

/** Bucket available points by timestamp across devices, then reduce to mean/max per timestamp. */
function aggregate(seriesList: SeriesResponse[]): { mean: [number, number][]; max: [number, number][] } {
  const byTime = new Map<number, number[]>();
  for (const s of seriesList) {
    for (const p of s.points) {
      if (!isAvailable(p.value)) continue;
      const t = Date.parse(p.timestamp);
      const arr = byTime.get(t) ?? [];
      arr.push((p.value as { value: number }).value);
      byTime.set(t, arr);
    }
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const mean: [number, number][] = [];
  const max: [number, number][] = [];
  for (const t of times) {
    const vals = byTime.get(t)!;
    mean.push([t, Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10]);
    max.push([t, Math.max(...vals)]);
  }
  return { mean, max };
}

export function FleetCpuTrend({ devices, range }: FleetCpuTrendProps) {
  const candidates = devices.filter((d) => d.reachability === 'up');
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready'; mean: [number, number][]; max: [number, number][] }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const seriesList = await Promise.all(
          candidates.map((d) => bffClient.getSeriesMetric(d.id, 'cpuUsage', range, { hostname: d.hostname }))
        );
        if (!cancelled) setState({ kind: 'ready', ...aggregate(seriesList) });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.map((d) => d.id).join(','), range.from, range.to, range.step]);

  if (state.kind === 'loading') {
    return (
      <div role="status" aria-live="polite" className="data-state data-state--loading">
        <span className="spinner" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div role="alert" className="data-state data-state--error">
        <p>The monitoring backend returned an error loading fleet CPU. Please try again.</p>
      </div>
    );
  }
  if (state.mean.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>No fleet CPU data points in this window.</p>
      </div>
    );
  }

  const option: EChartsCoreOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${Number(v).toFixed(1)}%` },
    legend: { data: ['Mean', 'Max'], top: 0 },
    grid: { left: 50, right: 20, top: 30, bottom: 35 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: (v: number) => `${v}%` } },
    series: [
      { name: 'Mean', type: 'line', showSymbol: false, smooth: true, data: state.mean, lineStyle: { color: '#1e88e5' }, itemStyle: { color: '#1e88e5' } },
      { name: 'Max', type: 'line', showSymbol: false, smooth: true, data: state.max, lineStyle: { color: '#b3261e' }, itemStyle: { color: '#b3261e' } }
    ]
  };

  return <EChart option={option} height={260} ariaLabel="Fleet CPU trend: mean and max across polled devices" />;
}
