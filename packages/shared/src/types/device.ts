import type { DeviceKind } from './alarm.js';
import type { MetricValue } from './metric.js';

export type Reachability = 'up' | 'down' | 'unknown';

export interface Device {
  readonly id: string;
  readonly hostname: string;
  readonly displayName: string;
  readonly kind: DeviceKind;
  readonly location: string | null;
  readonly reachability: Reachability;
  readonly uptimeSeconds: MetricValue<number>;
}

export interface DeviceInterface {
  readonly id: string;
  readonly deviceId: string;
  readonly name: string;
  readonly adminState: 'up' | 'down';
  readonly operState: 'up' | 'down' | 'unknown';
  readonly inOctetsRate: MetricValue<number>;
  readonly outOctetsRate: MetricValue<number>;
}
