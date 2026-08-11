/**
 * The `MetricsReader` port (ADR 0005). A narrow, vendor-neutral interface expressed purely in
 * domain terms: NO Flux/InfluxQL string, NO SQL fragment, NO line-protocol type appears in any
 * signature here or in any caller. Exactly one adapter implements it, selected at startup by
 * validated configuration (Phase 2: `InfluxMetricsReader`).
 *
 * The result types carry an explicit `unavailable` discriminator (via `@nms/shared`'s
 * `MetricValue`), which is the type-level basis for FR-24 / NFR-22 — an absent metric cannot be
 * coerced to `0` because the absent case has no numeric slot.
 */
import type { MetricValue } from '@nms/shared';
import type { DependencyHealth } from '../http/routes/health.js';

/** A single named time series for one device (optionally one interface). */
export interface SeriesQuery {
  readonly metric: string;
  readonly deviceId: string;
  /**
   * LibreNMS-assigned hostname. LibreNMS's InfluxDB v2 writer tags series by `hostname`
   * (not the numeric device id), so the adapter keys registered metrics by hostname when it is
   * supplied. Optional so generic/legacy metrics keyed by `device_id` still resolve.
   */
  readonly hostname?: string;
  readonly interfaceId?: string;
  /** Inclusive start / exclusive end, ISO 8601. */
  readonly from: string;
  readonly to: string;
  /** Aggregation window, e.g. `5m`. Domain-level; the adapter maps it to its own syntax. */
  readonly step: string;
}

export interface SeriesPoint {
  readonly timestamp: string;
  readonly value: MetricValue<number>;
}

export interface SeriesResult {
  readonly metric: string;
  readonly deviceId: string;
  readonly interfaceId?: string;
  readonly points: readonly SeriesPoint[];
}

export interface LatestQuery {
  readonly metric: string;
  readonly deviceId: string;
  /** See {@link SeriesQuery.hostname}. */
  readonly hostname?: string;
  readonly interfaceId?: string;
}

export interface LatestResult {
  readonly metric: string;
  readonly deviceId: string;
  readonly interfaceId?: string;
  /** `unavailable` when there is no point / no series — NEVER a fabricated 0 (FR-24). */
  readonly value: MetricValue<number>;
}

export interface MetricsReader {
  querySeries(request: SeriesQuery): Promise<SeriesResult>;
  queryLatest(request: LatestQuery): Promise<LatestResult>;
  checkHealth(): Promise<DependencyHealth>;
}
