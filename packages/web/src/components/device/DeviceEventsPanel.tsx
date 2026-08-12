'use client';

/**
 * Device events / syslog panel (Phase 3 c, N2). Reads `GET /devices/:id/events?source=…`. A source
 * toggle switches between eventlog (discovery/poll/state events — thin but REAL at POC) and syslog
 * (honestly EMPTY at POC: snmpsim devices emit no syslog, so "No syslog messages received" is the
 * deliverable, not a defect).
 *
 * Four DISTINCT states via <DataState>: loading / error / empty / success. An empty result is the
 * benign empty state, never conflated with a backend error.
 */
import { useState } from 'react';
import type { DeviceEventSource, EventLogEntry, SyslogEntry } from '@nms/shared';
import { DataState } from '../DataState';
import { useBffQuery } from '../../hooks/useBffQuery';
import { bffClient } from '../../lib/bffClient';
import { relativeAge } from '../../lib/format';

type LogRow = EventLogEntry | SyslogEntry;

function tag(source: DeviceEventSource, row: LogRow): string | null {
  if (source === 'syslog') return (row as SyslogEntry).program ?? (row as SyslogEntry).priority ?? null;
  return (row as EventLogEntry).type ?? null;
}

export function DeviceEventsPanel({ id }: { id: string }) {
  const [source, setSource] = useState<DeviceEventSource>('eventlog');

  const { status, data, errorCode, reload } = useBffQuery<{ data: readonly LogRow[] }>(
    () => bffClient.getDeviceEvents(id, source, 'perPage=50'),
    (r) => r.data.length === 0,
    [id, source]
  );

  return (
    <>
      <div className="toolbar" role="group" aria-label="Log source">
        {(['eventlog', 'syslog'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${source === s ? ' chip--active' : ''}`}
            aria-pressed={source === s}
            onClick={() => setSource(s)}
          >
            {s === 'eventlog' ? 'Event log' : 'Syslog'}
          </button>
        ))}
      </div>

      <DataState
        status={status}
        errorCode={errorCode}
        onRetry={reload}
        emptyMessage={
          source === 'syslog'
            ? 'No syslog messages received from this device.'
            : 'No events recorded for this device.'
        }
      >
        {() => (
          <ul className="log-list" aria-label={source === 'syslog' ? 'Device syslog' : 'Device event log'}>
            {data!.data.map((row) => {
              const t = tag(source, row);
              return (
                <li key={row.id} className="log-list__row">
                  <span className="log-list__time" title={row.loggedAt}>
                    {relativeAge(row.loggedAt)}
                  </span>
                  {t ? <span className="log-list__tag">{t}</span> : null}
                  <span className="log-list__msg">{row.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </DataState>
    </>
  );
}
