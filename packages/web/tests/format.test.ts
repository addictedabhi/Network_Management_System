import { describe, it, expect } from 'vitest';
import { formatUptime, formatRate, formatBytes, formatBitrate, relativeAge } from '../src/lib/format';

describe('format helpers', () => {
  it('formats uptime from seconds', () => {
    expect(formatUptime(0)).toBe('0m');
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3661)).toBe('1h 1m');
    expect(formatUptime(90061)).toBe('1d 1h 1m');
  });

  it('formats byte rate', () => {
    expect(formatRate(500)).toBe('500 B/s');
    expect(formatRate(1500)).toBe('1.5 kB/s');
    expect(formatRate(2_500_000)).toBe('2.5 MB/s');
  });

  it('formats bytes (base 1024)', () => {
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1_610_612_736)).toBe('1.5 GiB');
  });

  it('formats bitrate from bytes/sec', () => {
    expect(formatBitrate(125_000)).toBe('1.0 Mbps'); // 125 kB/s * 8 = 1 Mbps
  });

  it('never fabricates a value for a non-finite input', () => {
    expect(formatUptime(NaN)).toBe('—');
    expect(formatRate(Infinity)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });

  it('produces a relative age label', () => {
    const now = Date.parse('2026-08-11T00:10:00Z');
    expect(relativeAge('2026-08-11T00:09:30Z', now)).toBe('30s ago');
    expect(relativeAge('2026-08-11T00:05:00Z', now)).toBe('5m ago');
    expect(relativeAge('not-a-date', now)).toBe('unknown');
  });
});
