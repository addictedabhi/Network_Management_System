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

  it('never represents an unavailable metric as zero', () => {
    const m = unavailable('NO_DATA');
    expect(JSON.stringify(m)).not.toContain('"value"');
  });
});
