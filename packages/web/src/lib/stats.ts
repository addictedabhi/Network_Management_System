/**
 * Pure statistics helpers for the dashboard. Unit-tested; no fabrication — an empty input yields
 * `null` (an honest "no data"), never 0.
 */
import type { SeriesResponse } from '@nms/shared';
import { isAvailable } from '@nms/shared';

/** The available numeric values of a series, in order. Unavailable points are dropped (gaps). */
export function seriesValues(series: SeriesResponse): number[] {
  return series.points.map((p) => p.value).filter(isAvailable).map((v) => v.value);
}

/**
 * Nearest-rank 95th percentile (FR-28). Returns `null` for an empty set — the caller then shows an
 * honest empty/unavailable state, never a fabricated 0.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx]!;
}
