/**
 * Device profiles (FR-50).
 *
 * A profile is DATA, not code: an OID map describing how a simulated agent
 * answers on the wire. This is a legitimate synthetic *device profile* (the
 * wire-level behaviour LibreNMS polls), NOT a metric injected into the TSDB —
 * every metric in InfluxDB/RRD is produced solely by LibreNMS polling these
 * agents. See docs/design/demo-simulated-hosts-design.md and MEMORY.md.
 *
 * The three profiles the plan (Task 12) and FR-50 require: switch-like (many
 * interfaces), router-like, P2P-radio-like (AF60 with local + remote RF metrics
 * per ADR 0007). Vendor RF OIDs are the concrete OIDs ADR 0007 verified
 * `AirosAf60.php` consumes.
 */

import type { DeviceKind } from '@nms/shared';
import { createOidStore, type OidStore, type SnmpValue } from '../agent/oidStore.js';

// Standard MIB-II OIDs (SNMPv2-MIB / IF-MIB / IP-MIB).
const SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const SYS_OBJECT_ID = '1.3.6.1.2.1.1.2.0';
const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';
const SYS_CONTACT = '1.3.6.1.2.1.1.4.0';
const SYS_NAME = '1.3.6.1.2.1.1.5.0';
const SYS_LOCATION = '1.3.6.1.2.1.1.6.0';
const IF_NUMBER = '1.3.6.1.2.1.2.1.0';
const IF_INDEX = '1.3.6.1.2.1.2.2.1.1';
const IF_DESCR = '1.3.6.1.2.1.2.2.1.2';
const IF_TYPE = '1.3.6.1.2.1.2.2.1.3';
const IF_SPEED = '1.3.6.1.2.1.2.2.1.5';
const IF_ADMIN_STATUS = '1.3.6.1.2.1.2.2.1.7';
const IF_OPER_STATUS = '1.3.6.1.2.1.2.2.1.8';
const IF_HC_IN_OCTETS = '1.3.6.1.2.1.31.1.1.1.6';
const IF_HC_OUT_OCTETS = '1.3.6.1.2.1.31.1.1.1.10';
const IP_FORWARDING = '1.3.6.1.2.1.4.1.0';
// HOST-RESOURCES-MIB CPU + memory.
//
// CPU: hrProcessorLoad, indexed by the processor's hrDeviceIndex. LibreNMS's `linux`/hr-mib
// discovery walks this column and graphs each processor into the `processors` measurement
// (field `usage`) — verified landing live for all sim devices (2026-08-11).
const HR_PROCESSOR_LOAD = '1.3.6.1.2.1.25.3.3.1.2.196608';
// Memory via hrStorageTable. A storage row is only recorded as MEMORY when LibreNMS can
// classify it as RAM, which requires hrStorageType == hrStorageRam. A row that serves only
// Descr/Size/Used (no Type) is polled but silently NOT graphed — verified live: switch/router
// memory did not land in InfluxDB until the Type row existed. The index 1 is the RAM row.
const HR_STORAGE_INDEX = '1.3.6.1.2.1.25.2.3.1.1.1';
const HR_STORAGE_TYPE = '1.3.6.1.2.1.25.2.3.1.2.1';
const HR_STORAGE_DESCR = '1.3.6.1.2.1.25.2.3.1.3.1';
const HR_STORAGE_ALLOC_UNITS = '1.3.6.1.2.1.25.2.3.1.4.1';
const HR_STORAGE_SIZE = '1.3.6.1.2.1.25.2.3.1.5.1';
const HR_STORAGE_USED = '1.3.6.1.2.1.25.2.3.1.6.1';
// hrStorageRam OID value — the hrStorageType that marks a row as physical memory.
const HR_STORAGE_RAM = '1.3.6.1.2.1.25.2.1.2';

// Ubiquiti airFiber AF60 — enterprise OID + the RF OIDs ADR 0007 verified.
// Enterprise subtree (Ubiquiti): 1.3.6.1.4.1.41112
const AF60_SYS_OBJECT_ID = '1.3.6.1.4.1.41112.1.10';
const AF60_RSSI = '1.3.6.1.4.1.41112.1.10.1.1.1.1.0';
const AF60_SNR = '1.3.6.1.4.1.41112.1.10.1.1.1.2.0';
const AF60_REMOTE_RSSI = '1.3.6.1.4.1.41112.1.10.1.1.1.3.0';
const AF60_REMOTE_SNR = '1.3.6.1.4.1.41112.1.10.1.1.1.4.0';
const AF60_MOD_RATE = '1.3.6.1.4.1.41112.1.10.1.1.1.5.0';
const AF60_DISTANCE = '1.3.6.1.4.1.41112.1.10.1.1.1.6.0';
const AF60_REMOTE_DISTANCE = '1.3.6.1.4.1.41112.1.10.1.1.1.7.0';

export interface RfMetrics {
  readonly rssi: string;
  readonly snr: string;
  readonly remoteRssi: string;
  readonly remoteSnr: string;
  readonly modRate: string;
}

export interface DeviceProfile {
  readonly name: string;
  readonly kind: DeviceKind;
  /** Base OID map defining the agent's wire behaviour. */
  readonly oids: Readonly<Record<string, SnmpValue>>;
  /** For P2P radios: the RF metric OIDs, so tests and control can target them by role. */
  readonly rf?: RfMetrics;
}

/** Build the ifTable/ifXTable rows for `count` interfaces, all operationally up. */
function interfaceRows(count: number, speed: number): Record<string, SnmpValue> {
  const rows: Record<string, SnmpValue> = { [IF_NUMBER]: count };
  for (let i = 1; i <= count; i++) {
    rows[`${IF_INDEX}.${i}`] = i;
    rows[`${IF_DESCR}.${i}`] = `eth${i}`;
    rows[`${IF_TYPE}.${i}`] = 6; // ethernetCsmacd
    rows[`${IF_SPEED}.${i}`] = speed;
    rows[`${IF_ADMIN_STATUS}.${i}`] = 1; // up
    rows[`${IF_OPER_STATUS}.${i}`] = 1; // up
    // Non-zero-real counters so LibreNMS records live traffic on first poll.
    rows[`${IF_HC_IN_OCTETS}.${i}`] = 100_000_000 + i * 7_000_000;
    rows[`${IF_HC_OUT_OCTETS}.${i}`] = 90_000_000 + i * 6_000_000;
  }
  return rows;
}

/**
 * A single hrStorageTable RAM row (index 1) LibreNMS classifies as physical memory. Emits
 * Type=hrStorageRam, a descr, allocation units, size (in allocation units) and used. `usedPct`
 * is a plausible non-flat utilisation; sizeUnits is total RAM in allocation units.
 */
function memoryRows(sizeUnits: number, usedPct: number): Record<string, SnmpValue> {
  return {
    // hrStorageIndex is REQUIRED: LibreNMS's mempool discovery rejects an hrStorage row with
    // "missing hrStorageIndex" and never creates the sensor — verified live (2026-08-11).
    [HR_STORAGE_INDEX]: 1,
    [HR_STORAGE_TYPE]: HR_STORAGE_RAM,
    [HR_STORAGE_DESCR]: 'Physical memory',
    [HR_STORAGE_ALLOC_UNITS]: 1024,
    [HR_STORAGE_SIZE]: sizeUnits,
    [HR_STORAGE_USED]: Math.round(sizeUnits * usedPct)
  };
}

function systemOids(descr: string, objectId: string, name: string): Record<string, SnmpValue> {
  return {
    [SYS_DESCR]: descr,
    [SYS_OBJECT_ID]: objectId,
    [SYS_UPTIME]: 123_456_700,
    [SYS_CONTACT]: 'noc@example.test',
    [SYS_NAME]: name,
    [SYS_LOCATION]: 'sim-lab'
  };
}

const switchProfile: DeviceProfile = {
  name: 'switch',
  kind: 'switch',
  oids: {
    ...systemOids(
      'Simulated managed switch (IF-MIB, 48 ports)',
      '1.3.6.1.4.1.9.1.516', // generic Cisco-ish sysObjectID for classification
      'sim-switch-01'
    ),
    ...interfaceRows(48, 1_000_000_000),
    [HR_PROCESSOR_LOAD]: 17,
    ...memoryRows(2_048_000, 0.35) // ~35% of 2 GB RAM in use
  }
};

const routerProfile: DeviceProfile = {
  name: 'router',
  kind: 'router',
  oids: {
    ...systemOids(
      'Simulated router (IF-MIB, IP forwarding)',
      '1.3.6.1.4.1.9.1.222',
      'sim-router-01'
    ),
    ...interfaceRows(8, 10_000_000_000),
    [IP_FORWARDING]: 1, // this is a router
    [HR_PROCESSOR_LOAD]: 34,
    ...memoryRows(4_096_000, 0.4) // ~40% of 4 GB RAM in use
  }
};

const p2pRadioProfile: DeviceProfile = {
  name: 'p2pRadio',
  kind: 'p2p',
  oids: {
    ...systemOids(
      'Ubiquiti airFiber AF60 (simulated P2P radio)',
      AF60_SYS_OBJECT_ID,
      'sim-radio-01'
    ),
    ...interfaceRows(2, 1_000_000_000),
    // Non-zero-real RF values so the P2P dashboard shows a live link.
    [AF60_RSSI]: -58,
    [AF60_SNR]: 34,
    [AF60_REMOTE_RSSI]: -61,
    [AF60_REMOTE_SNR]: 31,
    [AF60_MOD_RATE]: 2100,
    [AF60_DISTANCE]: 1200,
    [AF60_REMOTE_DISTANCE]: 1200,
    [HR_PROCESSOR_LOAD]: 23,
    ...memoryRows(512_000, 0.5) // ~50% of 512 MB RAM in use
  },
  rf: {
    rssi: AF60_RSSI,
    snr: AF60_SNR,
    remoteRssi: AF60_REMOTE_RSSI,
    remoteSnr: AF60_REMOTE_SNR,
    modRate: AF60_MOD_RATE
  }
};

export const profiles = {
  router: routerProfile,
  switch: switchProfile,
  p2pRadio: p2pRadioProfile
} as const satisfies Record<string, DeviceProfile>;

export type ProfileName = keyof typeof profiles;

export function isProfileName(name: string): name is ProfileName {
  return Object.prototype.hasOwnProperty.call(profiles, name);
}

/** Materialise a profile into a fresh, independently-mutable OidStore. */
export function buildOidStore(profile: DeviceProfile): OidStore {
  return createOidStore({ ...profile.oids });
}

export {
  IF_OPER_STATUS,
  IF_ADMIN_STATUS,
  SYS_OBJECT_ID,
  SYS_DESCR
};
