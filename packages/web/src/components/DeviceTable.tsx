'use client';

/**
 * The enhanced device inventory table (design Item 2).
 *
 * - Expandable rows reveal per-device KPIs (<DeviceKpiPanel>), each honestly "Not available" when a
 *   metric is absent (FR-24) — never a fabricated 0.
 * - Reachability is a <StatusBadge> (icon + text, NFR-30) — colour is never the only signal.
 * - Sort headers, per-column filters, and free-text search are SERVER-SIDE (applied in the BFF over
 *   the fetched LibreNMS set, then windowed — design A.3); this component only raises the intent.
 * - Row actions: view detail, "Open in native LibreNMS" (role-gated server-side), and acknowledge
 *   (role-gated server-side — the button is hidden for non-privileged roles as presentation only;
 *   the SERVER is the gate, FR-34/NFR-11).
 * - Density toggle + column show/hide are client-side view state with no data impact.
 */
import { Fragment, useState } from 'react';
import Link from 'next/link';
import type { Device } from '@nms/shared';
import { MetricValueCell } from './MetricValueCell';
import { StatusBadge, type BadgeState } from './StatusBadge';
import { DeviceKpiPanel } from './DeviceKpiPanel';
import { formatUptime } from '../lib/format';
import type { SortColumn, SortDir } from '../hooks/useDeviceTableState';

export type Density = 'comfortable' | 'compact';
export type ColumnKey = 'kind' | 'location' | 'reachability' | 'alarms' | 'uptime';

export interface DeviceTableProps {
  readonly devices: readonly Device[];
  /** deviceId → active alarm count. Absent id = 0 alarms (honest empty, not fabricated). */
  readonly alarmCounts?: Readonly<Record<string, number>>;
  readonly sortColumn: SortColumn;
  readonly sortDir: SortDir;
  readonly onSort: (c: SortColumn) => void;
  /** Presentation hint only — the BFF re-checks the role on every ack (NFR-11). */
  readonly canAcknowledge: boolean;
  readonly canOpenAdminPortal: boolean;
  readonly onAcknowledge?: (deviceId: string) => void;
  readonly onOpenNative?: (deviceId: string) => void;
}

const ALL_COLUMNS: readonly { key: ColumnKey; label: string; sortable?: SortColumn }[] = [
  { key: 'kind', label: 'Type', sortable: 'kind' },
  { key: 'location', label: 'Location', sortable: 'location' },
  { key: 'reachability', label: 'Reachability', sortable: 'reachability' },
  { key: 'alarms', label: 'Alarms' },
  { key: 'uptime', label: 'Uptime' }
];

function badgeState(r: Device['reachability']): BadgeState {
  return r; // 'flapping' would come from a BFF-asserted field; not present at POC.
}

function SortHeader({
  label,
  col,
  active,
  dir,
  onSort
}: {
  label: string;
  col: SortColumn;
  active: boolean;
  dir: SortDir;
  onSort: (c: SortColumn) => void;
}) {
  const indicator = active ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th scope="col">
      <button
        type="button"
        className="table__sort"
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => onSort(col)}
      >
        {label}
        <span aria-hidden="true">{indicator}</span>
      </button>
    </th>
  );
}

export function DeviceTable(props: DeviceTableProps) {
  const { devices, alarmCounts, sortColumn, sortDir, onSort } = props;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>('comfortable');
  const [hidden, setHidden] = useState<ReadonlySet<ColumnKey>>(new Set());

  const shown = ALL_COLUMNS.filter((c) => !hidden.has(c.key));
  const toggleColumn = (key: ColumnKey) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="device-table">
      <div className="device-table__controls">
        <fieldset className="control-group" aria-label="Row density">
          <legend>Density</legend>
          <label>
            <input
              type="radio"
              name="density"
              checked={density === 'comfortable'}
              onChange={() => setDensity('comfortable')}
            />
            Comfortable
          </label>
          <label>
            <input
              type="radio"
              name="density"
              checked={density === 'compact'}
              onChange={() => setDensity('compact')}
            />
            Compact
          </label>
        </fieldset>
        <fieldset className="control-group" aria-label="Show or hide columns">
          <legend>Columns</legend>
          {ALL_COLUMNS.map((c) => (
            <label key={c.key}>
              <input
                type="checkbox"
                checked={!hidden.has(c.key)}
                onChange={() => toggleColumn(c.key)}
              />
              {c.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="table-scroll">
        <table className={`table table--${density}`}>
          <thead>
            <tr>
              <th scope="col" className="table__expander" aria-label="Expand" />
              <SortHeader
                label="Hostname"
                col="hostname"
                active={sortColumn === 'hostname'}
                dir={sortDir}
                onSort={onSort}
              />
              {shown.map((c) =>
                c.sortable ? (
                  <SortHeader
                    key={c.key}
                    label={c.label}
                    col={c.sortable}
                    active={sortColumn === c.sortable}
                    dir={sortDir}
                    onSort={onSort}
                  />
                ) : (
                  <th scope="col" key={c.key}>
                    {c.label}
                  </th>
                )
              )}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const isOpen = expanded === d.id;
              const count = alarmCounts?.[d.id] ?? 0;
              return (
                <Fragment key={d.id}>
                  <tr className={isOpen ? 'is-expanded' : undefined}>
                    <td className="table__expander">
                      <button
                        type="button"
                        className="table__expand-btn"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Collapse ${d.hostname}` : `Expand ${d.hostname}`}
                        onClick={() => setExpanded(isOpen ? null : d.id)}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    </td>
                    <td>
                      <Link href={`/devices/${encodeURIComponent(d.id)}`}>{d.hostname}</Link>
                    </td>
                    {shown.map((c) => {
                      if (c.key === 'kind') return <td key={c.key}>{d.kind}</td>;
                      if (c.key === 'location') return <td key={c.key}>{d.location ?? '—'}</td>;
                      if (c.key === 'reachability')
                        return (
                          <td key={c.key}>
                            <StatusBadge state={badgeState(d.reachability)} />
                          </td>
                        );
                      if (c.key === 'alarms')
                        return (
                          <td key={c.key}>
                            {count > 0 ? (
                              <span className="alarm-count alarm-count--active">{count}</span>
                            ) : (
                              <span className="alarm-count alarm-count--none" title="No active alarms">
                                0
                              </span>
                            )}
                          </td>
                        );
                      return (
                        <td key={c.key}>
                          <MetricValueCell metric={d.uptimeSeconds} format={formatUptime} />
                        </td>
                      );
                    })}
                    <td className="table__actions">
                      <Link className="btn btn--ghost-dark" href={`/devices/${encodeURIComponent(d.id)}`}>
                        Detail
                      </Link>
                      {props.canOpenAdminPortal && props.onOpenNative ? (
                        <button
                          type="button"
                          className="btn btn--ghost-dark"
                          onClick={() => props.onOpenNative!(d.id)}
                        >
                          Open in native
                        </button>
                      ) : null}
                      {props.canAcknowledge && count > 0 && props.onAcknowledge ? (
                        <button
                          type="button"
                          className="btn btn--ghost-dark"
                          onClick={() => props.onAcknowledge!(d.id)}
                        >
                          Acknowledge
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="device-table__detail-row">
                      <td colSpan={shown.length + 3}>
                        <DeviceKpiPanel device={d} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
