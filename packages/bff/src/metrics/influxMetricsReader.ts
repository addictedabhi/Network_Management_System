/**
 * `InfluxMetricsReader` — the Phase-2 adapter implementing the `MetricsReader` port against the
 * deployed InfluxDB v2 store (ADR 0009 / ADR 0005 rev 3-b).
 *
 * Credential handling (ADR 0002 / CON-6, non-negotiable): the InfluxDB v2 token is held
 * server-side only, sent as `Authorization: Token <token>`, never logged, never returned to the
 * client, never reachable from the browser.
 *
 * The FR-24 guarantee is enforced HERE at the boundary: an absent series, an empty result, a
 * non-finite value, or an unreachable store all map to the `unavailable` MetricValue discriminant
 * — NEVER `0`. There is no code path in this adapter that produces `available(0)` for missing data.
 *
 * Flux is confined to this file; the `MetricsReader` signatures the rest of the BFF sees carry no
 * query-language type. Every request carries a timeout via `AbortController`.
 */
import { available, unavailable, type MetricValue } from '@nms/shared';
import { AppError } from '../http/middleware/errorHandler.js';
import type { Logger } from '../observability/logger.js';
import type { DependencyHealth } from '../http/routes/health.js';
import type {
  LatestQuery,
  LatestResult,
  MetricsReader,
  SeriesPoint,
  SeriesQuery,
  SeriesResult
} from './metricsReader.js';

export interface InfluxConfig {
  readonly url: string;
  readonly org: string;
  readonly bucket: string;
  readonly token: string;
}

const TIMEOUT_MS = 10_000;

/**
 * Builds a Flux query for a metric on a device (optionally an interface). `deviceId` /
 * `interfaceId` are LibreNMS-assigned identifiers and the metric is a fixed field name; they are
 * embedded as string literals inside the Flux `filter` predicates. Flux is not SQL — there is no
 * statement terminator to break out of and no second statement to inject — but the values are
 * still escaped (backslash + double-quote) so a crafted id cannot terminate the string literal or
 * alter the predicate. `range`/`window` are numeric-or-duration domain inputs, not free text.
 */
function escapeFluxString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Maps a DOMAIN metric name to the real LibreNMS InfluxDB v2 layout (verified against the deployed
 * store, 2026-08-10). LibreNMS does not store a `_field` named after the domain metric — instead:
 *
 *   - Wireless RF sensors land in `_measurement == "wireless-sensor"`, `_field == "sensor"`,
 *     identity tag `hostname`, and the specific reading in `sensor_descr` ("Local RSSI"/"Local SNR").
 *   - Interface counters land in `_measurement == "ports"`, `_field == "INOCTETS"/"OUTOCTETS"`,
 *     identity `hostname` + `ifName`. Throughput is the per-second derivative of the counter.
 *
 * A metric absent from this registry falls back to the generic `_field == metric` +
 * `device_id == deviceId` predicate (used by health checks and any future metric).
 */
interface MetricSelector {
  readonly measurement: string;
  /** Extra tag/field predicates as (tagKey, value) pairs, ANDed into the filter. */
  readonly predicates: ReadonlyArray<readonly [string, string]>;
  /** True when the underlying field is a monotonic counter and must be converted to a rate. */
  readonly isRate?: boolean;
}

const METRIC_REGISTRY: Readonly<Record<string, MetricSelector>> = {
  af60StaRSSI: {
    measurement: 'wireless-sensor',
    predicates: [
      ['_field', 'sensor'],
      ['sensor_descr', 'Local RSSI']
    ]
  },
  af60StaSNR: {
    measurement: 'wireless-sensor',
    predicates: [
      ['_field', 'sensor'],
      ['sensor_descr', 'Local SNR']
    ]
  },
  ifInOctets_rate: {
    measurement: 'ports',
    predicates: [['_field', 'INOCTETS']],
    isRate: true
  },
  ifOutOctets_rate: {
    measurement: 'ports',
    predicates: [['_field', 'OUTOCTETS']],
    isRate: true
  },
  // CPU / memory / AF60 mod-rate — confirmed against the live store 2026-08-11. LibreNMS writes
  // CPU into `processors` (field `usage`), memory into `mempool` (fields `used`/`free`), and the
  // AF60 link/modulation rate into `wireless-sensor` (`_field == sensor`, sensor_descr
  // "Tx Capacity"/"Rx Capacity"). All keyed by the `hostname` tag, like the RF sensors above.
  // A device that does not expose one of these (e.g. an snmpsim without hrStorage, or the ping
  // host) simply returns no rows → `unavailable`, never 0 (FR-24).
  cpuUsage: {
    measurement: 'processors',
    predicates: [['_field', 'usage']]
  },
  memUsedBytes: {
    measurement: 'mempool',
    predicates: [['_field', 'used']]
  },
  memFreeBytes: {
    measurement: 'mempool',
    predicates: [['_field', 'free']]
  },
  af60TxCapacity: {
    measurement: 'wireless-sensor',
    predicates: [
      ['_field', 'sensor'],
      ['sensor_descr', 'Tx Capacity']
    ]
  },
  af60RxCapacity: {
    measurement: 'wireless-sensor',
    predicates: [
      ['_field', 'sensor'],
      ['sensor_descr', 'Rx Capacity']
    ]
  }
};

function eq(tag: string, value: string): string {
  return `|> filter(fn: (r) => r["${tag}"] == "${escapeFluxString(value)}")`;
}

/**
 * Builds the shared identity + selector filters for a query. Registered metrics key by `hostname`
 * (the tag LibreNMS actually writes) and select by measurement + `sensor_descr`/`_field`; anything
 * else uses the legacy `_field == metric` + `device_id` predicate so generic metrics still resolve.
 */
function buildFilters(q: { metric: string; deviceId: string; hostname?: string; interfaceId?: string }): {
  filters: string[];
  isRate: boolean;
} {
  const selector = METRIC_REGISTRY[q.metric];
  const filters: string[] = [];
  if (selector && q.hostname) {
    filters.push(eq('_measurement', selector.measurement));
    for (const [tag, value] of selector.predicates) filters.push(eq(tag, value));
    filters.push(eq('hostname', q.hostname));
    if (q.interfaceId) filters.push(eq('ifName', q.interfaceId));
    return { filters, isRate: Boolean(selector.isRate) };
  }
  // Legacy / generic path.
  filters.push(eq('_field', q.metric));
  filters.push(eq('device_id', q.deviceId));
  if (q.interfaceId) filters.push(eq('ifIndex', q.interfaceId));
  return { filters, isRate: false };
}

function buildSeriesFlux(cfg: InfluxConfig, q: SeriesQuery): string {
  const { filters, isRate } = buildFilters(q);
  const rate = isRate
    ? '|> derivative(unit: 1s, nonNegative: true)'
    : `|> aggregateWindow(every: ${escapeFluxString(q.step)}, fn: mean, createEmpty: false)`;
  return [
    `from(bucket: "${escapeFluxString(cfg.bucket)}")`,
    `|> range(start: ${new Date(q.from).toISOString()}, stop: ${new Date(q.to).toISOString()})`,
    ...filters,
    rate
  ].join('\n');
}

function buildLatestFlux(cfg: InfluxConfig, q: LatestQuery): string {
  const { filters, isRate } = buildFilters(q);
  // For a counter we need the derivative BEFORE last() so the latest value is a rate, not a count.
  const rate = isRate ? '|> derivative(unit: 1s, nonNegative: true)' : '';
  return [
    `from(bucket: "${escapeFluxString(cfg.bucket)}")`,
    `|> range(start: -1h)`,
    ...filters,
    rate,
    `|> last()`
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Parses an InfluxDB v2 CSV annotated-dialect response into (time, value) rows.
 *
 * Only the columns we need (`_time`, `_value`) are read, located by header name so column order
 * changes do not silently mis-map. A row whose `_value` is empty or non-finite is dropped rather
 * than defaulted — the caller then sees no point for that instant, which is the honest "no data"
 * signal, not a zero.
 */
function parseInfluxCsv(csv: string): Array<{ time: string; value: number }> {
  const rows: Array<{ time: string; value: number }> = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return rows;
  const header = lines[0]!.split(',');
  const timeIdx = header.indexOf('_time');
  const valueIdx = header.indexOf('_value');
  if (timeIdx === -1 || valueIdx === -1) return rows;
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const rawTime = cols[timeIdx];
    const rawValue = cols[valueIdx];
    if (!rawTime || rawValue === undefined || rawValue === '') continue;
    const n = Number(rawValue);
    if (!Number.isFinite(n)) continue;
    rows.push({ time: rawTime, value: n });
  }
  return rows;
}

export function createInfluxMetricsReader(
  config: InfluxConfig,
  logger: Logger,
  fetchImpl: typeof fetch = fetch
): MetricsReader {
  async function runQuery(flux: string): Promise<string> {
    const url = `${config.url.replace(/\/$/, '')}/api/v2/query?org=${encodeURIComponent(config.org)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          // The ONLY place the InfluxDB v2 token is used. Never logged, never returned.
          Authorization: `Token ${config.token}`,
          'Content-Type': 'application/vnd.flux',
          Accept: 'application/csv'
        },
        body: flux
      });
      if (!res.ok) {
        logger.warn('influxdb query failed', { status: res.status });
        // Upstream error → the metric is unavailable, not zero. Signalled by throwing so the
        // caller maps to `unavailable`; the upstream body is never surfaced.
        throw new Error('influxdb query non-2xx');
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async querySeries(request: SeriesQuery): Promise<SeriesResult> {
      const base = {
        metric: request.metric,
        deviceId: request.deviceId,
        ...(request.interfaceId ? { interfaceId: request.interfaceId } : {})
      };
      // `request` (incl. hostname) is used to build the Flux; only the wire-facing shape is `base`.
      try {
        const csv = await runQuery(buildSeriesFlux(config, request));
        const points: SeriesPoint[] = parseInfluxCsv(csv).map((r) => ({
          timestamp: r.time,
          value: available(r.value, r.time)
        }));
        // No rows returned (no throw) = the series is genuinely absent for that window. Return zero
        // points; a caller rendering it shows the honest EMPTY state, never a fabricated 0 line.
        return { ...base, points };
      } catch (err) {
        // A THROW here means the store was unreachable or returned a non-2xx — a real backend
        // OUTAGE, NOT an empty window. Surfacing it as an UPSTREAM error (mapped to 502) lets
        // ThroughputChart / TopInterfaces render their ERROR state instead of collapsing an outage
        // into the benign EMPTY state (three-states discipline; FR-43/NFR-22). This mirrors
        // queryLatest's NO_DATA-vs-UPSTREAM_UNAVAILABLE split.
        if (err instanceof AppError) throw err;
        logger.warn('influxdb series unavailable', { metric: request.metric });
        throw new AppError('UPSTREAM_UNAVAILABLE', 'The metrics store is unavailable.', 502);
      }
    },

    async queryLatest(request: LatestQuery): Promise<LatestResult> {
      const base = {
        metric: request.metric,
        deviceId: request.deviceId,
        ...(request.interfaceId ? { interfaceId: request.interfaceId } : {})
      };
      let value: MetricValue<number>;
      try {
        const csv = await runQuery(buildLatestFlux(config, request));
        const rows = parseInfluxCsv(csv);
        const last = rows[rows.length - 1];
        // FR-24: absent series / no point → `unavailable`, NEVER `available(0)`.
        value = last ? available(last.value, last.time) : unavailable<number>('NO_DATA');
      } catch {
        logger.warn('influxdb latest unavailable', { metric: request.metric });
        value = unavailable<number>('UPSTREAM_UNAVAILABLE');
      }
      return { ...base, value };
    },

    async checkHealth(): Promise<DependencyHealth> {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        // InfluxDB v2 exposes an unauthenticated `/health`. Reachability + 2xx is enough for
        // readiness; no token is sent and no operational data is read.
        const res = await fetchImpl(`${config.url.replace(/\/$/, '')}/health`, {
          signal: controller.signal
        });
        if (!res.ok) return { status: 'error', error: 'UPSTREAM_UNAVAILABLE' };
        return { status: 'ok', latencyMs: Date.now() - startedAt };
      } catch {
        return { status: 'error', error: 'UPSTREAM_UNAVAILABLE' };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
