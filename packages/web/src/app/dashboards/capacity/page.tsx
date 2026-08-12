'use client';

/**
 * Capacity dashboard (Phase 3 d.1) — a CONCRETE, fixed dashboard (NOT a user-arrangeable builder;
 * that is explicitly cut/deferred). Grounded strictly in metrics we have:
 *   - CPU/memory heatmap (reuses <CpuMemHeatmap> — switch+router+2 radios real; ping host N/A).
 *   - RF link capacity trends (Tx/Rx Capacity per radio via the series route).
 * Honest N/A is stated per panel: radio memory + ping-host everything render "Not available", never 0.
 */
import { useMemo } from 'react';
import type { Device } from '@nms/shared';
import { AuthedShell } from '../../../components/AuthedShell';
import { DataState } from '../../../components/DataState';
import { CpuMemHeatmap } from '../../../components/dashboard/CpuMemHeatmap';
import { MetricHistoryChart } from '../../../components/device/MetricHistoryChart';
import { useBffQuery } from '../../../hooks/useBffQuery';
import { bffClient } from '../../../lib/bffClient';

const RANGE_MS = 86_400_000;

function CapacityView() {
  const range = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - RANGE_MS).toISOString(), to: new Date(to).toISOString(), step: '15m' };
  }, []);

  const devicesQ = useBffQuery<{ data: readonly Device[] }>(
    () => bffClient.listDevices('perPage=200'),
    (r) => r.data.length === 0
  );
  const devices = devicesQ.data?.data ?? [];
  const radios = devices.filter((d) => d.kind === 'p2p');

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>Capacity</h1>
          <p className="subtitle">
            CPU / memory headroom and RF link capacity across the fleet. Panels with no collected
            metric read &ldquo;Not available&rdquo; — never a fabricated zero.
          </p>
        </div>
      </div>

      <section className="panel panel--wide">
        <h2 className="panel__title">CPU / memory utilisation</h2>
        <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
          {() => <CpuMemHeatmap devices={devices} />}
        </DataState>
      </section>

      <section className="panel panel--wide">
        <h2 className="panel__title">RF link capacity (Tx / Rx)</h2>
        <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
          {() =>
            radios.length === 0 ? (
              <div className="data-state data-state--empty">
                <p>No point-to-point radios to chart capacity for.</p>
              </div>
            ) : (
              <div className="panel-grid">
                {radios.map((radio) => (
                  <section className="panel" key={radio.id}>
                    <h3 className="panel__title">{radio.displayName} · Tx capacity</h3>
                    <MetricHistoryChart deviceId={radio.id} hostname={radio.hostname} metric="af60TxCapacity" label="Tx capacity" unit="Mbps" color="#1e88e5" range={range} />
                    <h3 className="panel__title">{radio.displayName} · Rx capacity</h3>
                    <MetricHistoryChart deviceId={radio.id} hostname={radio.hostname} metric="af60RxCapacity" label="Rx capacity" unit="Mbps" color="#c0703a" range={range} />
                  </section>
                ))}
              </div>
            )
          }
        </DataState>
      </section>

      <p className="chart-note">
        Honest N/A at POC: radio <strong>memory</strong> is absent (AF60 has no SNMP storage table)
        and the <strong>ping-only host</strong> reports no CPU/memory — both render &ldquo;Not
        available&rdquo;, never 0.
      </p>
    </>
  );
}

export default function CapacityDashboardPage() {
  return <AuthedShell>{() => <CapacityView />}</AuthedShell>;
}
