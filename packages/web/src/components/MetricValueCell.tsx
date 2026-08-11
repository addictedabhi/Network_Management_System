'use client';

/**
 * Renders a `MetricValue<number>` (FR-24 / NFR-22 / NFR-30).
 *
 * The `unavailable` branch renders the TEXT "Not available" — NEVER `0`, never a blank, never a
 * healthy-looking value. There is no numeric fallback path here by construction: the discriminated
 * union's `unavailable` case has no numeric slot, so a missing RSSI cannot be shown as a real
 * reading of zero. Unavailability is conveyed by text (and a `title`), not colour alone (NFR-30).
 */
import type { MetricValue, UnavailableReason } from '@nms/shared';

export interface MetricValueCellProps {
  readonly metric: MetricValue<number>;
  readonly unit?: string | undefined;
  /** Optional formatter for the available numeric value. */
  readonly format?: ((value: number) => string) | undefined;
}

function reasonText(reason: UnavailableReason): string {
  switch (reason) {
    case 'OID_NOT_SUPPORTED':
      return 'Not available — this device does not report this metric.';
    case 'NO_DATA':
      return 'Not available — no recent data has been collected.';
    case 'UPSTREAM_UNAVAILABLE':
      return 'Not available — the metric store is unreachable.';
    case 'NOT_COLLECTED':
      return 'Not available — this metric is not collected for this device.';
    default:
      return 'Not available.';
  }
}

export function MetricValueCell({ metric, unit, format }: MetricValueCellProps) {
  if (metric.status === 'available') {
    const shown = format ? format(metric.value) : String(metric.value);
    return (
      <span className="metric metric--available" title={`Observed ${metric.timestamp}`}>
        {shown}
        {unit ? <span className="metric__unit"> {unit}</span> : null}
      </span>
    );
  }
  // Unavailable: explicit text + title, never a fabricated 0 (FR-24).
  return (
    <span className="metric metric--unavailable" title={reasonText(metric.reason)}>
      Not available
    </span>
  );
}
