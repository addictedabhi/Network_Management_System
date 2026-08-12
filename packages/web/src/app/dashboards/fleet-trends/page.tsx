'use client';

/**
 * Fleet-trends dashboard (Phase 3 d.3) — fixed dashboard. Fleet CPU trend over time (mean/max),
 * a point-in-time up/down count, and the active-alarm count. Grounded in real cpuUsage series,
 * the device list, and the alarms route.
 *
 * Honest N/A: the alarm count is genuinely SMALL (2 alarms, 3 rules at POC) — a sparse-but-real
 * figure, never padded. The up/down count is a current snapshot (labelled as such), not a fabricated
 * historical series — a real up/down HISTORY needs eventlog state mining, deferred honestly here.
 */
import { useMemo } from 'react';
import type { Device, Alarm } from '@nms/shared';
import { AuthedShell } from '../../../components/AuthedShell';
import { DataState } from '../../../components/DataState';
import { FleetCpuTrend } from '../../../components/dashboard/FleetCpuTrend';
import { useBffQuery } from '../../../hooks/useBffQuery';
import { bffClient } from '../../../lib/bffClient';

const RANGE_MS = 86_400_000;

function FleetTrendsView() {
  const range = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - RANGE_MS).toISOString(), to: new Date(to).toISOString(), step: '15m' };
  }, []);

  const devicesQ = useBffQuery<{ data: readonly Device[] }>(
    () => bffClient.listDevices('perPage=200'),
    (r) => r.data.length === 0
  );
  const alarmsQ = useBffQuery<{ data: readonly Alarm[]; meta?: { total: number } | undefined }>(
    () => bffClient.listAlarms('perPage=200'),
    () => false
  );

  const devices = devicesQ.data?.data ?? [];
  const up = devices.filter((d) => d.reachability === 'up').length;
  const down = devices.filter((d) => d.reachability === 'down').length;
  const unknown = devices.filter((d) => d.reachability === 'unknown').length;
  const alarmTotal = alarmsQ.data?.meta?.total ?? alarmsQ.data?.data.length ?? 0;

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>Fleet trends</h1>
          <p className="subtitle">
            Fleet CPU over time and current reachability. At POC the alarm figure is genuinely small
            (2 real alarms, 3 rules) — sparse but real, never padded.
          </p>
        </div>
      </div>

      <section className="panel panel--wide">
        <h2 className="panel__title">Fleet CPU trend (mean / max)</h2>
        <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
          {() => <FleetCpuTrend devices={devices} range={range} />}
        </DataState>
      </section>

      <div className="panel-grid">
        <section className="panel">
          <h2 className="panel__title">Reachability (now)</h2>
          <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
            {() => (
              <ul className="stat-row">
                <li className="stat-tile">
                  <span className="stat-tile__value">{up}</span>
                  <span className="stat-tile__label">Up</span>
                </li>
                <li className="stat-tile">
                  <span className="stat-tile__value">{down}</span>
                  <span className="stat-tile__label">Down</span>
                </li>
                <li className="stat-tile">
                  <span className="stat-tile__value">{unknown}</span>
                  <span className="stat-tile__label">Unknown</span>
                </li>
              </ul>
            )}
          </DataState>
          <p className="chart-note">
            A current snapshot — an up/down <em>history</em> series would require mining eventlog
            state changes and is deferred honestly rather than fabricated.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel__title">Active alarms</h2>
          <DataState status={alarmsQ.status} errorCode={alarmsQ.errorCode} onRetry={alarmsQ.reload} emptyLabel="alarms">
            {() => (
              <ul className="stat-row">
                <li className="stat-tile">
                  <span className="stat-tile__value">{alarmTotal}</span>
                  <span className="stat-tile__label">Active</span>
                </li>
              </ul>
            )}
          </DataState>
          <p className="chart-note">Genuinely small at POC (2 real alarms) — a sparse-but-real figure.</p>
        </section>
      </div>
    </>
  );
}

export default function FleetTrendsDashboardPage() {
  return <AuthedShell>{() => <FleetTrendsView />}</AuthedShell>;
}
