'use client';

/**
 * P2P link matrix — the full-page signature feature (Phase 3 b, FR-20/21/24). The dashboard
 * P2PLinkMatrix widget is the summary; this is the DEPTH: per-link RSSI / SNR / mod-rate (Tx/Rx
 * Capacity) / frequency TRENDS over a selectable window, plus link-health context.
 *
 * AF60 reports both ends from a single poll (ADR 0007) — each radio is one matrix row, no pairing.
 * FR-24 showcase: the withheld radio (sim-radio-02) has a genuinely absent RSSI series, so its RSSI
 * trend renders the honest EMPTY state ("No RSSI data points…") — NEVER a fabricated 0 line. All
 * other series (SNR, Tx/Rx capacity, frequency) are present and confirmed live. Only 2 links exist
 * at POC, so the matrix is honestly short by design, not empty.
 */
import { useMemo, useState } from 'react';
import type { Device } from '@nms/shared';
import { AuthedShell } from '../../components/AuthedShell';
import { DataState } from '../../components/DataState';
import { P2PLinkMatrix } from '../../components/dashboard/P2PLinkMatrix';
import { MetricHistoryChart } from '../../components/device/MetricHistoryChart';
import { useBffQuery } from '../../hooks/useBffQuery';
import { bffClient } from '../../lib/bffClient';

const WINDOWS = [
  { key: '1h', label: 'Last 1h', ms: 3600_000, step: '1m' },
  { key: '24h', label: 'Last 24h', ms: 86_400_000, step: '15m' },
  { key: '7d', label: 'Last 7d', ms: 604_800_000, step: '1h' }
] as const;

const RF_METRICS = [
  { metric: 'af60StaSNR', label: 'SNR', unit: 'dB', color: '#2e9e6b' },
  { metric: 'af60StaRSSI', label: 'RSSI', unit: 'dBm', color: '#8e44ad' },
  { metric: 'af60TxCapacity', label: 'Tx capacity', unit: 'Mbps', color: '#1e88e5' },
  { metric: 'af60RxCapacity', label: 'Rx capacity', unit: 'Mbps', color: '#c0703a' },
  { metric: 'af60Frequency', label: 'Frequency', unit: 'MHz', color: '#c9a227' }
] as const;

function LinkTrends({ radio, range }: { radio: Device; range: { from: string; to: string; step: string } }) {
  return (
    <section className="panel panel--wide">
      <h2 className="panel__title">
        {radio.displayName} <span className="subtitle">({radio.hostname})</span>
      </h2>
      <div className="panel-grid">
        {RF_METRICS.map((m) => (
          <section className="panel" key={m.metric}>
            <h3 className="panel__title">{m.label}</h3>
            <MetricHistoryChart
              deviceId={radio.id}
              hostname={radio.hostname}
              metric={m.metric}
              label={m.label}
              unit={m.unit}
              color={m.color}
              range={range}
            />
          </section>
        ))}
      </div>
    </section>
  );
}

function LinksView() {
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]['key']>('24h');
  const win = WINDOWS.find((w) => w.key === windowKey)!;
  const range = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - win.ms).toISOString(), to: new Date(to).toISOString(), step: win.step };
  }, [win.ms, win.step, windowKey]);

  const devicesQ = useBffQuery<{ data: readonly Device[] }>(
    () => bffClient.listDevices('perPage=200'),
    (r) => r.data.filter((d) => d.kind === 'p2p').length === 0
  );
  const radios = (devicesQ.data?.data ?? []).filter((d) => d.kind === 'p2p');

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>P2P Link Matrix</h1>
          <p className="subtitle">
            Point-to-point radio link performance and trends. The withheld radio&rsquo;s RSSI reads
            &ldquo;Not available&rdquo; — never a fabricated zero (FR-24). Only genuinely-monitored
            links appear, so the matrix is honestly short.
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
        </div>
      </div>

      <section className="panel panel--wide">
        <h2 className="panel__title">Link overview</h2>
        <DataState status={devicesQ.status} errorCode={devicesQ.errorCode} onRetry={devicesQ.reload} emptyMessage="No point-to-point radio links are currently monitored.">
          {() => <P2PLinkMatrix radios={radios} />}
        </DataState>
      </section>

      {devicesQ.status === 'success'
        ? radios.map((radio) => <LinkTrends key={radio.id} radio={radio} range={range} />)
        : null}
    </>
  );
}

export default function LinksPage() {
  return <AuthedShell>{() => <LinksView />}</AuthedShell>;
}
