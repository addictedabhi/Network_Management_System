'use client';

/**
 * Top-N interfaces by 95th-percentile bandwidth (design B.3, FR-26/28).
 *
 * For each SNMP-polled device we fetch the in/out throughput series over the selected window, take
 * the nearest-rank 95th percentile of each, and rank descending. Devices with no `ports` series
 * simply do not appear (they have no interfaces) — that is correct, not an empty state. If NO
 * device has any throughput series, the panel shows the honest empty state. The 95th-percentile
 * method is documented in a note (FR-28). Rates are real derivatives — tiny at POC, shown honestly.
 */
import { useEffect, useState } from 'react';
import type { Device } from '@nms/shared';
import { bffClient } from '../../lib/bffClient';
import { seriesValues, percentile } from '../../lib/stats';
import { formatBitrate } from '../../lib/format';

interface Row {
  readonly deviceId: string;
  readonly label: string;
  readonly direction: 'in' | 'out';
  readonly p95Bps: number;
}

export interface TopInterfacesProps {
  readonly devices: readonly Device[];
  readonly range: { from: string; to: string; step: string };
  readonly topN?: number;
}

export function TopInterfaces({ devices, range, topN = 8 }: TopInterfacesProps) {
  const candidates = devices.filter((d) => d.kind === 'switch' || d.kind === 'router');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    (async () => {
      try {
        const collected: Row[] = [];
        for (const d of candidates) {
          for (const dir of ['in', 'out'] as const) {
            const metric = dir === 'in' ? 'ifInOctets_rate' : 'ifOutOctets_rate';
            const series = await bffClient.getSeriesMetric(d.id, metric, range, { hostname: d.hostname });
            const p95 = percentile(seriesValues(series), 95);
            if (p95 !== null) {
              collected.push({ deviceId: d.id, label: `${d.displayName} (${dir})`, direction: dir, p95Bps: p95 });
            }
          }
        }
        if (!cancelled) setRows(collected.sort((a, b) => b.p95Bps - a.p95Bps).slice(0, topN));
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.map((d) => d.id).join(','), range.from, range.to, range.step, topN]);

  if (error) {
    return (
      <div role="alert" className="data-state data-state--error">
        <p>The monitoring backend returned an error loading interface throughput. Please try again.</p>
      </div>
    );
  }
  if (!rows) {
    return (
      <div role="status" aria-live="polite" className="data-state data-state--loading">
        <span className="spinner" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>No interface throughput data collected in this window.</p>
      </div>
    );
  }

  const max = rows[0]!.p95Bps || 1;
  return (
    <div className="topn">
      <ol className="topn__list">
        {rows.map((r) => (
          <li key={`${r.deviceId}:${r.direction}`} className="topn__item">
            <span className="topn__label">{r.label}</span>
            <span className="topn__bar-wrap">
              <span
                className={`topn__bar topn__bar--${r.direction}`}
                style={{ width: `${Math.round((r.p95Bps / max) * 100)}%` }}
              />
            </span>
            <span className="topn__value">{formatBitrate(r.p95Bps)}</span>
          </li>
        ))}
      </ol>
      <p className="chart-note" title="Nearest-rank 95th percentile over the selected window">
        Ranked by the <strong>95th-percentile</strong> throughput (nearest-rank) over the selected
        window — a burst-tolerant peak, not the maximum.
      </p>
    </div>
  );
}
