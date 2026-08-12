'use client';

/**
 * Maps a layout widget id to the REAL panel component (customisable dashboard, ADR 0010). The
 * catalog is exactly the shared allowlist — there is no widget here that is not a real panel backed
 * by data the BFF actually serves. Each panel keeps its own four data-states and honest
 * unavailable rendering (FR-24/FR-43); this module only routes and threads shared data in.
 */
import type { ReactNode } from 'react';
import type { Device, Alarm, SessionInfo, DashboardWidgetId } from '@nms/shared';
import { DASHBOARD_WIDGET_IDS } from '@nms/shared';
import { FleetKpiTiles } from './FleetKpiTiles';
import { P2PLinkMatrix } from './P2PLinkMatrix';
import { TopInterfaces } from './TopInterfaces';
import { ThroughputChart } from './ThroughputChart';
import { CpuMemHeatmap } from './CpuMemHeatmap';
import { AlarmFeed } from './AlarmFeed';
import { FleetCpuTrend } from './FleetCpuTrend';
import { DeviceKpiPanel } from '../DeviceKpiPanel';

export interface WidgetContext {
  readonly devices: readonly Device[];
  readonly alarms: readonly Alarm[];
  readonly range: { from: string; to: string; step: string };
  readonly session: SessionInfo;
}

/** Human-facing catalog metadata (add-widget menu). Titles double as the panel headers. */
export const WIDGET_META: Record<DashboardWidgetId, { readonly title: string; readonly blurb: string }> = {
  FleetKpiTiles: { title: 'Fleet KPIs', blurb: 'Device counts, up/down' },
  P2PLinkMatrix: { title: 'P2P Link Performance', blurb: 'Radio link RF metrics' },
  TopInterfaces: { title: 'Top Interfaces', blurb: '95th-percentile bandwidth' },
  ThroughputChart: { title: 'Throughput', blurb: 'In/out octet rates' },
  CpuMemHeatmap: { title: 'CPU / Memory', blurb: 'Utilisation heatmap' },
  AlarmFeed: { title: 'Active Alarms', blurb: 'Live alarm feed' },
  DeviceKpiPanel: { title: 'Device KPIs', blurb: 'Single-device summary' },
  FleetCpuTrend: { title: 'Fleet CPU Trend', blurb: 'Mean / max CPU over time' }
};

/** The full catalog, in a stable order, for the add-widget menu. */
export const WIDGET_CATALOG: readonly DashboardWidgetId[] = DASHBOARD_WIDGET_IDS;

export function renderWidget(
  id: DashboardWidgetId,
  ctx: WidgetContext,
  params?: { readonly deviceId?: string }
): ReactNode {
  const { devices, alarms, range, session } = ctx;
  const radios = devices.filter((d) => d.kind === 'p2p');
  const throughputDevice = devices.find((d) => d.kind === 'switch' || d.kind === 'router');

  switch (id) {
    case 'FleetKpiTiles':
      return <FleetKpiTiles devices={devices} alarms={alarms} />;
    case 'P2PLinkMatrix':
      return radios.length > 0 ? (
        <P2PLinkMatrix radios={radios} />
      ) : (
        <EmptyPanel message="No P2P radio links in the fleet." />
      );
    case 'TopInterfaces':
      return <TopInterfaces devices={devices} range={range} />;
    case 'ThroughputChart':
      return throughputDevice ? (
        <ThroughputChart device={throughputDevice} range={range} />
      ) : (
        <EmptyPanel message="No interface-bearing device to chart." />
      );
    case 'CpuMemHeatmap':
      return <CpuMemHeatmap devices={devices} />;
    case 'AlarmFeed':
      return <AlarmFeed canAcknowledge={session.canAcknowledge} />;
    case 'FleetCpuTrend':
      return <FleetCpuTrend devices={devices} range={range} />;
    case 'DeviceKpiPanel': {
      const device = params?.deviceId
        ? devices.find((d) => d.id === params.deviceId)
        : devices[0];
      return device ? (
        <DeviceKpiPanel device={device} />
      ) : (
        <EmptyPanel message="No device available for this panel." />
      );
    }
    default:
      // Exhaustive: the allowlist enum makes this unreachable, but fail honestly if it is not.
      return <EmptyPanel message="Unknown widget." />;
  }
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="data-state data-state--empty">
      <p>{message}</p>
    </div>
  );
}
