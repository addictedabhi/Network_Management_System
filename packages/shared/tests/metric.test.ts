import { describe, it, expect } from 'vitest';
import { available, unavailable, isAvailable } from '../src/types/metric.js';

describe('MetricValue', () => {
  it('marks a present value available', () => {
    const m = available(42);
    expect(isAvailable(m)).toBe(true);
    if (isAvailable(m)) expect(m.value).toBe(42);
  });

  it('marks an absent value unavailable with a reason', () => {
    const m = unavailable('OID_NOT_SUPPORTED');
    expect(isAvailable(m)).toBe(false);
    expect(m).not.toHaveProperty('value');
  });

  /**
   * Finding 14a: this previously asserted only that `stringify` lacked the literal `'"value"'`,
   * which a renamed field would defeat. FR-24's real requirement is that an unavailable metric
   * has NO NUMERIC FIELD ANYWHERE after a JSON round-trip — that is what makes rendering an
   * absent RSSI as `0` structurally impossible — and that the guard still reports false on the
   * other side of serialization.
   */
  it('has no numeric field at all after a JSON round-trip', () => {
    const parsed = JSON.parse(JSON.stringify(unavailable('NO_DATA'))) as Record<string, unknown>;
    const numericFields = Object.entries(parsed).filter(([, v]) => typeof v === 'number');
    expect(numericFields).toEqual([]);
  });

  it('stays unavailable after a JSON round-trip', () => {
    const parsed = JSON.parse(JSON.stringify(unavailable('NO_DATA')));
    expect(isAvailable(parsed)).toBe(false);
    expect(parsed).not.toHaveProperty('value');
  });

  it.each(['OID_NOT_SUPPORTED', 'NO_DATA', 'UPSTREAM_UNAVAILABLE', 'NOT_COLLECTED'] as const)(
    'preserves the reason %s across a round-trip without inventing a value',
    (reason) => {
      const parsed = JSON.parse(JSON.stringify(unavailable(reason))) as Record<string, unknown>;
      expect(parsed.reason).toBe(reason);
      expect(Object.values(parsed).some((v) => typeof v === 'number')).toBe(false);
    }
  );

  it('keeps a legitimate zero reading available and distinguishable from absence', () => {
    // The inverse risk: a real 0 (e.g. zero errored packets) must NOT be confused with absence.
    const parsed = JSON.parse(JSON.stringify(available(0)));
    expect(isAvailable(parsed)).toBe(true);
    expect(parsed.value).toBe(0);
  });
});
