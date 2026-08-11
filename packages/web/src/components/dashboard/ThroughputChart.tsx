'use client';

/**
 * Throughput time-series (design B.5, FR-22). Plots in/out throughput for a selected device over a
 * window (1h/24h/7d/30d). States: loading / error / EMPTY ("No data points in this window") — a
 * genuine measured absence, distinct from unavailable. A real measured 0-rate point IS legitimate
 * (an idle interface) and is plotted as a real timestamped zero; it is NOT the empty state.
 *
 * ECharts line chart, canvas renderer, ES-module bundled → strict nonce CSP compatible.
 */
import { useEffect, useState } from 'react';
import type { Device, SeriesResponse } from '@nms/shared';
import { isAvailable } from '@nms/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '../EChart';
import { bffClient } from '../../lib/bffClient';
import { formatBitrate } from '../../lib/format';

export interface ThroughputChartProps {
  readonly device: Device;
  readonly range: { from: string; to: string; step: string };
}

function toLine(series: SeriesResponse): [number, number][] {
  return series.points
    .filter((p) => isAvailable(p.value))
    .map((p) => [Date.parse(p.timestamp), (p.value as { value: number }).value]);
}

export function ThroughputChart({ device, range }: ThroughputChartProps) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready'; inLine: [number, number][]; outLine: [number, number][] }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const [inS, outS] = await Promise.all([
          bffClient.getSeriesMetric(device.id, 'ifInOctets_rate', range, { hostname: device.hostname }),
          bffClient.getSeriesMetric(device.id, 'ifOutOctets_rate', range, { hostname: device.hostname })
        ]);
        if (!cancelled) setState({ kind: 'ready', inLine: toLine(inS), outLine: toLine(outS) });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [device.id, device.hostname, range.from, range.to, range.step]);

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
        <p>The monitoring backend returned an error loading throughput. Please try again.</p>
      </div>
    );
  }
  if (state.inLine.length === 0 && state.outLine.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>No data points in this window for {device.displayName}.</p>
      </div>
    );
  }

  const option: EChartsCoreOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => formatBitrate(Number(v)) },
    legend: { data: ['In', 'Out'], top: 0 },
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatBitrate(v) } },
    series: [
      { name: 'In', type: 'line', showSymbol: false, smooth: true, data: state.inLine, lineStyle: { color: '#1e88e5' }, itemStyle: { color: '#1e88e5' } },
      { name: 'Out', type: 'line', showSymbol: false, smooth: true, data: state.outLine, lineStyle: { color: '#8e44ad' }, itemStyle: { color: '#8e44ad' } }
    ]
  };

  return (
    <EChart
      option={option}
      height={280}
      ariaLabel={`Throughput time-series for ${device.displayName}, in and out, over the selected window`}
    />
  );
}
