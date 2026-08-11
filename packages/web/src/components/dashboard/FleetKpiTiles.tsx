'use client';

/**
 * Fleet KPI tiles (design B.1): total devices, up/down/unreachable, active alarms by severity, and
 * "% polled OK". Counts are derived from the real device + alarm sets the dashboard already loaded.
 * "% polled OK" = up / (up + down). Alarm severity counts come from the real alarm feed — at POC
 * that is the 2 genuine alarms; a severity with none shows 0 honestly, never a fabricated number.
 */
import type { Device, Alarm } from '@nms/shared';

export interface FleetKpiTilesProps {
  readonly devices: readonly Device[];
  readonly alarms: readonly Alarm[];
}

function Tile({
  label,
  value,
  tone,
  subtitle
}: {
  label: string;
  value: string | number;
  tone?: 'ok' | 'danger' | 'warning' | 'muted';
  subtitle?: string;
}) {
  return (
    <div className={`fleet-tile${tone ? ` fleet-tile--${tone}` : ''}`}>
      <span className="fleet-tile__value">{value}</span>
      <span className="fleet-tile__label">{label}</span>
      {subtitle ? <span className="fleet-tile__subtitle">{subtitle}</span> : null}
    </div>
  );
}

export function FleetKpiTiles({ devices, alarms }: FleetKpiTilesProps) {
  const total = devices.length;
  const up = devices.filter((d) => d.reachability === 'up').length;
  const down = devices.filter((d) => d.reachability === 'down').length;
  const unreachable = devices.filter((d) => d.reachability === 'unknown').length;
  const polledBase = up + down;
  const polledPct = polledBase === 0 ? null : Math.round((up / polledBase) * 100);

  const critical = alarms.filter((a) => a.severity === 'critical').length;
  const warning = alarms.filter((a) => a.severity === 'warning').length;

  return (
    <div className="fleet-tiles">
      <Tile label="Devices" value={total} tone="muted" />
      <Tile label="Up" value={up} tone="ok" />
      <Tile label="Down" value={down} tone={down > 0 ? 'danger' : 'muted'} />
      <Tile label="Unreachable" value={unreachable} tone={unreachable > 0 ? 'warning' : 'muted'} />
      <Tile
        label="Polled OK"
        value={polledPct === null ? 'Not available' : `${polledPct}%`}
        tone="ok"
      />
      <Tile
        label="Critical alarms"
        value={critical}
        tone={critical > 0 ? 'danger' : 'muted'}
      />
      <Tile
        label="Warning alarms"
        value={warning}
        tone={warning > 0 ? 'warning' : 'muted'}
      />
    </div>
  );
}
