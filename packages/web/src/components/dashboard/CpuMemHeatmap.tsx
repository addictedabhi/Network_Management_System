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

  // ECharts heatmap data: [xIndex, yIndex, value]. Unavailable cells use a sentinel of `-` (ECharts
  // treats `-` as "no data" → no coloured square) and we overlay an explicit "N/A" label on them.
  const data: [number, number, number | '-'][] = [];
  const naCells: { x: number; y: number }[] = [];
  rows.forEach((d, y) => {
    METRICS.forEach((m, x) => {
      const cell = grid.get(`${d.id}:${m.key}`);
      if (cell && cell.available) data.push([x, y, cell.value]);
      else {
        data.push([x, y, '-']);
        naCells.push({ x, y });
      }
    });
  });

  const option: EChartsCoreOption = {
    tooltip: {
      formatter: (p: { value: [number, number, number | '-'] }) => {
        const [, , v] = p.value;
        const device = yAxis[p.value[1]];
        const metric = xAxis[p.value[0]];
        return v === '-'
          ? `${device} · ${metric}: Not available`
          : `${device} · ${metric}: ${v}%`;
      }
    },
    grid: { left: 130, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: xAxis, splitArea: { show: true } },
    yAxis: { type: 'category', data: yAxis, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max: 100,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['#1b7f43', '#e0a800', '#b3261e'] },
      text: ['high', 'low']
    },
    series: [
      {
        name: 'utilisation',
        type: 'heatmap',
        data,
        label: { show: true, formatter: (p: { value: [number, number, number | '-'] }) => (p.value[2] === '-' ? 'N/A' : `${p.value[2]}%`) },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.3)' } }
      },
      // Overlay: explicitly mark unavailable cells so they read as "not collected", not a 0%.
      {
        name: 'unavailable',
        type: 'heatmap',
        data: naCells.map((c) => [c.x, c.y, 0]),
        itemStyle: { color: '#eceff3', borderColor: '#c9d2dd', borderType: 'dashed', borderWidth: 1 },
        label: { show: true, color: '#8a5a00', formatter: 'N/A' },
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
