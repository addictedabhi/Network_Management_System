'use client';

/**
 * CPU / memory heatmap (design B.4, FR-27).
 *
 * HONESTY (FR-24, non-negotiable): a device that does not report CPU or memory renders an explicit
 * "Not available" cell — an em-dash label on a MUTED (not green) cell — NEVER a 0% cell, which
 * would falsely read as a healthy idle CPU. Available cells carry the real percentage on a
 * low→high colour scale. Most cells are "Not available" at POC (snmpsim exposes little; the ping
 * host nothing), which is the correct output, not a defect.
 *
 * The chart is ECharts (canvas, ES-module-bundled) so it stays within the strict nonce CSP.
 */
import { useEffect, useState } from 'react';
import type { Device } from '@nms/shared';
import { isAvailable } from '@nms/shared';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from '../EChart';
import { bffClient } from '../../lib/bffClient';

const METRICS = [
  { key: 'CPU %', metric: 'cpuUsage', scale: (v: number) => v },
  // Memory % is derived from used/free; we request used bytes and free bytes and compute a ratio.
  { key: 'Memory %', metric: 'memPct', scale: (v: number) => v }
] as const;

type Cell = { available: true; value: number } | { available: false };

async function loadMemoryPct(device: Device): Promise<Cell> {
  const [used, free] = await Promise.all([
    bffClient.getLatestMetric(device.id, 'memUsedBytes', { hostname: device.hostname }),
    bffClient.getLatestMetric(device.id, 'memFreeBytes', { hostname: device.hostname })
  ]);
  if (isAvailable(used) && isAvailable(free) && used.value + free.value > 0) {
    return { available: true, value: Math.round((used.value / (used.value + free.value)) * 100) };
  }
  return { available: false };
}

async function loadCpu(device: Device): Promise<Cell> {
  const cpu = await bffClient.getLatestMetric(device.id, 'cpuUsage', { hostname: device.hostname });
  return isAvailable(cpu) ? { available: true, value: Math.round(cpu.value) } : { available: false };
}

export interface CpuMemHeatmapProps {
  readonly devices: readonly Device[];
}

export function CpuMemHeatmap({ devices }: CpuMemHeatmapProps) {
  // Only devices that COULD report CPU/mem (SNMP-polled) belong on the heatmap; a ping-only host has
  // no axis row. We still keep any device that is up so an all-unavailable row is shown honestly.
  const rows = devices.filter((d) => d.reachability === 'up');
  const [grid, setGrid] = useState<Map<string, Cell> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGrid(null);
    setError(false);
    (async () => {
      try {
        const entries = await Promise.all(
          rows.flatMap((d) => [
            loadCpu(d).then((c) => [`${d.id}:CPU %`, c] as const),
            loadMemoryPct(d).then((c) => [`${d.id}:Memory %`, c] as const)
          ])
        );
        if (!cancelled) setGrid(new Map(entries));
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices.map((d) => d.id).join(',')]);

  if (error) {
    return (
      <div role="alert" className="data-state data-state--error">
        <p>The monitoring backend returned an error loading CPU/memory. Please try again.</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>No devices in the selected group.</p>
      </div>
    );
  }
  if (!grid) {
    return (
      <div role="status" aria-live="polite" className="data-state data-state--loading">
        <span className="spinner" aria-hidden="true" /> Loading…
      </div>
    );
  }

  const yAxis = rows.map((d) => d.displayName);
  const xAxis = METRICS.map((m) => m.key);

  // ECharts heatmap data split across TWO series so the colour scale can NEVER touch an N/A cell:
  //   • `utilisation` (series 0) — ONLY real numeric cells; the `visualMap` is scoped to this series,
  //     so a genuine 0% still renders low/green while an absent metric is never mapped at all.
  //   • `unavailable` (series 1) — the N/A cells, carrying a FIXED neutral-grey `itemStyle` (not a
  //     scale value). The visualMap is scoped to series 0 ONLY, so this series is never colour-mapped;
  //     its numeric value is a rendering placeholder that no colour scale ever reads.
  // This is the honesty fix (FR-24): "not collected" reads GREY, never green (which would read as a
  // healthy idle CPU — the same lie as a fabricated 0).
  const REAL_SERIES_INDEX = 0;
  const NA_FILL = '#e4e8ee'; // neutral grey — deliberately outside the visualMap's low→high ramp.

  const data: [number, number, number][] = [];
  const naCells: [number, number, number][] = [];
  rows.forEach((d, y) => {
    METRICS.forEach((m, x) => {
      const cell = grid.get(`${d.id}:${m.key}`);
      if (cell && cell.available) data.push([x, y, cell.value]);
      // Placeholder value (0) renders the grey cell; series 1 is outside the visualMap so it is
      // never colour-mapped — the value is inert.
      else naCells.push([x, y, 0]);
    });
  });

  const option: EChartsCoreOption = {
    tooltip: {
      formatter: (p: { seriesName?: string; value: [number, number, number | '-'] }) => {
        const device = yAxis[p.value[1]];
        const metric = xAxis[p.value[0]];
        return p.seriesName === 'unavailable' || p.value[2] === '-'
          ? `${device} · ${metric}: Not available`
          : `${device} · ${metric}: ${p.value[2]}%`;
      }
    },
    // Extra bottom margin reserves a clean band for the horizontal legend so it never overlaps the
    // y-axis row labels; extra left margin keeps long device names off the cells.
    grid: { left: 140, right: 24, top: 24, bottom: 64, containLabel: false },
    xAxis: { type: 'category', data: xAxis, splitArea: { show: true } },
    yAxis: { type: 'category', data: yAxis, splitArea: { show: true } },
    visualMap: {
      // Scope the colour mapping to the REAL-numeric series only — the N/A overlay is excluded, so a
      // no-data cell can never be coloured at the scale's green (min) end.
      seriesIndex: REAL_SERIES_INDEX,
      min: 0,
      max: 100,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 8,
      itemWidth: 14,
      itemHeight: 120,
      inRange: { color: ['#1b7f43', '#e0a800', '#b3261e'] },
      text: ['high', 'low']
    },
    series: [
      {
        name: 'utilisation',
        type: 'heatmap',
        data,
        label: { show: true, formatter: (p: { value: [number, number, number] }) => `${p.value[2]}%` },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.3)' } }
      },
      // Overlay: unavailable cells get a fixed neutral-grey fill + the "N/A" text label (NFR-30: the
      // grey and the label TOGETHER carry the meaning — never colour alone). Excluded from visualMap.
      {
        name: 'unavailable',
        type: 'heatmap',
        data: naCells,
        itemStyle: { color: NA_FILL, borderColor: '#c9d2dd', borderType: 'dashed', borderWidth: 1 },
        label: { show: true, color: '#5b6470', formatter: 'N/A' },
        tooltip: { show: false },
        silent: true
      }
    ]
  };

  return (
    <div className="heatmap">
      <EChart
        option={option}
        height={Math.max(160, rows.length * 44 + 80)}
        ariaLabel="CPU and memory utilisation heatmap; cells marked N/A are not collected for that device"
      />
      <p className="chart-note">
        Cells marked <strong>N/A</strong> are not collected for that device (no SNMP CPU/memory) —
        an absent metric, never 0%.
      </p>
    </div>
  );
}
