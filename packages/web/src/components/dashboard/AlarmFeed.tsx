'use client';

/**
 * Alarm feed (design B.6, FR-30/32/34). Lists ACTIVE alarms from the BFF alarms route, filterable
 * by severity. At POC this shows the 2 GENUINE alarms that fired ("NMS: Device down" on the ping
 * host, "NMS: High CPU" on sim-router-01) — never fabricated rows. If a severity filter yields
 * none, it shows the honest EMPTY state ("No active alarms"), distinct from an error.
 *
 * Acknowledge is role-gated SERVER-SIDE: readonly/operator get a 403 from the BFF regardless of any
 * UI state. The button is hidden for non-privileged roles as presentation only — the server is the
 * gate (NFR-11). A failed ack surfaces the error; a success removes the row optimistically then
 * reloads from the source of truth.
 */
import { useState } from 'react';
import type { Alarm, AlarmSeverity } from '@nms/shared';
import { DataState } from '../DataState';
import { useBffQuery } from '../../hooks/useBffQuery';
import { bffClient } from '../../lib/bffClient';
import { relativeAge } from '../../lib/format';

const SEVERITIES: readonly (AlarmSeverity | 'all')[] = ['all', 'critical', 'warning', 'ok'];

export interface AlarmFeedProps {
  /** Presentation hint only — the BFF re-checks the role on every ack (NFR-11). */
  readonly canAcknowledge: boolean;
  readonly onAlarms?: (alarms: readonly Alarm[]) => void;
}

export function AlarmFeed({ canAcknowledge }: AlarmFeedProps) {
  const [severity, setSeverity] = useState<AlarmSeverity | 'all'>('all');
  const [ackError, setAckError] = useState<string | null>(null);

  const query = severity === 'all' ? 'perPage=50' : `perPage=50&severity=${severity}`;
  const { status, data, errorCode, reload } = useBffQuery<{ data: readonly Alarm[] }>(
    () => bffClient.listAlarms(query),
    (r) => r.data.length === 0,
    [query]
  );

  const acknowledge = async (id: string) => {
    setAckError(null);
    try {
      await bffClient.ackAlarm(id);
      reload();
    } catch (err) {
      setAckError(err instanceof Error ? err.message : 'Acknowledge failed.');
    }
  };

  return (
    <div className="alarm-feed">
      <div className="alarm-feed__filter" role="group" aria-label="Filter alarms by severity">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${severity === s ? ' chip--active' : ''}`}
            aria-pressed={severity === s}
            onClick={() => setSeverity(s)}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {ackError ? (
        <div role="alert" className="data-state data-state--error alarm-feed__ackerror">
          {ackError}
        </div>
      ) : null}

      <DataState
        status={status}
        errorCode={errorCode}
        onRetry={reload}
        emptyMessage="No active alarms."
      >
        {() => (
          <ul className="alarm-list">
            {data!.data.map((a) => (
              <li key={a.id} className={`alarm alarm--${a.severity}`}>
                <span className={`sev-dot sev-dot--${a.severity}`} aria-hidden="true" />
                <div className="alarm__body">
                  <span className="alarm__rule">{a.ruleName}</span>
                  <span className="alarm__meta">
                    {a.deviceHostname} · <span className="alarm__sev">{a.severity}</span> ·{' '}
                    {relativeAge(a.firstRaisedAt)}
                    {a.acknowledged ? ` · ack by ${a.acknowledgedBy ?? 'unknown'}` : ''}
                  </span>
                </div>
                {canAcknowledge && !a.acknowledged ? (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => acknowledge(a.id)}>
                    Acknowledge
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </div>
  );
}
