/**
 * Log entry domain types for the LibreNMS log tables surfaced through the BFF (Phase 3, N1/N2).
 *
 * Three distinct sources map to distinct shapes:
 *   - `AlertLogEntry`   — alert state-transition history (`/api/v0/alertlog`): powers the alarm
 *                          console timeline and the fleet-trends alarm history.
 *   - `EventLogEntry`   — device eventlog (`/api/v0/eventlog/{id}`): discovery/poll/state events.
 *   - `SyslogEntry`     — device syslog (`/api/v0/syslog/{id}`): honest-empty at POC (snmpsim
 *                          devices do not emit syslog).
 *
 * All timestamps are strings as LibreNMS returns them ("YYYY-MM-DD HH:MM:SS"); the UI parses/format
 * at the boundary. Every field the UI does not strictly require is nullable so a benign upstream
 * shape difference maps rather than throws (the schema-surprise discipline — see the mappers).
 */

/** A single alert state-transition row (`alert_log`). `state` marks the transition kind. */
export interface AlertLogEntry {
  readonly id: string;
  readonly deviceId: string;
  readonly hostname: string | null;
  readonly ruleId: string | null;
  /** LibreNMS alert lifecycle state code (0 = ok/recovered, 1 = alert, 2 = ack, 3 = worse …). */
  readonly state: number | null;
  /** Human-readable transition detail derived from the (decompressed) `details` blob when present. */
  readonly detail: string | null;
  readonly loggedAt: string;
}

/** A single device eventlog row (`eventlog`). */
export interface EventLogEntry {
  readonly id: string;
  readonly deviceId: string;
  readonly hostname: string | null;
  readonly message: string;
  /** Event category as LibreNMS records it (e.g. "poller", "system", "interface"). */
  readonly type: string | null;
  readonly loggedAt: string;
}

/** A single device syslog row (`syslog`). */
export interface SyslogEntry {
  readonly id: string;
  readonly deviceId: string;
  readonly hostname: string | null;
  readonly message: string;
  /** Originating program/tag, when the device supplies one. */
  readonly program: string | null;
  /** Syslog priority as a string ("info"/"warning"/…) when present. */
  readonly priority: string | null;
  readonly loggedAt: string;
}

/** The two log sources a device-events request may select. */
export type DeviceEventSource = 'eventlog' | 'syslog';
