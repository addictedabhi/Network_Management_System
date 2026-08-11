/**
 * Control plane (FR-51 / FR-52) — the test-only surface that induces state on the
 * simulated devices: create devices, change OID values, flap interfaces, withhold
 * OIDs, and toggle reachability / TR-069 tolerance.
 *
 * SECURITY: this is a TEST-ONLY control surface. When exposed over HTTP it MUST bind
 * to localhost only and must never run in production (see createControlServer).
 *
 * TR-069 (ADR 0004, option a — tolerance only): a device can be marked SNMP-silent
 * to present as a TR-069-speaking device that LibreNMS cannot poll. NO ACS and NO
 * CWMP data path is built here; `snmpSilent` simply makes the SNMP agent not answer.
 */

import { type OidStore } from '../agent/oidStore.js';
import type { WithholdMode } from '../agent/oidStore.js';
import {
  buildOidStore,
  isProfileName,
  profiles,
  type ProfileName,
  IF_OPER_STATUS,
  IF_ADMIN_STATUS
} from '../profiles/index.js';

export interface SimulatedDevice {
  readonly id: string;
  readonly profile: ProfileName;
  readonly store: OidStore;
  /** false → the agent stops answering entirely (NFR-22 unreachable path). */
  reachable: boolean;
  /** true → SNMP-silent TR-069-tolerant device (ADR 0004). */
  snmpSilent: boolean;
}

export interface InterfaceTransition {
  readonly ifIndex: number;
  readonly operStatus: 1 | 2; // 1 = up, 2 = down
  readonly at: number;
}

export interface ControlPlane {
  createDevices(profile: ProfileName, count: number): SimulatedDevice[];
  listDevices(): SimulatedDevice[];
  getDevice(id: string): SimulatedDevice | undefined;
  setOid(id: string, oid: string, value: number | string): void;
  flapInterface(id: string, ifIndex: number, transitions: number): InterfaceTransition[];
  withholdOid(id: string, oid: string, mode: WithholdMode): void;
  restoreOid(id: string, oid: string): void;
  setReachability(id: string, reachable: boolean): void;
  setTr069Tolerant(id: string, tolerant: boolean): void;
}

export function createControlPlane(): ControlPlane {
  const devices = new Map<string, SimulatedDevice>();
  let seq = 0;

  function require(id: string): SimulatedDevice {
    const dev = devices.get(id);
    if (!dev) throw new Error(`unknown device: ${id}`);
    return dev;
  }

  return {
    createDevices(profile, count) {
      if (!isProfileName(profile)) throw new Error(`unknown profile: ${String(profile)}`);
      if (!Number.isInteger(count) || count < 1 || count > 1000) {
        throw new Error(`count must be an integer between 1 and 1000, got ${count}`);
      }
      const created: SimulatedDevice[] = [];
      for (let i = 0; i < count; i++) {
        const id = `${profile}-${++seq}`;
        const dev: SimulatedDevice = {
          id,
          profile,
          store: buildOidStore(profiles[profile]),
          reachable: true,
          snmpSilent: false
        };
        devices.set(id, dev);
        created.push(dev);
      }
      return created;
    },
    listDevices() {
      return [...devices.values()];
    },
    getDevice(id) {
      return devices.get(id);
    },
    setOid(id, oid, value) {
      require(id).store.set(oid, value);
    },
    flapInterface(id, ifIndex, transitions) {
      if (!Number.isInteger(transitions) || transitions < 1) {
        throw new Error(`transitions must be a positive integer, got ${transitions}`);
      }
      const dev = require(id);
      const results: InterfaceTransition[] = [];
      const operOid = `${IF_OPER_STATUS}.${ifIndex}`;
      const adminOid = `${IF_ADMIN_STATUS}.${ifIndex}`;
      dev.store.set(adminOid, 1); // admin stays up; oper flaps
      for (let i = 0; i < transitions; i++) {
        // Alternate down/up starting with down; an odd count ends 'down'.
        const operStatus: 1 | 2 = i % 2 === 0 ? 2 : 1;
        dev.store.set(operOid, operStatus);
        results.push({ ifIndex, operStatus, at: Date.now() });
      }
      return results;
    },
    withholdOid(id, oid, mode) {
      require(id).store.withhold(oid, mode);
    },
    restoreOid(id, oid) {
      require(id).store.restore(oid);
    },
    setReachability(id, reachable) {
      require(id).reachable = reachable;
    },
    setTr069Tolerant(id, tolerant) {
      const dev = require(id);
      dev.snmpSilent = tolerant;
    }
  };
}
