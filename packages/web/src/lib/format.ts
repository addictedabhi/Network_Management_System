/**
 * Pure display formatters. No side effects, unit-tested. These NEVER fabricate a value — they only
 * format a value the caller already has; absence is handled upstream by `MetricValue`/`<MetricValueCell>`.
 */

/** Human-readable uptime from seconds, e.g. `1d 4h 12m`. */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

/** Bytes-per-second to a human rate (SI-ish, base 1000), e.g. `1.2 kB/s`. */
export function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec)) return '—';
  const units = ['B/s', 'kB/s', 'MB/s', 'GB/s'];
  let v = bytesPerSec;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Bytes to a human size (base 1024), e.g. `1.4 GiB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Bits-per-second from bytes-per-second, for interface throughput display, e.g. `9.6 Mbps`. */
export function formatBitrate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec)) return '—';
  const bits = bytesPerSec * 8;
  const units = ['bps', 'kbps', 'Mbps', 'Gbps'];
  let v = bits;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** "Xs ago" / "Xm ago" freshness label from an ISO timestamp (FR-44). */
export function relativeAge(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
