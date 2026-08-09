export type AlarmSeverity = 'critical' | 'warning' | 'ok';
export type DeviceKind = 'router' | 'switch' | 'p2p' | 'other';

export interface Alarm {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceHostname: string;
  readonly deviceKind: DeviceKind;
  readonly entity: string | null;
  readonly severity: AlarmSeverity;
  readonly ruleName: string;
  readonly firstRaisedAt: string;
  readonly durationSeconds: number;
  readonly acknowledged: boolean;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: string | null;
}
