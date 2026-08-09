/**
 * A metric reading that is either present or explicitly absent.
 *
 * The `unavailable` case has NO numeric slot by construction. This is what makes FR-24
 * unviolatable: there is nowhere to put a `0` when a value is missing, so an absent RSSI
 * can never be rendered as a real reading of zero. Never add a numeric fallback here.
 */
export type UnavailableReason =
  | 'OID_NOT_SUPPORTED'
  | 'NO_DATA'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NOT_COLLECTED';

export type MetricValue<T = number> =
  | { readonly status: 'available'; readonly value: T; readonly timestamp: string }
  | { readonly status: 'unavailable'; readonly reason: UnavailableReason };

/** Wraps a present reading with the time it was observed. */
export function available<T>(
  value: T,
  timestamp: string = new Date().toISOString()
): MetricValue<T> {
  return { status: 'available', value, timestamp };
}

/** Marks a reading absent, carrying the machine-readable reason it is missing. */
export function unavailable<T = number>(reason: UnavailableReason): MetricValue<T> {
  return { status: 'unavailable', reason };
}

/** Type guard narrowing to the case that actually carries a value. */
export function isAvailable<T>(
  m: MetricValue<T>
): m is { status: 'available'; value: T; timestamp: string } {
  return m.status === 'available';
}
