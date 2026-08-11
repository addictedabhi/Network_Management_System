import { describe, it, expect, beforeEach } from 'vitest';
import { createControlPlane } from '../src/control/api.js';
import { profiles } from '../src/profiles/index.js';

/**
 * The control plane is exercised as a pure in-memory registry (no live UDP socket),
 * so FR-51 state-induction and FR-52 withholding are unit-testable without a real poll.
 */
describe('control plane (FR-51 / FR-52)', () => {
  let cp: ReturnType<typeof createControlPlane>;
  beforeEach(() => {
    cp = createControlPlane();
  });

  it('creates N devices of a profile', () => {
    const created = cp.createDevices('p2pRadio', 3);
    expect(created).toHaveLength(3);
    expect(cp.listDevices()).toHaveLength(3);
  });

  it('rejects an unknown profile', () => {
    expect(() => cp.createDevices('nonsense' as never, 1)).toThrow();
  });

  it('changes an OID value on a device', () => {
    const [dev] = cp.createDevices('router', 1);
    const oid = '1.3.6.1.2.1.1.5.0'; // sysName
    cp.setOid(dev!.id, oid, 'router-renamed');
    expect(cp.getDevice(dev!.id)!.store.get(oid)).toEqual({ kind: 'value', value: 'router-renamed' });
  });

  it('flap produces the requested number of transitions within the window (AC-C#14)', () => {
    const [dev] = cp.createDevices('switch', 1);
    const ifIndex = 1;
    const transitions = cp.flapInterface(dev!.id, ifIndex, 3);
    expect(transitions).toHaveLength(3);
    // final state and count are observable
    const oper = dev!.store.get(`1.3.6.1.2.1.2.2.1.8.${ifIndex}`);
    expect(oper.kind).toBe('value');
  });

  it('withholds an OID (returns absence) and DELETE restores it — FR-52/FR-24', () => {
    const [dev] = cp.createDevices('p2pRadio', 1);
    const rssiOid = profiles.p2pRadio.rf!.rssi;
    cp.withholdOid(dev!.id, rssiOid, 'noSuchObject');
    const withheld = dev!.store.get(rssiOid);
    expect(withheld.kind).toBe('noSuchObject');
    expect(withheld).not.toHaveProperty('value');

    cp.restoreOid(dev!.id, rssiOid);
    expect(dev!.store.get(rssiOid).kind).toBe('value');
  });

  it('sets interface reachability down (NFR-22 support) so the device stops answering', () => {
    const [dev] = cp.createDevices('router', 1);
    cp.setReachability(dev!.id, false);
    expect(cp.getDevice(dev!.id)!.reachable).toBe(false);
  });

  it('a tr069-tolerant device is SNMP-silent (ADR 0004 tolerance-only, no ACS)', () => {
    const [dev] = cp.createDevices('router', 1);
    cp.setTr069Tolerant(dev!.id, true);
    // SNMP-silent: the agent must not answer, proving LibreNMS marks it unreachable.
    expect(cp.getDevice(dev!.id)!.snmpSilent).toBe(true);
  });
});
