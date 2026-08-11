import { describe, it, expect } from 'vitest';
import { toAlarm, toDevice, toInterface } from '../../src/librenms/mappers.js';

describe('librenms mappers — FR-24 (absent value is `unavailable`, never 0)', () => {
  it('maps an absent device uptime to `unavailable`, not 0', () => {
    const d = toDevice({ device_id: 1, hostname: 'r1' });
    expect(d.uptimeSeconds.status).toBe('unavailable');
    // The unavailable case has no `value` slot at all — a 0 is unrepresentable.
    expect((d.uptimeSeconds as { value?: number }).value).toBeUndefined();
  });

  it('maps a present uptime to `available` with the value', () => {
    const d = toDevice({ device_id: 1, hostname: 'r1', uptime: 12345 });
    expect(d.uptimeSeconds).toMatchObject({ status: 'available', value: 12345 });
  });

  it('maps a genuine 0 uptime to available(0) — a real reading is NOT unavailable', () => {
    const d = toDevice({ device_id: 1, hostname: 'r1', uptime: 0 });
    expect(d.uptimeSeconds).toMatchObject({ status: 'available', value: 0 });
  });

  it('maps absent interface rates to `unavailable`, not 0', () => {
    const p = toInterface({ port_id: 5, device_id: 1, ifName: 'eth0' });
    expect(p.inOctetsRate.status).toBe('unavailable');
    expect(p.outOctetsRate.status).toBe('unavailable');
  });

  it('maps a non-numeric string rate to `unavailable`, not NaN or 0', () => {
    const p = toInterface({ port_id: 5, device_id: 1, ifName: 'eth0', ifInOctets_rate: 'n/a' });
    expect(p.inOctetsRate.status).toBe('unavailable');
  });

  it('parses a numeric string rate to available', () => {
    const p = toInterface({ port_id: 5, device_id: 1, ifInOctets_rate: '1024' });
    expect(p.inOctetsRate).toMatchObject({ status: 'available', value: 1024 });
  });

  it('maps device reachability from status: unknown when absent', () => {
    expect(toDevice({ device_id: 1 }).reachability).toBe('unknown');
    expect(toDevice({ device_id: 1, status: 1 }).reachability).toBe('up');
    expect(toDevice({ device_id: 1, status: 0 }).reachability).toBe('down');
  });

  it('normalizes alarm severity', () => {
    expect(toAlarm({ id: 1, device_id: 1, severity: 'critical' }).severity).toBe('critical');
    expect(toAlarm({ id: 1, device_id: 1, severity: 'warn' }).severity).toBe('warning');
    expect(toAlarm({ id: 1, device_id: 1, severity: 'unknown' }).severity).toBe('ok');
  });

  it('keeps a non-negative duration even with a future/garbage timestamp', () => {
    expect(toAlarm({ id: 1, device_id: 1, timestamp: 'not-a-date' }).durationSeconds).toBe(0);
  });
});
