/**
 * OidStore — the in-memory SNMP variable store for one simulated device.
 *
 * FR-52 / FR-24 core invariant: a withheld OID is returned as ABSENCE
 * (noSuchObject / noSuchInstance / omitted from the walk / timeout), NEVER as a
 * value and NEVER as `0`. There is deliberately no code path that turns a
 * withheld OID into a numeric zero — that is the exact failure FR-24 exists to
 * prevent (an absent RSSI rendered as 0 on an RF dashboard is indistinguishable
 * from a dead link).
 */

export type WithholdMode = 'noSuchObject' | 'noSuchInstance' | 'omit' | 'timeout';

export type SnmpValue = number | string;

export type OidResult =
  | { readonly kind: 'value'; readonly value: SnmpValue }
  | { readonly kind: 'noSuchObject' }
  | { readonly kind: 'noSuchInstance' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'absent' };

export interface WalkEntry {
  readonly oid: string;
  readonly value: SnmpValue;
}

export interface WithheldEntry {
  readonly oid: string;
  readonly mode: WithholdMode;
}

export interface OidStore {
  set(oid: string, value: SnmpValue): void;
  get(oid: string): OidResult;
  walk(prefix: string): readonly WalkEntry[];
  withhold(oid: string, mode: WithholdMode): void;
  restore(oid: string): void;
  withheldOids(): readonly WithheldEntry[];
}

export function createOidStore(initial: Record<string, SnmpValue> = {}): OidStore {
  const values = new Map<string, SnmpValue>(Object.entries(initial));
  const withheld = new Map<string, WithholdMode>();

  return {
    set(oid, value) {
      values.set(oid, value);
    },
    get(oid) {
      const mode = withheld.get(oid);
      if (mode === 'noSuchObject') return { kind: 'noSuchObject' };
      if (mode === 'noSuchInstance') return { kind: 'noSuchInstance' };
      if (mode === 'timeout') return { kind: 'timeout' };
      if (mode === 'omit') return { kind: 'absent' };
      const value = values.get(oid);
      return value === undefined ? { kind: 'absent' } : { kind: 'value', value };
    },
    walk(prefix) {
      return [...values.entries()]
        .filter(([oid]) => isUnderPrefix(oid, prefix) && !withheld.has(oid))
        .sort(([a], [b]) => compareOid(a, b))
        .map(([oid, value]) => ({ oid, value }));
    },
    withhold(oid, mode) {
      withheld.set(oid, mode);
    },
    restore(oid) {
      withheld.delete(oid);
    },
    withheldOids() {
      return [...withheld.entries()]
        .sort(([a], [b]) => compareOid(a, b))
        .map(([oid, mode]) => ({ oid, mode }));
    }
  };
}

/**
 * Prefix match on dotted-OID boundaries: `1.3.6.1.2.1.2` matches `1.3.6.1.2.1.2.1`
 * but NOT `1.3.6.1.2.1.20`. A naive `startsWith` would leak sibling subtrees.
 */
function isUnderPrefix(oid: string, prefix: string): boolean {
  return oid === prefix || oid.startsWith(`${prefix}.`);
}

/** Numeric, per-arc OID comparison so `.2` sorts before `.10` (lexical would not). */
function compareOid(a: string, b: string): number {
  const as = a.split('.').map(Number);
  const bs = b.split('.').map(Number);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = as[i] ?? -1;
    const bv = bs[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}
