'use client';

/**
 * Operational dashboard (design Item 3). Fleet KPI tiles, the P2P link matrix centerpiece, Top-N
 * interfaces by 95th-percentile bandwidth, a throughput time-series, a CPU/memory heatmap, and the
 * alarm feed. Every panel has four DISTINCT states — loading / error / empty / unavailable — and
 * never renders a fabricated 0 for an absent metric (FR-24, FR-43). Charts are ECharts (canvas,
 * ES-module bundled) so they render under the strict nonce CSP without `unsafe-inline`.
 */
import { useMemo, useState } from 'react';
import { AuthedShell } from '../../components/AuthedShell';
import { DataState } from '../../components/DataState';
import { AdminPortalLink } from '../../components/AdminPortalLink';
import { FleetKpiTiles } from '../../components/dashboard/FleetKpiTiles';
import { P2PLinkMatrix } from '../../components/dashboard/P2PLinkMatrix';
import { TopInterfaces } from '../../components/dashboard/TopInterfaces';
import { ThroughputChart } from '../../components/dashboard/ThroughputChart';
import { CpuMemHeatmap } from '../../components/dashboard/CpuMemHeatmap';
import { AlarmFeed } from '../../components/dashboard/AlarmFeed';
import { useBffQuery } from '../../hooks/useBffQuery';
import { bffClient } from '../../lib/bffClient';
import type { Device, Alarm, SessionInfo } from '@nms/shared';

const WINDOWS = [
  { key: '1h', label: 'Last 1h', ms: 3600_000, step: '1m' },
  { key: '24h', label: 'Last 24h', ms: 86_400_000, step: '15m' },
  { key: '7d', label: 'Last 7d', ms: 604_800_000, step: '1h' },
  { key: '30d', label: 'Last 30d', ms: 2_592_000_000, step: '6h' }
] as const;

function DashboardView({ session }: { session: SessionInfo }) {
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]['key']>('24h');
  const win = WINDOWS.find((w) => w.key === windowKey)!;
  const range = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - win.ms).toISOString(), to: new Date(to).toISOString(), step: win.step };
  }, [win.ms, win.step, windowKey]);

  const devicesQ = useBffQuery<{ data: readonly Device[] }>(
    () => bffClient.listDevices('perPage=200'),
    (r) => r.data.length === 0
  );
  const alarmsQ = useBffQuery<{ data: readonly Alarm[] }>(
    () => bffClient.listAlarms('perPage=200'),
    () => false
  );

  const devices = devicesQ.data?.data ?? [];
  const alarms = alarmsQ.data?.data ?? [];
  const radios = devices.filter((d) => d.kind === 'p2p');
  const throughputDevice = devices.find((d) => d.kind === 'switch' || d.kind === 'router');

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>Operational Dashboard</h1>
          <p className="subtitle">
            Live fleet health from the AIRNMS collection engine. Panels with no collected metric
            read &ldquo;Not available&rdquo; — never a fabricated zero.
          </p>
        </div>
        <div className="toolbar">
          <label className="field field--inline">
            <span className="field__label">Window</span>
            <select className="input" value={windowKey} onChange={(e) => setWindowKey(e.target.value as typeof windowKey)}>
              {WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <AdminPortalLink canOpenAdminPortal={session.canOpenAdminPortal} />
        </div>
      </div>

      {/* Fleet KPI tiles */}
      <DataState status={devicesQ.status === 'empty' ? 'success' : devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload}>
        {() => <FleetKpiTiles devices={devices} alarms={alarms} />}
      </DataState>

      {/* ★ P2P link matrix — centerpiece */}
      <section className="panel panel--wide">
        <h2 className="panel__title">P2P Link Performance</h2>
        <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
          {() => <P2PLinkMatrix radios={radios} />}
        </DataState>
      </section>

      <div className="panel-grid">
        <section className="panel">
          <h2 className="panel__title">Top interfaces (95th percentile)</h2>
          <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
            {() => <TopInterfaces devices={devices} range={range} />}
          </DataState>
        </section>

        <section className="panel">
          <h2 className="panel__title">CPU / memory utilisation</h2>
          <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
            {() => <CpuMemHeatmap devices={devices} />}
          </DataState>
        </section>

        <section className="panel">
          <h2 className="panel__title">
            Throughput {throughputDevice ? `· ${throughputDevice.displayName}` : ''}
          </h2>
          <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
            {() =>
              throughputDevice ? (
                <ThroughputChart device={throughputDevice} range={range} />
              ) : (
                <div className="data-state data-state--empty">
                  <p>No interface-bearing device to chart.</p>
                </div>
              )
            }
          </DataState>
        </section>

        <section className="panel">
          <h2 className="panel__title">Active alarms</h2>
          <AlarmFeed canAcknowledge={session.canAcknowledge} />
        </section>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return <AuthedShell>{(session) => <DashboardView session={session} />}</AuthedShell>;
}
