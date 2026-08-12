'use client';

/**
 * A single-metric history line chart over a time window (Phase 3 c, FR-22). Reuses the existing
 * `GET /devices/:id/metrics/series` route; renders the four DISTINCT states:
 *   - loading / error (real backend outage) / EMPTY ("No data points in this window") / success.
 * An absent series is the EMPTY state (a genuine measured absence), NEVER a fabricated 0 line — the
 * BFF returns an empty points array for an absent series and THROWS for a real outage, so the two
 * are distinguishable here (three-states discipline). A real measured 0 is a legitimate point.
 *
 * ECharts line, canvas renderer, ES-module bundled → strict nonce CSP compatible (no unsafe-inline).
 */
import { useEffect, useState } from 'react';
import type { SeriesResponse } from '@nms/shared';
import { isAvailable } from '@nms/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '../EChart';
import { bffClient } from '../../lib/bffClient';

export interface MetricHistoryChartProps {
  readonly deviceId: string;
  readonly hostname: string;
  readonly metric: string;
  readonly label: string;
  readonly unit?: string;
  readonly color?: string;
  readonly range: { from: string; to: string; step: string };
  readonly valueFormatter?: (v: number) => string;
}

function toLine(series: SeriesResponse): [number, number][] {
  return series.points
    .filter((p) => isAvailable(p.value))
    .map((p) => [Date.parse(p.timestamp), (p.value as { value: number }).value]);
}

export function MetricHistoryChart({
  deviceId,
  hostname,
  metric,
  label,
  unit,
  color = '#1e88e5',
  range,
  valueFormatter
}: MetricHistoryChartProps) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; line: [number, number][] }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const s = await bffClient.getSeriesMetric(deviceId, metric, range, { hostname });
        if (!cancelled) setState({ kind: 'ready', line: toLine(s) });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, hostname, metric, range.from, range.to, range.step]);

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
        <p>The monitoring backend returned an error loading {label}. Please try again.</p>
      </div>
    );
  }
  if (state.line.length === 0) {
    // Honest EMPTY — a genuine measured absence over this window, distinct from an outage (error)
    // and from "unavailable" (a metric this device does not report). Never a fabricated 0 line.
    return (
      <div className="data-state data-state--empty">
        <p>No {label} data points in this window.</p>
      </div>
    );
  }

  const fmt = valueFormatter ?? ((v: number) => `${v}${unit ? ` ${unit}` : ''}`);
  const option: EChartsCoreOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => fmt(Number(v)) },
    grid: { left: 55, right: 20, top: 20, bottom: 35 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmt(v) } },
    series: [
      {
        name: label,
        type: 'line',
        showSymbol: false,
        smooth: true,
        data: state.line,
        lineStyle: { color },
        itemStyle: { color },
        areaStyle: { color, opacity: 0.08 }
      }
    ]
  };

  return (
    <EChart option={option} height={220} ariaLabel={`${label} history over the selected window`} />
  );
}
