'use client';

/**
 * ★ P2P Link Performance Matrix — the dashboard centerpiece (design B.2, FR-20/21/24).
 *
 * One row per AF60 radio link. AF60 reports both ends from a single poll (ADR 0007), so the 2 sim
 * radios render directly — no pairing code. Each row shows RSSI + SNR read live from InfluxDB via
 * the BFF, plus an icon+text+colour severity indicator (never colour-only, NFR-30).
 *
 * THE FR-24 SHOWCASE: the withheld radio (sim-radio-02) has a genuinely absent Local RSSI series,
 * so its RSSI cell renders "Not available" via <MetricValueCell> — NEVER 0, never a healthy green.
 * SNR is present on both. Worst-first sort (FR-21) is by SNR (RSSI may be unavailable).
 */
import type { Device, MetricValue } from '@nms/shared';
import { unavailable } from '@nms/shared';
import { MetricValueCell } from '../MetricValueCell';
import { DataState } from '../DataState';
import { useBffQuery } from '../../hooks/useBffQuery';
import { bffClient } from '../../lib/bffClient';

/** Signal severity from SNR (dB). Icon + text + colour — the text/icon carry the meaning (NFR-30). */
function snrSeverity(snr: MetricValue<number>): { label: string; glyph: string; tone: string } {
  if (snr.status !== 'available') return { label: 'Unknown', glyph: '—', tone: 'muted' };
  if (snr.value >= 25) return { label: 'Good', glyph: '●', tone: 'ok' };
  if (snr.value >= 15) return { label: 'Degraded', glyph: '◐', tone: 'warning' };
  return { label: 'Poor', glyph: '○', tone: 'danger' };
}

function LinkRow({ device }: { device: Device }) {
  const rssiQ = useBffQuery<MetricValue<number>>(
    () => bffClient.getLatestMetric(device.id, 'af60StaRSSI', { hostname: device.hostname }),
    () => false,
    [device.id, device.hostname, 'rssi']
  );
  const snrQ = useBffQuery<MetricValue<number>>(
    () => bffClient.getLatestMetric(device.id, 'af60StaSNR', { hostname: device.hostname }),
    () => false,
    [device.id, device.hostname, 'snr']
  );

  const snr = snrQ.data ?? unavailable<number>('NO_DATA');
  const sev = snrSeverity(snr);

  return (
    <tr>
      <td className="p2p__endpoint">{device.displayName}</td>
      <td className="p2p__endpoint p2p__endpoint--remote">Remote end (via {device.hostname})</td>
      <td>
        <span className={`sev sev--${sev.tone}`} aria-label={`Link ${sev.label}`}>
          <span aria-hidden="true">{sev.glyph}</span> {sev.label}
        </span>
      </td>
      <td className="p2p__metric">
        <DataState status={snrQ.status} errorCode={snrQ.errorCode} onRetry={snrQ.reload}>
          {() => <MetricValueCell metric={snr} unit="dB" />}
        </DataState>
      </td>
      <td className="p2p__metric">
        <DataState status={rssiQ.status} errorCode={rssiQ.errorCode} onRetry={rssiQ.reload}>
          {() => <MetricValueCell metric={rssiQ.data ?? unavailable<number>('NO_DATA')} unit="dBm" />}
        </DataState>
      </td>
    </tr>
  );
}

export interface P2PLinkMatrixProps {
  readonly radios: readonly Device[];
}

export function P2PLinkMatrix({ radios }: P2PLinkMatrixProps) {
  if (radios.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>No point-to-point radio links are currently monitored.</p>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className="table table--matrix">
        <caption className="sr-only">
          Point-to-point link performance: SNR and RSSI per radio, worst signal first.
        </caption>
        <thead>
          <tr>
            <th scope="col">Endpoint A</th>
            <th scope="col">Endpoint B</th>
            <th scope="col">Link state</th>
            <th scope="col">SNR</th>
            <th scope="col">RSSI</th>
          </tr>
        </thead>
        <tbody>
          {radios.map((d) => (
            <LinkRow key={d.id} device={d} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
