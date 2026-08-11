'use client';

/**
 * One dashboard card per device, showing a few LIVE latest metrics fetched from the BFF (which
 * reads InfluxDB v2 server-side). For P2P radios (AF60) it shows RSSI + SNR; every metric renders
 * via <MetricValueCell>, so the withheld-RSSI device shows "Not available" for RSSI while still
 * showing SNR — the honest FR-24 signal, never a fabricated 0.
 */
import type { Device, MetricValue } from '@nms/shared';
import { unavailable } from '@nms/shared';
import { MetricValueCell } from './MetricValueCell';
import { DataState } from './DataState';
import { useBffQuery } from '../hooks/useBffQuery';
import { bffClient } from '../lib/bffClient';

export interface MetricSpec {
  readonly label: string;
  readonly metric: string;
  readonly unit?: string;
}

/** Metric specs per device kind. AF60 (p2p) radios expose RSSI + SNR (FR-D1/D2). */
function specsFor(kind: Device['kind']): readonly MetricSpec[] {
  if (kind === 'p2p') {
    return [
      { label: 'RSSI', metric: 'af60StaRSSI', unit: 'dBm' },
      { label: 'SNR', metric: 'af60StaSNR', unit: 'dB' }
    ];
  }
  // Switches/routers: interface throughput (device-level aggregate for the demo).
  return [
    { label: 'In octets rate', metric: 'ifInOctets_rate', unit: 'Bps' },
    { label: 'Out octets rate', metric: 'ifOutOctets_rate', unit: 'Bps' }
  ];
}

function MetricRow({
  deviceId,
  hostname,
  spec
}: {
  deviceId: string;
  hostname: string;
  spec: MetricSpec;
}) {
  const { status, data, errorCode, reload } = useBffQuery<MetricValue<number>>(
    () => bffClient.getLatestMetric(deviceId, spec.metric, { hostname }),
    () => false,
    [deviceId, hostname, spec.metric]
  );

  return (
    <div className="metric-card__row">
      <span className="metric-card__label">{spec.label}</span>
      <span>
        <DataState status={status} errorCode={errorCode} onRetry={reload}>
          {() => <MetricValueCell metric={data ?? unavailable<number>('NO_DATA')} unit={spec.unit} />}
        </DataState>
      </span>
    </div>
  );
}

export function DeviceMetricCard({ device }: { device: Device }) {
  const specs = specsFor(device.kind);
  return (
    <div className="metric-card">
      <div className="metric-card__device">
        {device.displayName} <span className="role-chip">{device.kind}</span>
      </div>
      {specs.map((spec) => (
        <MetricRow key={spec.metric} deviceId={device.id} hostname={device.hostname} spec={spec} />
      ))}
    </div>
  );
}
