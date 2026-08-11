'use client';

/**
 * Enhanced device inventory (design Item 2). Server-side paginated, sortable, per-column filterable,
 * and free-text searchable via the BFF (`windowPage` — real total/limit/offset at POC scale).
 * Loading / error / empty are explicit (FR-43). Expandable rows show per-device KPIs; an absent
 * metric shows "Not available", never 0 (FR-24). Row actions are role-gated SERVER-SIDE.
 */
import { useCallback, useMemo, useState } from 'react';
import { AuthedShell } from '../../components/AuthedShell';
import { DataState } from '../../components/DataState';
import { DeviceTable } from '../../components/DeviceTable';
import { useBffQuery } from '../../hooks/useBffQuery';
import { useDeviceTableState } from '../../hooks/useDeviceTableState';
import { bffClient } from '../../lib/bffClient';
import type { Device, Alarm, SessionInfo, PageMeta } from '@nms/shared';

const KINDS = ['router', 'switch', 'p2p', 'other'] as const;
const REACHABILITIES = ['up', 'down', 'unknown'] as const;

function InventoryView({ session }: { session: SessionInfo }) {
  const table = useDeviceTableState();

  const { status, data, errorCode, reload } = useBffQuery<{
    data: readonly Device[];
    meta?: PageMeta | undefined;
  }>(
    () => bffClient.listDevices(table.query),
    (r) => r.data.length === 0,
    [table.query]
  );

  // Alarm counts per device (real active alarms) — used for the alarm-count column. An honest 0 for
  // any device not present in the set; never a fabricated number.
  const alarmsQ = useBffQuery<{ data: readonly Alarm[] }>(
    () => bffClient.listAlarms('perPage=200'),
    () => false
  );
  const alarmCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of alarmsQ.data?.data ?? []) {
      if (!a.acknowledged) counts[a.deviceId] = (counts[a.deviceId] ?? 0) + 1;
    }
    return counts;
  }, [alarmsQ.data]);

  const [actionError, setActionError] = useState<string | null>(null);

  const openNative = useCallback(async (deviceId: string) => {
    setActionError(null);
    try {
      const { url } = await bffClient.getAdminPortalUrl(deviceId);
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open the native portal.');
    }
  }, []);

  const acknowledge = useCallback(
    async (deviceId: string) => {
      setActionError(null);
      // Acknowledge every active alarm on the device; the SERVER re-checks the role each call.
      const ids = (alarmsQ.data?.data ?? []).filter((a) => a.deviceId === deviceId && !a.acknowledged);
      try {
        await Promise.all(ids.map((a) => bffClient.ackAlarm(a.id)));
        alarmsQ.reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Acknowledge failed (server-side check).');
      }
    },
    [alarmsQ]
  );

  return (
    <>
      <h1>Device Inventory</h1>
      <p className="subtitle">Live devices discovered and polled by the AIRNMS collection engine.</p>

      <div className="toolbar toolbar--filters">
        <label className="field">
          <span className="field__label">Search hostname</span>
          <input
            type="search"
            className="input"
            value={table.state.search}
            placeholder="e.g. sim-radio"
            onChange={(e) => table.setFilter('search', e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Type</span>
          <select className="input" value={table.state.kind} onChange={(e) => table.setFilter('kind', e.target.value)}>
            <option value="">All</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Reachability</span>
          <select
            className="input"
            value={table.state.reachability}
            onChange={(e) => table.setFilter('reachability', e.target.value)}
          >
            <option value="">All</option>
            {REACHABILITIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn--secondary" onClick={table.reset}>
          Reset
        </button>
      </div>

      {actionError ? (
        <div role="alert" className="data-state data-state--error">
          {actionError}
        </div>
      ) : null}

      <DataState status={status} errorCode={errorCode} onRetry={reload} emptyLabel="devices">
        {() => (
          <>
            <DeviceTable
              devices={data!.data}
              alarmCounts={alarmCounts}
              sortColumn={table.state.sortColumn}
              sortDir={table.state.sortDir}
              onSort={table.toggleSort}
              canAcknowledge={session.canAcknowledge}
              canOpenAdminPortal={session.canOpenAdminPortal}
              onOpenNative={openNative}
              onAcknowledge={acknowledge}
            />
            {data!.meta ? (
              <div className="pager">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={table.state.page <= 1}
                  onClick={() => table.setPage(table.state.page - 1)}
                >
                  Previous
                </button>
                <span className="pager__info">
                  Page {data!.meta.page} · {data!.meta.total} device{data!.meta.total === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={!data!.meta.hasNext}
                  onClick={() => table.setPage(table.state.page + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
            <p className="chart-note">
              Filtering, sorting, and search are applied server-side at POC scale (tens of devices).
              A fleet beyond a few thousand devices would need a server-side cursor (future work).
            </p>
          </>
        )}
      </DataState>
    </>
  );
}

export default function DevicesPage() {
  return <AuthedShell>{(session) => <InventoryView session={session} />}</AuthedShell>;
}
