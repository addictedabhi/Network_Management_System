# @nms/simulator — device simulation harness (FR-50..53)

Presents simulated routers, switches, and P2P radios to the platform **over SNMP**
so LibreNMS genuinely polls them, with **on-demand OID withholding (FR-52)** as a
first-class, tested feature. This formalizes and expands the proven `demo-simulated-hosts`
snmpsim approach (see `docs/design/demo-simulated-hosts-design.md`) into a versioned,
repo-tracked workspace.

## The one invariant that matters

**No fabricated metrics.** This harness only makes LibreNMS *poll* a simulated SNMP
agent. It never writes into InfluxDB / RRD. A withheld OID is returned as **absence**
(`noSuchObject` / `noSuchInstance` / omitted / timeout) — **never a value and never `0`**
(FR-52 / FR-24). A synthetic device *profile* is legitimate; a synthetic *metric* in
the store is not.

## Layout

| File | Purpose |
|---|---|
| `src/agent/oidStore.ts` | In-memory SNMP variable store per device. Withhold/restore. The FR-52/FR-24 core — no code path turns a withheld OID into `0`. |
| `src/agent/snmprec.ts` | Renders an `OidStore` to snmpsim `.snmprec` (`oid|type|value`). Withheld OIDs are absent from the output. `sysObjectID` is tagged as OBJECT IDENTIFIER (type 6) so LibreNMS classifies correctly. |
| `src/agent/snmpAgent.ts` | Thin UDP responder for a single in-process device (`npm run sim`); the multi-device host wire path is the snmpsim container fed by `.snmprec` exports. |
| `src/profiles/index.ts` | The device profiles (DATA): `router`, `switch` (48 ports), `p2pRadio` (Ubiquiti AF60, local + remote RSSI/SNR/mod-rate per ADR 0007). |
| `src/control/api.ts` | Control plane: create devices, set OIDs, flap interfaces (AC-C#14), withhold/restore, reachability (NFR-22), TR-069 tolerance. |
| `src/control/server.ts` | localhost-only HTTP wrapper (design doc §7.1). **Test-only — never run in production.** |
| `tests/` | `oidStore` (withholding), `profiles` + `.snmprec` export, `control` plane, `server` HTTP round-trip. |

## Usage

```bash
npm run build
npm run sim                                   # start the localhost control plane (:9001)
node packages/simulator/dist/index.js --emit-snmprec <dir>   # write one .snmprec per profile
```

## Device profiles (FR-50)

The **TypeScript profiles are the source of truth** (a generator); the committed
`.snmprec` files under `deploy/librenms-podman/snmpsim-build/data/` are their rendered,
host-deployable artifacts. Regenerate with `--emit-snmprec` after any profile change.

- **switch** — 48 interfaces, full ifTable/ifXTable, CPU/mem. Many interfaces = the "switch" visual.
- **router** — fewer high-speed interfaces, `ipForwarding = 1`, routing identity.
- **p2pRadio** — Ubiquiti airFiber **AF60**; `sysObjectID` under Ubiquiti enterprise `1.3.6.1.4.1.41112`
  so LibreNMS classifies it as `airos-af60`; local **RSSI/SNR** + **remote-end RSSI/SNR** +
  **mod-rate** (the OIDs ADR 0007 verified `AirosAf60.php` consumes). Values are plausible,
  non-zero-real (RSSI −58 dBm, SNR 34 dB) so the RF dashboard shows a live link.
- **sim-withhold** (deploy artifact) — a `p2pRadio` clone with `af60StaRSSI` **withheld**
  (omitted). Proves the FR-24 unavailable path end to end. SNR still reads, RSSI reads
  unavailable — never `0`.

## FR-52 — OID withholding (first-class, tested)

Four withhold modes on any OID, on demand, reversible:

| mode | agent behaviour | LibreNMS records |
|---|---|---|
| `noSuchObject` | returns the SNMP noSuchObject exception varbind | no value → unavailable |
| `noSuchInstance` | returns noSuchInstance | no value → unavailable |
| `omit` | OID absent from GET (`absent`) and skipped on walk | no value → unavailable |
| `timeout` | agent does not reply | no value → unavailable |

The proof is `tests/oidStore.test.ts` (`NEVER substitutes zero for a withheld value — the
FR-24 trap`): every mode's result carries no `value` property and `kind !== 'value'`. The
`.snmprec` export test asserts a withheld OID is absent from the rendered recording.

## FR-53 — scale note

The harness scales to the NFR-01/02/04 order-5,000-device target **by design, not by
standing up thousands on the shared POC host** (that would breach the co-tenancy disk /
blast-radius guardrails in team-config §8; the live POC set stays modest, ~4 devices).

How it scales:

1. **One snmpsim container serves N virtual agents**, each selected by community string
   mapped to a `.snmprec` recording. Adding a device = adding one recording + one
   `lnms device:add`; there is no per-device process.
2. **Recordings are generated, not hand-authored** — the TypeScript profiles emit
   `.snmprec` deterministically, so producing 5,000 varied recordings (varying `sysName`,
   addresses, counter seeds off a base profile) is a loop, not manual work.
3. **The bottleneck at scale is LibreNMS pollers + the TSDB, not the simulator** — the
   proven path is a dedicated host with a horizontally-scaled snmpsim tier (or several
   containers) plus additional LibreNMS dispatcher/poller workers. This is a hosting
   exercise on a dedicated box, explicitly out of scope for the shared POC host per
   team-config §8 (POC scale = tens of devices; AC-F#35 re-scoped accordingly).

## TR-069 (ADR 0004 — tolerance only)

`setTr069Tolerant(id, true)` marks a device **SNMP-silent** so it presents as a
TR-069-speaking device LibreNMS cannot poll (and therefore marks unreachable). **No ACS
and no CWMP data path is built** — that would be scope creep (ADR 0004). This is the whole
of TR-069 in this work item.
