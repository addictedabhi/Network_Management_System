import { describe, it, expect } from 'vitest';
import {
  toAlarm,
  toDevice,
  toInterface,
  toAlertLogEntry,
  toEventLogEntry,
  toSyslogEntry
} from '../../src/librenms/mappers.js';

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

  // Regression: the panel showed the ERROR branch for the 2 REAL alarms because the mapper must
  // not throw on the live LibreNMS 25.7.0 `/api/v0/alerts?state=1` row shape. These rows are the
  // EXACT keys/types captured from the live stack on 2026-08-11 (values redacted where sensitive).
  const LIVE_HIGH_CPU = {
    hostname: 'sim-router-01',
    id: 17,
    device_id: 5,
    rule_id: 2,
    state: 1,
    alerted: 1,
    open: 1,
    note: null,
    timestamp: '2026-08-11 08:18:47',
    info: '',
    severity: 'warning',
    name: 'NMS: High CPU utilisation',
    proc: null,
    notes: null
  };
  const LIVE_DEVICE_DOWN = {
    hostname: '172.16.10.22',
    id: 7,
    device_id: 6,
    rule_id: 1,
    state: 1,
    alerted: 1,
    open: 1,
    note: null,
    timestamp: '2026-08-11 08:00:00',
    info: '',
    severity: 'critical',
    name: 'NMS: Device down',
    proc: null,
    notes: null
  };

  it('maps a REAL live LibreNMS alert row (High CPU) without throwing', () => {
    const a = toAlarm(LIVE_HIGH_CPU);
    expect(a).toMatchObject({
      id: '17',
      deviceId: '5',
      deviceHostname: 'sim-router-01',
      severity: 'warning',
      ruleName: 'NMS: High CPU utilisation',
      acknowledged: false
    });
  });

  it('maps a REAL live LibreNMS alert row (Device down) without throwing', () => {
    const a = toAlarm(LIVE_DEVICE_DOWN);
    expect(a).toMatchObject({
      id: '7',
      deviceHostname: '172.16.10.22',
      severity: 'critical',
      ruleName: 'NMS: Device down'
    });
  });

  it('takes the rule name from the live `name` field (this endpoint has no `rule` key)', () => {
    expect(toAlarm(LIVE_HIGH_CPU).ruleName).toBe('NMS: High CPU utilisation');
  });

  it('tolerates a numeric severity level from other LibreNMS shapes', () => {
    expect(toAlarm({ id: 1, device_id: 1, severity: 5 }).severity).toBe('critical');
    expect(toAlarm({ id: 1, device_id: 1, severity: 2 }).severity).toBe('warning');
    expect(toAlarm({ id: 1, device_id: 1, severity: 0 }).severity).toBe('ok');
  });

  it('maps a valid alert row that merely lacks assumed fields — does not throw', () => {
    // Benign shape difference: only the bare minimum present. Must map, never error.
    const a = toAlarm({ id: 99, device_id: 3 });
    expect(a.id).toBe('99');
    expect(a.ruleName).toBe('unknown rule');
    expect(a.severity).toBe('ok');
  });

  it('still ERRORS on a genuinely malformed (non-object) alert row', () => {
    // A garbage upstream response is a true failure and must surface as an error (502), not map.
    expect(() => toAlarm('not-an-object')).toThrow();
    expect(() => toAlarm(42)).toThrow();
    expect(() => toAlarm(null)).toThrow();
  });

  // Same fail-closed shape as toAlarm: a sparse-but-valid row must MAP; a genuinely-garbage
  // (non-object) row must surface as a clean UPSTREAM error (502), never a raw ZodError → 500.
  it('toDevice maps a sparse-but-valid row without throwing', () => {
    const d = toDevice({ device_id: 42 });
    expect(d.id).toBe('42');
    expect(d.hostname).toBe('unknown');
    expect(d.reachability).toBe('unknown');
    expect(d.uptimeSeconds.status).toBe('unavailable');
  });

  it('toDevice errors cleanly (502 UPSTREAM_ERROR) on a genuinely malformed (non-object) row', () => {
    for (const garbage of ['not-an-object', 42, null]) {
      let caught: unknown;
      try {
        toDevice(garbage);
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
    }
  });

  it('toInterface maps a sparse-but-valid row without throwing', () => {
    const p = toInterface({ port_id: 7 });
    expect(p.id).toBe('7');
    expect(p.name).toBe('unknown');
    expect(p.inOctetsRate.status).toBe('unavailable');
  });

  it('toInterface errors cleanly (502 UPSTREAM_ERROR) on a genuinely malformed (non-object) row', () => {
    for (const garbage of ['not-an-object', 42, null]) {
      let caught: unknown;
      try {
        toInterface(garbage);
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
    }
  });
});

describe('log mappers — tolerant map of real-shaped rows, honest error on garbage (N1/N2)', () => {
  // Shapes verified against LibreNMS 25.7.0 `list_logs` (includes/html/api_functions.inc.php):
  // alertlog LEFT JOINs devices → hostname/sysName; alert_log carries id/device_id/rule_id/state/
  // time_logged/details (details is decoded server-side to an object).
  it('toAlertLogEntry maps a real alertlog row (details already decoded to an object)', () => {
    const e = toAlertLogEntry({
      hostname: 'sim-router-01',
      sysName: 'sim-router-01',
      id: 42,
      device_id: 4,
      rule_id: 3,
      state: 1,
      time_logged: '2026-08-12 10:00:00',
      details: { rule: 'High CPU utilisation' }
    });
    expect(e).toMatchObject({
      id: '42',
      deviceId: '4',
      hostname: 'sim-router-01',
      ruleId: '3',
      state: 1,
      detail: 'High CPU utilisation',
      loggedAt: '2026-08-12 10:00:00'
    });
  });

  it('toAlertLogEntry maps a sparse-but-valid row (missing details/rule_id) without throwing', () => {
    const e = toAlertLogEntry({ id: 7, device_id: 2, state: 0, time_logged: '2026-08-12 09:00:00' });
    expect(e.id).toBe('7');
    expect(e.detail).toBeNull();
    expect(e.ruleId).toBeNull();
    expect(e.hostname).toBeNull();
  });

  it('toAlertLogEntry tolerates a string details blob and a numeric-string state', () => {
    const e = toAlertLogEntry({ id: 8, device_id: 2, state: '2', details: 'recovered' });
    expect(e.detail).toBe('recovered');
    expect(e.state).toBe(2);
  });

  it('toEventLogEntry maps a real eventlog row', () => {
    const e = toEventLogEntry({
      hostname: 'sim-switch-01',
      event_id: 100,
      device_id: 3,
      message: 'Device polled successfully',
      type: 'poller',
      datetime: '2026-08-12 08:00:00'
    });
    expect(e).toMatchObject({
      id: '100',
      deviceId: '3',
      hostname: 'sim-switch-01',
      message: 'Device polled successfully',
      type: 'poller',
      loggedAt: '2026-08-12 08:00:00'
    });
  });

  it('toSyslogEntry maps a real syslog row', () => {
    const e = toSyslogEntry({
      hostname: 'sim-router-01',
      seq: 5,
      device_id: 4,
      msg: 'link down eth0',
      program: 'kernel',
      priority: 'warning',
      timestamp: '2026-08-12 07:00:00'
    });
    expect(e).toMatchObject({
      id: '5',
      message: 'link down eth0',
      program: 'kernel',
      priority: 'warning'
    });
  });

  it('honest EMPTY vs ERROR: a valid row maps; genuine garbage (non-object) errors cleanly (502)', () => {
    // An empty result is the ABSENCE of rows (handled by the client, not the mapper) — the mapper
    // never fabricates a row. Only a genuinely-malformed non-object row is a clean UPSTREAM error.
    for (const mapper of [toAlertLogEntry, toEventLogEntry, toSyslogEntry]) {
      for (const garbage of ['not-an-object', 42, null, undefined]) {
        let caught: unknown;
        try {
          mapper(garbage);
        } catch (e) {
          caught = e;
        }
        expect(caught).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
      }
    }
  });
});
