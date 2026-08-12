'use client';

/**
 * Top-talkers dashboard (Phase 3 d.2) — fixed dashboard. Top-N interfaces by 95th-percentile
 * throughput (reuses <TopInterfaces>) plus a throughput time-series for the busiest interface-bearing
 * device (<ThroughputChart>). Grounded in real `ports` derivatives on switch+router only.
 *
 * Honest N/A: devices without a `ports` series (radios, ping host) simply do not appear — that is
 * correct, not empty. Rates are tiny at POC and shown honestly, never inflated.
 */
import { useMemo } from 'react';
import type { Device } from '@nms/shared';
import { AuthedShell } from '../../../components/AuthedShell';
import { DataState } from '../../../components/DataState';
import { TopInterfaces } from '../../../components/dashboard/TopInterfaces';
import { ThroughputChart } from '../../../components/dashboard/ThroughputChart';
import { useBffQuery } from '../../../hooks/useBffQuery';
import { bffClient } from '../../../lib/bffClient';

const RANGE_MS = 86_400_000;

function TopTalkersView() {
  const range = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - RANGE_MS).toISOString(), to: new Date(to).toISOString(), step: '15m' };
  }, []);

  const devicesQ = useBffQuery<{ data: readonly Device[] }>(
    () => bffClient.listDevices('perPage=200'),
    (r) => r.data.length === 0
  );
  const devices = devicesQ.data?.data ?? [];
  const throughputDevice = devices.find((d) => d.kind === 'switch' || d.kind === 'router');

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>Top talkers</h1>
          <p className="subtitle">
            Busiest interfaces by 95th-percentile throughput. Only interface-bearing devices
            (switch / router) appear — radios and the ping host have no ports and are correctly
            absent, not shown as empty.
          </p>
        </div>
      </div>

      <section className="panel panel--wide">
        <h2 className="panel__title">Top interfaces (95th percentile)</h2>
        <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyLabel="devices">
          {() => <TopInterfaces devices={devices} range={range} />}
        </DataState>
      </section>

      <section className="panel panel--wide">
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
    </>
  );
}

export default function TopTalkersDashboardPage() {
  return <AuthedShell>{() => <TopTalkersView />}</AuthedShell>;
}
