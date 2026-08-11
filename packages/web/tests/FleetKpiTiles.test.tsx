import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FleetKpiTiles } from '../src/components/dashboard/FleetKpiTiles';
import { available, unavailable, type Device, type Alarm } from '@nms/shared';

const devices: Device[] = [
  { id: '1', hostname: 'a', displayName: 'a', kind: 'switch', location: 'lab', reachability: 'up', uptimeSeconds: available(1) },
  { id: '2', hostname: 'b', displayName: 'b', kind: 'other', location: null, reachability: 'down', uptimeSeconds: unavailable('NO_DATA') },
  { id: '3', hostname: 'c', displayName: 'c', kind: 'p2p', location: 'roof', reachability: 'up', uptimeSeconds: available(1) }
];

const alarms: Alarm[] = [
  { id: '1', deviceId: '2', deviceHostname: 'b', deviceKind: 'other', entity: null, severity: 'critical', ruleName: 'down', firstRaisedAt: '2026-08-11T00:00:00Z', durationSeconds: 1, acknowledged: false, acknowledgedBy: null, acknowledgedAt: null }
];

describe('FleetKpiTiles', () => {
  it('derives real counts from the device + alarm sets', () => {
    render(<FleetKpiTiles devices={devices} alarms={alarms} />);
    expect(screen.getByText('Devices').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('Up').previousSibling).toHaveTextContent('2');
    expect(screen.getByText('Down').previousSibling).toHaveTextContent('1');
    // % polled OK = up/(up+down) = 2/3 = 67%
    expect(screen.getByText('Polled OK').previousSibling).toHaveTextContent('67%');
    expect(screen.getByText('Critical alarms').previousSibling).toHaveTextContent('1');
  });

  it('shows "Not available" for polled % when nothing is polled, never a fabricated 0', () => {
    const noPoll: Device[] = [
      { id: '9', hostname: 'x', displayName: 'x', kind: 'other', location: null, reachability: 'unknown', uptimeSeconds: unavailable('NO_DATA') }
    ];
    render(<FleetKpiTiles devices={noPoll} alarms={[]} />);
    expect(screen.getByText('Polled OK').previousSibling).toHaveTextContent('Not available');
  });
});
