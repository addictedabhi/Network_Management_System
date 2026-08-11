'use client';

/**
 * The expanded-row KPI panel for the enhanced device table (design A.2). Fetches per-device latest
 * metrics from the BFF and renders each via <MetricValueCell>, so a metric the device does NOT
 * report shows "Not available" — NEVER a fabricated 0 (FR-24). The KPI set is chosen per device
 * kind; a ping-only host (no SNMP) has no KPIs to show and gets an honest note instead of zeros.
 */
import type { Device, MetricValue } from '@nms/shared';
import { unavailable } from '@nms/shared';
import { MetricValueCell } from './MetricValueCell';
import { DataState } from './DataState';
import { useBffQuery } from '../hooks/useBffQuery';
import { bffClient } from '../lib/bffClient';
import { formatUptime, formatBitrate } from '../lib/format';

interface KpiSpec {
  readonly label: string;
  readonly metric: string;
  readonly unit?: string;
  readonly format?: (v: number) => string;
}

/** KPI specs per device kind. A radio shows RF; a switch/router shows CPU/mem/throughput. */
function kpisFor(kind: Device['kind']): readonly KpiSpec[] {
  if (kind === 'p2p') {
    return [
      { label: 'RSSI', metric: 'af60StaRSSI', unit: 'dBm' },
      { label: 'SNR', metric: 'af60StaSNR', unit: 'dB' },
      { label: 'Tx capacity', metric: 'af60TxCapacity', unit: 'bps', format: (v) => formatBitrate(v / 8) },
      { label: 'Rx capacity', metric: 'af60RxCapacity', unit: 'bps', format: (v) => formatBitrate(v / 8) }
    ];
  }
  return [
    { label: 'CPU', metric: 'cpuUsage', unit: '%' },
    { label: 'Memory used', metric: 'memUsedBytes', unit: 'B' },
    { label: 'In throughput', metric: 'ifInOctets_rate', format: (v) => formatBitrate(v) },
    { label: 'Out throughput', metric: 'ifOutOctets_rate', format: (v) => formatBitrate(v) }
  ];
}

function KpiRow({ deviceId, hostname, spec }: { deviceId: string; hostname: string; spec: KpiSpec }) {
  const { status, data, errorCode, reload } = useBffQuery<MetricValue<number>>(
    () => bffClient.getLatestMetric(deviceId, spec.metric, { hostname }),
    () => false,
    [deviceId, hostname, spec.metric]
  );
  return (
    <div className="kpi">
      <span className="kpi__label">{spec.label}</span>
      <span className="kpi__value">
        <DataState status={status} errorCode={errorCode} onRetry={reload}>
          {() => (
            <MetricValueCell
              metric={data ?? unavailable<number>('NO_DATA')}
              unit={spec.format ? undefined : spec.unit}
              format={spec.format}
            />
          )}
        </DataState>
      </span>
    </div>
  );
}

export interface DeviceKpiPanelProps {
  readonly device: Device;
}

export function DeviceKpiPanel({ device }: DeviceKpiPanelProps) {
  // A ping-only host (down, no SNMP) has no pollable KPIs. Say so honestly — do not render zeros.
  if (device.reachability === 'down' && device.uptimeSeconds.status === 'unavailable') {
    return (
      <div className="kpi-panel" data-testid="kpi-panel">
        <p className="kpi-panel__note">
          This device is monitored by ICMP only — no SNMP metrics (CPU, memory, interfaces, RF) are
          collected.
        </p>
      </div>
    );
  }
  return (
    <div className="kpi-panel" data-testid="kpi-panel">
      <div className="kpi kpi--static">
        <span className="kpi__label">Uptime</span>
        <span className="kpi__value">
          <MetricValueCell metric={device.uptimeSeconds} format={formatUptime} />
        </span>
      </div>
      {kpisFor(device.kind).map((spec) => (
        <KpiRow key={spec.metric} deviceId={device.id} hostname={device.hostname} spec={spec} />
      ))}
    </div>
  );
}
