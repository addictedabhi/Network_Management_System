import { describe, it, expect } from 'vitest';
import { createOidStore } from '../src/agent/oidStore.js';

const RSSI = '1.3.6.1.4.1.99999.1.2.1';
const SNR = '1.3.6.1.4.1.99999.1.2.2';

describe('OidStore withholding (FR-52)', () => {
  it('returns a value normally', () => {
    const store = createOidStore({ [RSSI]: -62 });
    expect(store.get(RSSI)).toEqual({ kind: 'value', value: -62 });
  });

  it('returns noSuchObject when withheld in that mode', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'noSuchObject');
    expect(store.get(RSSI)).toEqual({ kind: 'noSuchObject' });
  });

  it('returns noSuchInstance when withheld in that mode', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'noSuchInstance');
    expect(store.get(RSSI)).toEqual({ kind: 'noSuchInstance' });
  });

  it('omits the varbind from a walk when withheld in omit mode', () => {
    const store = createOidStore({ [RSSI]: -62, [SNR]: 20 });
    store.withhold(RSSI, 'omit');
    expect(store.walk('1.3.6.1.4.1.99999.1.2').map((v) => v.oid)).not.toContain(RSSI);
    // the other OID still walks
    expect(store.walk('1.3.6.1.4.1.99999.1.2').map((v) => v.oid)).toContain(SNR);
  });

  it('reports absent (not a value, not zero) for an omitted OID on get', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'omit');
    expect(store.get(RSSI)).toEqual({ kind: 'absent' });
  });

  it('does not respond at all in timeout mode', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'timeout');
    expect(store.get(RSSI)).toEqual({ kind: 'timeout' });
  });

  it('NEVER substitutes zero for a withheld value — the FR-24 trap', () => {
    for (const mode of ['noSuchObject', 'noSuchInstance', 'omit', 'timeout'] as const) {
      const store = createOidStore({ [RSSI]: -62 });
      store.withhold(RSSI, mode);
      const result = store.get(RSSI);
      // The withheld result carries NO numeric slot at all — absence, never 0.
      expect(result).not.toHaveProperty('value');
      expect(result.kind).not.toBe('value');
    }
  });

  it('withholding one OID never affects another OID on the same device', () => {
    const store = createOidStore({ [RSSI]: -62, [SNR]: 20 });
    store.withhold(RSSI, 'noSuchObject');
    expect(store.get(SNR)).toEqual({ kind: 'value', value: 20 });
  });

  it('restores a withheld OID', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'omit');
    store.restore(RSSI);
    expect(store.get(RSSI)).toEqual({ kind: 'value', value: -62 });
  });

  it('reports absent for an OID that was never set', () => {
    const store = createOidStore({});
    expect(store.get(RSSI)).toEqual({ kind: 'absent' });
  });

  it('set overwrites a value and get reflects it', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.set(RSSI, -70);
    expect(store.get(RSSI)).toEqual({ kind: 'value', value: -70 });
  });

  it('lists withheld OIDs so the harness can report them', () => {
    const store = createOidStore({ [RSSI]: -62, [SNR]: 20 });
    store.withhold(RSSI, 'noSuchObject');
    expect(store.withheldOids()).toEqual([{ oid: RSSI, mode: 'noSuchObject' }]);
  });
});
