'use client';

/**
 * A thin React wrapper around Apache ECharts (design §C).
 *
 * CSP: ECharts is imported as a NORMAL ES MODULE bundled by Next — covered by
 * `script-src 'self' 'strict-dynamic'`. It renders to a <canvas> (the default renderer), so it
 * injects NO inline <script> and NO inline <style> that would require `'unsafe-inline'`. This
 * component is a client component mounted after hydration, so it never participates in the
 * per-request RSC inline-script path. It must NOT be changed to a CDN <script> or the SVG renderer
 * without re-verifying the strict nonce CSP (item 21 — do not regress).
 *
 * We import only the pieces we use via `echarts/core` + explicit `use(...)` registration to keep
 * the client bundle small while staying fully ES-module/bundler-friendly.
 */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, HeatmapChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  DataZoomComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer
]);

export interface EChartProps {
  readonly option: EChartsCoreOption;
  readonly height?: number;
  /** Accessible description of what the chart shows (the canvas itself is not readable). */
  readonly ariaLabel: string;
  readonly className?: string;
}

export function EChart({ option, height = 260, ariaLabel, className }: EChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={ref}
      className={`echart${className ? ` ${className}` : ''}`}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
