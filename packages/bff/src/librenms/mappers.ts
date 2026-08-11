/**
 * Pure mappers from raw LibreNMS REST payloads to `@nms/shared` domain types.
 *
 * The single most important guarantee here is FR-24 / NFR-22: a missing upstream numeric value
 * becomes an `unavailable` MetricValue, NEVER `0`. `toNumberMetric` is that guarantee in code —
 * the `unavailable` discriminant has no numeric slot, so there is nowhere to put a fabricated 0.
 *
 * These functions are pure (no I/O, no logging, no secrets) so they are trivially unit-tested.
 */
import {
  available,
  unavailable,
  type Alarm,
  type Device,
  type DeviceInterface,
  type DeviceKind,
  type AlarmSeverity,
  type Reachability
} from '@nms/shared';
import { z } from 'zod';
import { AppError } from '../http/middleware/errorHandler.js';

const numberish = z.union([z.number(), z.string()]).nullish();

function toNumberMetric(raw: unknown) {
  const parsed = numberish.safeParse(raw);
  if (!parsed.success || parsed.data === null || parsed.data === undefined) {
    return unavailable<number>('NO_DATA');
  }
  const n = typeof parsed.data === 'string' ? Number(parsed.data) : parsed.data;
  return Number.isFinite(n) ? available(n) : unavailable<number>('NO_DATA');
}

const KIND_BY_TYPE: Record<string, DeviceKind> = {
  network: 'switch',
  router: 'router',
  switch: 'switch',
  wireless: 'p2p'
};

/**
 * Tolerant alarm schema. VERIFIED against the LIVE LibreNMS 25.7.0 `/api/v0/alerts?state=1` row
 * (2026-08-11): keys `hostname,id,device_id,rule_id,state,alerted,open,note,timestamp,info,
 * severity,name,proc,notes` — `severity` a lowercase string ("warning"/"critical"), `name` the
 * rule name (there is NO `rule` key on this endpoint), `timestamp` a "YYYY-MM-DD HH:MM:SS" string.
 *
 * Every field is optional/nullable and unknown keys pass through, so a benign shape difference (a
 * missing assumed field, an extra field, a numeric severity from a different LibreNMS version) maps
 * to an `Alarm` instead of throwing. A missing key is defaulted, never fatal. Only a genuinely
 * malformed response (not an object at all) is rejected — see `toAlarm`.
 */
const alarmSchema = z
  .object({
    id: numberish,
    device_id: numberish,
    hostname: z.string().nullish(),
    sysName: z.string().nullish(),
    // Real rows carry a lowercase string; tolerate a numeric severity level from other versions.
    severity: z.union([z.string(), z.number()]).nullish(),
    rule: z.string().nullish(),
    // The live alerts endpoint puts the rule name in `name`; keep `rule` as an alternate.
    name: z.string().nullish(),
    timestamp: z.string().nullish(),
    // `acknowledged` may be absent; `state`/`open` describe the alert lifecycle on this endpoint.
    acknowledged: z.union([z.boolean(), z.number()]).nullish(),
    open: z.union([z.boolean(), z.number()]).nullish(),
    acked_by: z.string().nullish(),
    acked_at: z.string().nullish(),
    entity: z.string().nullish()
  })
  .passthrough();

function toSeverity(raw: string | number | null | undefined): AlarmSeverity {
  // Numeric severity levels (older/other LibreNMS shapes): higher = worse.
  if (typeof raw === 'number') {
    if (raw >= 4) return 'critical';
    if (raw >= 2) return 'warning';
    return 'ok';
  }
  switch ((raw ?? '').toLowerCase()) {
    case 'critical':
    case 'crit':
      return 'critical';
    case 'warning':
    case 'warn':
      return 'warning';
    default:
      return 'ok';
  }
}

export function toAlarm(raw: unknown): Alarm {
  // Fail-closed on genuine garbage (a non-object row is a malformed upstream response and SHOULD
  // error), but never throw on a valid alert row that merely lacks an assumed field — that benign
  // shape difference must MAP, so the succeeds-with-data path never renders as an error (FR-43).
  const parsed = alarmSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      'UPSTREAM_ERROR',
      'The monitoring engine returned a malformed alarm.',
      502
    );
  }
  const a = parsed.data;
  const firstRaisedAt = a.timestamp ?? new Date(0).toISOString();
  const parsedRaisedAt = Date.parse(firstRaisedAt);
  return {
    id: String(a.id ?? ''),
    deviceId: String(a.device_id ?? ''),
    deviceHostname: a.hostname ?? a.sysName ?? 'unknown',
    deviceKind: 'other',
    entity: a.entity ?? null,
    severity: toSeverity(a.severity),
    // Live endpoint uses `name`; `rule` kept as a fallback for other shapes.
    ruleName: a.name ?? a.rule ?? 'unknown rule',
    firstRaisedAt,
    durationSeconds: Number.isFinite(parsedRaisedAt)
      ? Math.max(0, Math.floor((Date.now() - parsedRaisedAt) / 1000))
      : 0,
    acknowledged: Boolean(a.acknowledged),
    acknowledgedBy: a.acked_by ?? null,
    acknowledgedAt: a.acked_at ?? null
  };
}

const deviceSchema = z
  .object({
    device_id: numberish,
    hostname: z.string().nullish(),
    sysName: z.string().nullish(),
    type: z.string().nullish(),
    location: z.string().nullish(),
    status: z.union([z.boolean(), z.number()]).nullish(),
    uptime: numberish
  })
  .passthrough();

export function toDevice(raw: unknown): Device {
  const d = deviceSchema.parse(raw);
  const reachability: Reachability =
    d.status === null || d.status === undefined ? 'unknown' : Boolean(d.status) ? 'up' : 'down';
  return {
    id: String(d.device_id ?? ''),
    hostname: d.hostname ?? 'unknown',
    displayName: d.sysName ?? d.hostname ?? 'unknown',
    kind: KIND_BY_TYPE[(d.type ?? '').toLowerCase()] ?? 'other',
    location: d.location ?? null,
    reachability,
    uptimeSeconds: toNumberMetric(d.uptime)
  };
}

const portSchema = z
  .object({
    port_id: numberish,
    device_id: numberish,
    ifName: z.string().nullish(),
    ifDescr: z.string().nullish(),
    ifAdminStatus: z.string().nullish(),
    ifOperStatus: z.string().nullish(),
    ifInOctets_rate: numberish,
    ifOutOctets_rate: numberish
  })
  .passthrough();

export function toInterface(raw: unknown): DeviceInterface {
  const p = portSchema.parse(raw);
  return {
    id: String(p.port_id ?? ''),
    deviceId: String(p.device_id ?? ''),
    name: p.ifName ?? p.ifDescr ?? 'unknown',
    adminState: (p.ifAdminStatus ?? '').toLowerCase() === 'up' ? 'up' : 'down',
    operState:
      (p.ifOperStatus ?? '').toLowerCase() === 'up'
        ? 'up'
        : (p.ifOperStatus ?? '').toLowerCase() === 'down'
          ? 'down'
          : 'unknown',
    inOctetsRate: toNumberMetric(p.ifInOctets_rate),
    outOctetsRate: toNumberMetric(p.ifOutOctets_rate)
  };
}
