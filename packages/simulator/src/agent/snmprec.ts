/**
 * snmprec exporter — renders an OidStore to snmpsim's `.snmprec` recording format
 * so a profile can be materialised as a repo-tracked, host-deployable artifact that
 * the proven snmpsim container replays (docs/design/demo-simulated-hosts-design.md).
 *
 * Format: one line per OID, `oid|type-tag|value`, sorted by OID. Type tags follow
 * snmpsim's ASN.1 numbers: 2 = INTEGER, 4 = OCTET STRING, 65 = Counter32,
 * 66 = Gauge32/Unsigned32, 67 = TimeTicks, 70 = Counter64.
 *
 * Withheld OIDs are ABSENT from the output — never emitted, never as `0` (FR-52/FR-24).
 * (A `noSuchObject` variation is expressible in snmpsim via its `error` variation module;
 * for repo artifacts we omit, which yields the same absence LibreNMS records as no value.)
 */

import type { OidStore, SnmpValue } from './oidStore.js';

const TYPE_INTEGER = '2';
const TYPE_OCTET_STRING = '4';
const TYPE_OBJECT_IDENTIFIER = '6';

// OIDs whose VALUE is itself an OBJECT IDENTIFIER on the wire. sysObjectID
// (1.3.6.1.2.1.1.2.0) is the load-bearing one: LibreNMS keys OS classification
// off it, and it MUST be tagged as an OID (type 6), not a string, or the agent
// mis-declares its identity and the device classifies as generic.
//
// hrStorageType (1.3.6.1.2.1.25.2.3.1.2.<idx>) is also OID-valued: its value is an
// hrStorageTypes OID (e.g. hrStorageRam). LibreNMS reads it to classify a storage row as
// RAM; mis-tagged as a string, the row is not recognised as memory and never graphed.
const OID_VALUED = new Set<string>(['1.3.6.1.2.1.1.2.0']);

/** hrStorageType column — any index under it carries an OID value. */
const HR_STORAGE_TYPE_COLUMN = '1.3.6.1.2.1.25.2.3.1.2.';

function typeTag(oid: string, value: SnmpValue): string {
  if (OID_VALUED.has(oid) || oid.startsWith(HR_STORAGE_TYPE_COLUMN)) {
    return TYPE_OBJECT_IDENTIFIER;
  }
  return typeof value === 'number' ? TYPE_INTEGER : TYPE_OCTET_STRING;
}

/**
 * Render every non-withheld OID in the store. We walk from the root arc so the
 * whole tree is covered; the store's walk already excludes withheld OIDs.
 */
export function toSnmprec(store: OidStore): string {
  // '1' is the top of the mgmt/enterprise arcs used by every profile here.
  const entries = store.walk('1');
  return (
    entries
      .map(({ oid, value }) => `${oid}|${typeTag(oid, value)}|${escapeValue(value)}`)
      .join('\n') + '\n'
  );
}

/** snmprec values are newline-delimited, so a value must not contain a raw newline. */
function escapeValue(value: SnmpValue): string {
  return String(value).replace(/[\r\n]+/g, ' ');
}
