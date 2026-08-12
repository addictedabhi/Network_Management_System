'use client';

/**
 * Alarm console — the full-page alarm operations surface (Phase 3 a, FR-30..35). Beyond the
 * dashboard AlarmFeed widget: a filterable, server-paginated alarm TABLE, the server-side-gated ack
 * workflow, and a per-alarm state-transition timeline (N1).
 *
 * Four DISTINCT data states everywhere (loading / error / empty / unavailable). Ack is role-gated
 * SERVER-SIDE (engineer/admin; operator + readonly get 403); the button is shown only when
 * `canAcknowledge`, but that is presentation — the 403 is the control (NFR-11). At POC only 2 real
 * alarms fire and 3 rules exist, so the list + filter dropdowns are honestly sparse, not fabricated.
 */
import { useMemo, useState } from 'react';
import type { Alarm, AlarmSeverity, SessionInfo, PageMeta } from '@nms/shared';
import { AuthedShell } from '../../components/AuthedShell';
import { DataState } from '../../components/DataState';
import { AlarmHistoryTimeline } from '../../components/alarms/AlarmHistoryTimeline';
import { useBffQuery } from '../../hooks/useBffQuery';
import { bffClient } from '../../lib/bffClient';
import { relativeAge } from '../../lib/format';

const SEVERITIES: readonly (AlarmSeverity | 'all')[] = ['all', 'critical', 'warning', 'ok'];
const ACK_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'false', label: 'Unacknowledged' },
  { key: 'true', label: 'Acknowledged' }
] as const;
const PER_PAGE = 25;

function AlarmConsole({ session }: { session: SessionInfo }) {
  const [severity, setSeverity] = useState<AlarmSeverity | 'all'>('all');
  const [ackFilter, setAckFilter] = useState<(typeof ACK_FILTERS)[number]['key']>('all');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ perPage: String(PER_PAGE), page: String(page) });
    if (severity !== 'all') p.set('severity', severity);
    if (ackFilter !== 'all') p.set('acknowledged', ackFilter);
    return p.toString();
  }, [severity, ackFilter, page]);

  const { status, data, errorCode, reload } = useBffQuery<{
    data: readonly Alarm[];
    meta?: PageMeta | undefined;
  }>(
    () => bffClient.listAlarms(query),
    (r) => r.data.length === 0,
    [query]
  );

  const alarms = data?.data ?? [];
  // `device` is a free-text filter applied client-side over the current page (the BFF alarms route
  // filters by severity/ack; hostname is a UI convenience over the returned rows — honest, bounded).
  const shown = deviceFilter
    ? alarms.filter((a) => a.deviceHostname.toLowerCase().includes(deviceFilter.toLowerCase()))
    : alarms;
  const meta = data?.meta;

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
    <>
      <div className="dash-head">
        <div>
          <h1>Alarm Console</h1>
          <p className="subtitle">
            Active alarms from the AIRNMS collection engine, with acknowledgement and per-alarm
            history. At this POC scale only genuinely-fired alarms appear — the list is honestly
            short, never padded.
          </p>
        </div>
      </div>

      <div className="toolbar" role="group" aria-label="Filter alarms">
        <label className="field field--inline">
          <span className="field__label">Severity</span>
          <select
            className="input"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as AlarmSeverity | 'all');
              setPage(1);
            }}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All severities' : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span className="field__label">State</span>
          <select
            className="input"
            value={ackFilter}
            onChange={(e) => {
              setAckFilter(e.target.value as (typeof ACK_FILTERS)[number]['key']);
              setPage(1);
            }}
          >
            {ACK_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span className="field__label">Device</span>
          <input
            className="input"
            type="search"
            placeholder="Filter by hostname"
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
          />
        </label>
      </div>

      {ackError ? (
        <div role="alert" className="data-state data-state--error">
          {ackError}
        </div>
      ) : null}

      <section className="panel panel--wide">
        <DataState
          status={status}
          errorCode={errorCode}
          onRetry={reload}
          emptyMessage="No active alarms match these filters."
        >
          {() => (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Active alarms, filterable and acknowledgeable.</caption>
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">Rule</th>
                    <th scope="col">Device</th>
                    <th scope="col">Raised</th>
                    <th scope="col">State</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className={selectedId === a.id ? 'is-selected' : undefined}>
                      <td>
                        <span className={`sev sev--${a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'ok'}`}>
                          <span aria-hidden="true">●</span> {a.severity}
                        </span>
                      </td>
                      <td>{a.ruleName}</td>
                      <td>{a.deviceHostname}</td>
                      <td title={a.firstRaisedAt}>{relativeAge(a.firstRaisedAt)}</td>
                      <td>
                        {a.acknowledged ? `Acknowledged${a.acknowledgedBy ? ` by ${a.acknowledgedBy}` : ''}` : 'Open'}
                      </td>
                      <td className="table__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-expanded={selectedId === a.id}
                          onClick={() => setSelectedId(selectedId === a.id ? null : a.id)}
                        >
                          {selectedId === a.id ? 'Hide history' : 'History'}
                        </button>
                        {session.canAcknowledge && !a.acknowledged ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => acknowledge(a.id)}
                          >
                            Acknowledge
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {shown.length > 0 && deviceFilter && shown.length !== alarms.length ? (
                <p className="table__note">
                  Showing {shown.length} of {alarms.length} on this page matching “{deviceFilter}”.
                </p>
              ) : null}

              {meta ? (
                <div className="pager" role="navigation" aria-label="Alarm pages">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="pager__label">
                    Page {page} · {meta.total} total
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!meta.hasNext}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </DataState>
      </section>

      {selectedId ? (
        <section className="panel panel--wide">
          <h2 className="panel__title">Alarm history · #{selectedId}</h2>
          <AlarmHistoryTimeline alarmId={selectedId} />
        </section>
      ) : null}
    </>
  );
}

export default function AlarmsPage() {
  return <AuthedShell>{(session) => <AlarmConsole session={session} />}</AuthedShell>;
}
