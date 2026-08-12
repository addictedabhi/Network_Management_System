'use client';

/**
 * Device detail — enriched depth (Phase 3 c). Identity + reachability + uptime, the interface table,
 * per-device metric-history graphs (CPU / mem / RF over time), per-port throughput, and the
 * device event/syslog panel. Every data region is a DataState with four DISTINCT states (FR-43).
 *
 * Honesty by device kind, grounded in the live-data reality (design §0):
 *   - switch / router → CPU + memory history + interface throughput (real `ports`/`processors`/`mempool`).
 *   - p2p radios → CPU + RF history (RSSI/SNR/Tx-Rx capacity); NO memory (AF60 has no hrStorage) →
 *     an honest "Not available" note, never a fabricated panel.
 *   - ping-only host (reachability but no SNMP) → an explicit ICMP-only panel; CPU/mem/interfaces
 *     are honestly unavailable, not zeroed.
 */
import { use, useMemo, useState } from 'react';
import { AuthedShell } from '../../../components/AuthedShell';
import { DataState } from '../../../components/DataState';
import { MetricValueCell } from '../../../components/MetricValueCell';
import { DeviceInterfacesPanel } from '../../../components/DeviceInterfacesPanel';
import { MetricHistoryChart } from '../../../components/device/MetricHistoryChart';
import { DeviceEventsPanel } from '../../../components/device/DeviceEventsPanel';
import { useBffQuery } from '../../../hooks/useBffQuery';
import { bffClient } from '../../../lib/bffClient';
import type { Device } from '@nms/shared';

const WINDOWS = [
  { key: '1h', label: 'Last 1h', ms: 3600_000, step: '1m' },
  { key: '24h', label: 'Last 24h', ms: 86_400_000, step: '15m' },
  { key: '7d', label: 'Last 7d', ms: 604_800_000, step: '1h' }
] as const;

function MetricGraphs({ device, range }: { device: Device; range: { from: string; to: string; step: string } }) {
  const isRadio = device.kind === 'p2p';

  // A ping-only / down host with no SNMP: every metric is honestly unavailable.
  if (device.kind === 'other' || device.reachability === 'down') {
    return (
      <div className="na-panel" role="note">
        <p>
          <strong>ICMP-only host.</strong> This device is monitored by ping alone (no SNMP), so CPU,
          memory, interface, and RF metrics are <em>Not available</em> — not zero.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-grid">
      <section className="panel">
        <h3 className="panel__title">CPU utilisation</h3>
        <MetricHistoryChart
          deviceId={device.id}
          hostname={device.hostname}
          metric="cpuUsage"
          label="CPU"
          unit="%"
          color="#1e88e5"
          range={range}
          valueFormatter={(v) => `${v.toFixed(0)}%`}
        />
      </section>

      {isRadio ? (
        <>
          <section className="panel">
            <h3 className="panel__title">RF · SNR</h3>
            <MetricHistoryChart
              deviceId={device.id}
              hostname={device.hostname}
              metric="af60StaSNR"
              label="SNR"
              unit="dB"
              color="#2e9e6b"
              range={range}
            />
          </section>
          <section className="panel">
            <h3 className="panel__title">RF · RSSI</h3>
            <MetricHistoryChart
              deviceId={device.id}
              hostname={device.hostname}
              metric="af60StaRSSI"
              label="RSSI"
              unit="dBm"
              color="#8e44ad"
              range={range}
            />
          </section>
          <section className="panel">
            <div className="na-panel" role="note">
              <p>
                <strong>Memory · Not available.</strong> AF60 radios do not expose an SNMP storage
                table, so memory utilisation is honestly unavailable for this device — never zeroed.
              </p>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="panel">
            <h3 className="panel__title">Memory used</h3>
            <MetricHistoryChart
              deviceId={device.id}
              hostname={device.hostname}
              metric="memUsedBytes"
              label="Memory used"
              color="#c0703a"
              range={range}
              valueFormatter={(v) => `${(v / 1024 / 1024).toFixed(0)} MiB`}
            />
          </section>
        </>
      )}
    </div>
  );
}

function DetailView({ id }: { id: string }) {
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]['key']>('24h');
  const win = WINDOWS.find((w) => w.key === windowKey)!;
  const range = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - win.ms).toISOString(), to: new Date(to).toISOString(), step: win.step };
  }, [win.ms, win.step, windowKey]);

  const device = useBffQuery<Device>(() => bffClient.getDevice(id), () => false, [id]);

  return (
    <>
      <div className="dash-head">
        <h1>Device Detail</h1>
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
        </div>
      </div>

      <DataState status={device.status} errorCode={device.errorCode} onRetry={device.reload}>
        {() => {
          const d = device.data!;
          return (
            <>
              <div className="card" style={{ marginBottom: '1.25rem' }}>
                <p>
                  <strong>{d.displayName}</strong> ({d.hostname})
                </p>
                <p>Type: {d.kind}</p>
                <p>Location: {d.location ?? '—'}</p>
                <p>
                  Reachability: <span className={`reach reach--${d.reachability}`}>{d.reachability}</span>
                </p>
                <p>
                  Uptime: <MetricValueCell metric={d.uptimeSeconds} unit="s" />
                </p>
              </div>

              <section className="panel panel--wide">
                <h2 className="panel__title">Metric history</h2>
                <MetricGraphs device={d} range={range} />
              </section>

              <section className="panel panel--wide">
                <DeviceInterfacesPanel id={id} />
              </section>

              <section className="panel panel--wide">
                <h2 className="panel__title">Events &amp; syslog</h2>
                <DeviceEventsPanel id={id} />
              </section>
            </>
          );
        }}
      </DataState>
    </>
  );
}

export default function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AuthedShell>{() => <DetailView id={id} />}</AuthedShell>;
}
