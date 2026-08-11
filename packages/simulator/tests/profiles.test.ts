import { describe, it, expect } from 'vitest';
import { profiles, buildOidStore } from '../src/profiles/index.js';
import { toSnmprec } from '../src/agent/snmprec.js';

const SYS_OBJECT_ID = '1.3.6.1.2.1.1.2.0';
const SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const IF_OPER_STATUS_PREFIX = '1.3.6.1.2.1.2.2.1.8';
const IF_HC_IN_OCTETS_PREFIX = '1.3.6.1.2.1.31.1.1.1.6';

// HOST-RESOURCES-MIB CPU + storage (memory). LibreNMS's hrstorage/mempool module only
// records a storage row as memory when it can classify it as RAM, which requires
// hrStorageType (.25.2.3.1.2.x) == hrStorageRam (.1.3.6.1.2.1.25.2.1.2). A row that serves
// only Descr/Size/Used (no Type) is polled but NOT graphed — verified against the live host
// (2026-08-11): switch/router memory did not land in InfluxDB until the Type row existed.
const HR_PROCESSOR_LOAD_PREFIX = '1.3.6.1.2.1.25.3.3.1.2';
const HR_STORAGE_INDEX_PREFIX = '1.3.6.1.2.1.25.2.3.1.1';
const HR_STORAGE_TYPE_PREFIX = '1.3.6.1.2.1.25.2.3.1.2';
const HR_STORAGE_USED_PREFIX = '1.3.6.1.2.1.25.2.3.1.6';
const HR_STORAGE_RAM = '1.3.6.1.2.1.25.2.1.2';

// AF60 vendor OIDs verified in ADR 0007 (AirosAf60.php consumes these).
const AF60_ENTERPRISE = '1.3.6.1.4.1.41112';

describe('device profiles (FR-50)', () => {
  it('exposes router, switch, and p2pRadio profiles', () => {
    expect(Object.keys(profiles).sort()).toEqual(['p2pRadio', 'router', 'switch']);
  });

  it('every profile maps to a valid DeviceKind', () => {
    expect(profiles.router.kind).toBe('router');
    expect(profiles.switch.kind).toBe('switch');
    expect(profiles.p2pRadio.kind).toBe('p2p');
  });

  it('every profile sets sysObjectID and sysDescr so LibreNMS can classify it', () => {
    for (const p of Object.values(profiles)) {
      const store = buildOidStore(p);
      expect(store.get(SYS_OBJECT_ID).kind).toBe('value');
      expect(store.get(SYS_DESCR).kind).toBe('value');
    }
  });

  it('switch profile has many interfaces (>= 24 ifOperStatus rows)', () => {
    const store = buildOidStore(profiles.switch);
    const rows = store.walk(IF_OPER_STATUS_PREFIX);
    expect(rows.length).toBeGreaterThanOrEqual(24);
  });

  it('router profile advertises ipForwarding = 1', () => {
    const store = buildOidStore(profiles.router);
    expect(store.get('1.3.6.1.2.1.4.1.0')).toEqual({ kind: 'value', value: 1 });
  });

  it('all profiles carry HC interface counters (FR-25/FR-26)', () => {
    for (const p of Object.values(profiles)) {
      const store = buildOidStore(p);
      expect(store.walk(IF_HC_IN_OCTETS_PREFIX).length).toBeGreaterThan(0);
    }
  });

  it('switch and router expose a non-flat CPU load (hrProcessorLoad) LibreNMS polls', () => {
    for (const name of ['switch', 'router'] as const) {
      const store = buildOidStore(profiles[name]);
      const rows = store.walk(HR_PROCESSOR_LOAD_PREFIX);
      expect(rows.length).toBeGreaterThan(0);
      for (const { value } of rows) {
        expect(typeof value).toBe('number');
        expect(value as number).toBeGreaterThan(0);
        expect(value as number).toBeLessThanOrEqual(100);
      }
    }
  });

  it('switch and router expose a pollable hrStorage RAM row (Type=hrStorageRam + Used) so memory lands', () => {
    for (const name of ['switch', 'router'] as const) {
      const store = buildOidStore(profiles[name]);
      // At least one hrStorageType row classified as RAM — without this LibreNMS never
      // creates a mempool/storage sensor and memory silently reads "unavailable".
      const typeRows = store.walk(HR_STORAGE_TYPE_PREFIX);
      expect(typeRows.length).toBeGreaterThan(0);
      const ramRows = typeRows.filter((r) => String(r.value) === HR_STORAGE_RAM);
      expect(ramRows.length).toBeGreaterThan(0);
      // The matching RAM index must also carry a Used value (a real, non-zero utilisation).
      const ramIndex = ramRows[0]!.oid.slice(HR_STORAGE_TYPE_PREFIX.length + 1);
      const used = store.get(`${HR_STORAGE_USED_PREFIX}.${ramIndex}`);
      expect(used.kind).toBe('value');
      expect((used as { value: number }).value).toBeGreaterThan(0);
      // hrStorageIndex must be present at the same index — LibreNMS rejects the row without it.
      expect(store.get(`${HR_STORAGE_INDEX_PREFIX}.${ramIndex}`).kind).toBe('value');
    }
  });

  it('p2pRadio profile classifies as an AF60 (sysObjectID under Ubiquiti enterprise) and carries local + remote RF metrics', () => {
    const store = buildOidStore(profiles.p2pRadio);
    const sysObj = store.get(SYS_OBJECT_ID);
    expect(sysObj.kind).toBe('value');
    expect(String((sysObj as { value: string | number }).value)).toContain(AF60_ENTERPRISE);
    // local end RSSI/SNR + remote end RSSI/SNR + mod-rate must be present and NON-zero-real
    for (const oid of [
      profiles.p2pRadio.rf!.rssi,
      profiles.p2pRadio.rf!.snr,
      profiles.p2pRadio.rf!.remoteRssi,
      profiles.p2pRadio.rf!.remoteSnr,
      profiles.p2pRadio.rf!.modRate
    ]) {
      expect(store.get(oid).kind).toBe('value');
    }
  });

  it('p2pRadio RSSI is a plausible negative dBm, not zero', () => {
    const store = buildOidStore(profiles.p2pRadio);
    const rssi = store.get(profiles.p2pRadio.rf!.rssi);
    expect(rssi.kind).toBe('value');
    expect((rssi as { value: number }).value).toBeLessThan(0);
  });
});

describe('.snmprec export (repo-tracked device profile artifacts)', () => {
  it('renders a profile to snmpsim .snmprec lines (oid|type|value)', () => {
    const text = toSnmprec(buildOidStore(profiles.p2pRadio));
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // snmprec format: <oid>|<type-tag>|<value>
      expect(line).toMatch(/^\d+(\.\d+)+\|\d+(:\w+)?\|/);
    }
  });

  it('a withheld OID is ABSENT from the .snmprec (never emitted as 0)', () => {
    const store = buildOidStore(profiles.p2pRadio);
    const rssiOid = profiles.p2pRadio.rf!.rssi;
    store.withhold(rssiOid, 'omit');
    const text = toSnmprec(store);
    expect(text).not.toContain(`${rssiOid}|`);
  });
});
