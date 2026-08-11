# Design — Demo simulated hosts + self-monitor (quick item)

- **Work item:** `demo-simulated-hosts` (quick) · **Parent:** `nms-platform-foundation`
- **Author:** Technical Architect · **Date:** 2026-08-10
- **Spec:** `docs/requirements/demo-simulated-hosts.md` (FR-D1..D5, AC-D1..D5)
- **Status:** minimal design, DOC-ONLY. Nothing here is executed. No `deploy/` manifest is edited (maker's tree, after human go-ahead at the requirement's imposed pre-execution gate). No sudo anywhere.
- **Binding context:** team-config §8 (co-tenancy guardrails, amended: `~/nms` = `/opt/airlinq/aqaillm/nms`, disk abort on `df -h /opt/airlinq` ≥80%, no prune, no disable-linger, SELinux Enforcing, self-signed TLS), MEMORY.md deployment learnings (`:z` vs `:Z`, pasta source-IP, top-level `influxdbv2.*` keys, no-sudo, never fabricate), ADR 0007 (Cambium/Ubiquiti P2P vendors), deploy-fix-evidence (live 12-container stack, InfluxDB v2 write path proven, `nms-sim-device-01` already polling).

> **Reclassification check (team-protocol §2):** this stays `quick`. It adds demo data on the already-approved, already-deployed architecture using an established container pattern (the stack already runs a `nms-sim-device-01` sim). No new ADR-level contract is altered — simulator choice is a tool selection, not a durable architectural decision; the network placement reuses ADR 0008's rootless-bridge topology and F-1's pasta split verbatim. No design/plan split, no ADR. If execution reveals a hidden dependency (e.g. snmpsim cannot express the P2P remote-metric OIDs, or the self-monitor forces a sudo path), STOP and route back to Jarvis — do not improvise it into a larger item.

---

## FR-D1 — Simulator choice + rationale

**Choice: `snmpsim` (snmpsim-command-responder) in one rootless Podman container**, driven by per-device `.snmprec` recording files.

Rationale:
- **Purpose-built for exactly this.** snmpsim replays recorded SNMP walks (`.snmprec` = `oid|type|value` lines) as independent virtual agents, each selected by SNMPv2c community string (or SNMPv3 context), so **one container serves all 3–5 devices** — LibreNMS sees N distinct agents, we run one process. Minimal footprint on a shared host (co-tenancy: fewer containers, one image, one teardown entry).
- **No fabrication of metrics.** snmpsim answers *SNMP queries* from recordings; the **metrics in InfluxDB are produced solely by LibreNMS polling those agents**, not injected. A `.snmprec` file is a legitimate synthetic *device profile* (the wire-level agent behaviour); it is NOT a metric written into the TSDB. This is the line the requirement and MEMORY.md draw, and this design stays on the right side of it.
- **OID-withholding is native** (FR-D2, see below) — a recording simply omits an OID or returns an error variant.
- **Rootless, unprivileged.** snmpsim binds a **high UDP port** (e.g. `1161/udp`) inside the container; no `<1024` bind, no sudo, no capability. LibreNMS polls *outbound* to it, so no privileged-port issue arises (unlike the trap/syslog *inbound* receivers).
- **Pinned image.** Per project policy, pin by digest-backed tag. Proposed: **`docker.io/tandrup/snmpsim:1.1`** (a maintained snmpsim-command-responder image) **pinned to its published tag and recorded with its resolved digest in the manifest comment** at execution time. If that image's provenance is not acceptable at execution, the fallback is a **locally-built pinned image** from `pysnmp/snmpsim` on a pinned Python base (`python:3.12-slim`), Dockerfile committed under `deploy/`. The maker records the exact resolved digest in the quadlet comment (the same discipline the stack already uses).

Alternatives considered (briefly, proportionate to a quick item):
- **Multiple real `net-snmp` `snmpd` containers** — heavier (one container per device), and `snmpd` is awkward to make expose arbitrary vendor RF OIDs without extend scripts. Rejected.
- **A bespoke scripted responder** — new team-owned code needing its own G-cycle; disproportionate for demo data. Rejected.

**Device count recommendation: 4** — switch, router, P2P-radio, and the withhold-OID device (which can be a second radio or a copy of the router). Four covers every FR-D1/FR-D2 profile requirement with one device explicitly dedicated to the FR-24 unavailable path, without over-populating a shared POC host. The human confirms 3, 4, or 5 at go-ahead; the design scales trivially (add/remove a `.snmprec` + one `lnms device:add`).

---

## FR-D1 — Device profiles (4 recommended)

Each profile is one `.snmprec` file, selected by its own community string. Walk-data provenance is stated per profile. Where a real walk is not on hand, a **documented synthetic walk** built from the standard MIB structure is legitimate (it is a device profile, not injected metrics).

| # | Profile | LibreNMS OS it should classify as | Community | Walk-data source | Key OIDs it must answer |
|---|---|---|---|---|---|
| D1 | **Switch-like** (many interfaces) | generic/`ios`-like via `sysObjectID`; classification is best-effort | `sim-switch` (v2c) | Prefer a **real walk** captured from any managed switch (`snmpwalk -v2c -c public <sw> .1 > switch.snmprec`) via `snmpsim`'s `snmprec` recording format; else a documented synthetic walk. snmpsim ships sample recordings usable as a base. | `IF-MIB` full table for **24–48 ifIndex** rows (`ifDescr`, `ifType`, `ifOperStatus`, `ifHCInOctets`/`ifHCOutOctets`, `ifSpeed`), `SNMPv2-MIB` (`sysDescr`, `sysObjectID`, `sysUpTime`, `sysName`), `HOST-RESOURCES-MIB` CPU/mem if present. Many interfaces = the demo's "switch" visual. |
| D2 | **Router-like** | generic/router via `sysObjectID` | `sim-router` (v2c) | Real walk from any router, else synthetic. | `SNMPv2-MIB`, `IF-MIB` (fewer, higher-speed interfaces + a couple of sub-interfaces), `IP-MIB` (`ipForwarding=1`), `IP-FORWARD-MIB`/routing table sample, CPU/mem via `HOST-RESOURCES-MIB` or a vendor CPU OID. The `ipForwarding=1` + routing OIDs are what make LibreNMS/the demo read it as a router. |
| D3 | **P2P-radio-like** (Ubiquiti airFiber AF60) | `airos-af60` (`AirosAf60`) | `sim-radio` (v2c) | **Synthetic walk built from the in-tree `UI-AF60-MIB`** (vendored in LibreNMS, ADR 0007). Legitimate: it is a device profile. Values chosen to be plausible and *non-zero-but-real* so the RF dashboard shows live SNR/RSSI. | Set `sysObjectID` to the AF60 enterprise OID so LibreNMS classifies it as `airos-af60`, then populate the OIDs `AirosAf60`/`WirelessRssiDiscovery`+`WirelessSnrDiscovery` read: **`af60StaRSSI`, `af60StaSNR`** (local), **`af60StaRemoteRSSI`, `af60StaRemoteSNR`** (remote end), **`af60StaDistance`/`af60StaRemoteDistance`**, and the modulation/rate OID the class discovers. (These are the concrete OIDs ADR 0007 verified `AirosAf60.php` consumes.) This exercises SNR/RSSI/mod-rate for the eventual P2P matrix. |
| D4 | **Withhold-OID device** (FR-D2) | second radio (`airos-af60`) OR a router clone | `sim-withhold` (v2c) | Copy of D3's (or D2's) recording with **one chosen RF metric OID removed / returned as error**. | Same base as D3, but the **`af60StaRSSI` OID is withheld** (see FR-D2). This is the device AC-D2 asserts against. |

> **Reconciliation with ADR 0007 (Cambium + Ubiquiti):** the P2P profiles use **Ubiquiti airFiber AF60** because AF60 is the one ADR 0007 verified reports *both link ends from a single poll* (`af60StaRSSI/SNR` + `af60StaRemoteRSSI/SNR`), which makes a single simulated agent demonstrate a full P2P link's SNR/RSSI without a second paired agent. This is consistent with — not a change to — ADR 0007's Phase-2 pairing model; no pairing code is built here. A **Cambium PTP670** profile (`ptp670`, `transmitModulationRate`/`receiveModulationRate` from `CAMBIUM-PTP670-MIB`) is the natural 5th device if the human picks 5, and is noted so the demo can show both vendors.

**Classification honesty:** LibreNMS OS classification keys on `sysObjectID`/`sysDescr`. The recordings must set those to the values the target OS definition matches, or LibreNMS classifies the device as generic and the RF sensors never discover. The maker verifies actual classification after discovery (`lnms device:poll` + device page), and if a profile classifies generic, that is a finding to fix in the recording — never papered over.

---

## FR-D2 — OID-withholding mechanism

With snmpsim, withholding is a property of the **recording file**, so it is deterministic and reversible without touching LibreNMS:

- **Primary mechanism — omit + error variant.** In device **D4**'s `.snmprec`, the withheld OID line is either (a) absent entirely, or (b) replaced with snmpsim's error-returning variation module so the agent returns **`noSuchObject`/`noSuchInstance`** for that specific OID while still answering every other OID normally. snmpsim's `snmprec` format supports per-OID variation modules (e.g. an `error` tag) for exactly this. Concretely: withhold **`af60StaRSSI`** on D4 so its RSSI reads unavailable while SNR still reads.
- **"On demand"** = swap the recording file and restart only the snmpsim container (targeted; the file lives on a `:z` shared volume, see FR-D4). Two recordings can be kept side by side (`sim-withhold.snmprec` with the OID, `sim-withhold-off.snmprec` without) and the active one selected by community/filename, so the demo can toggle the unavailable state to show both.
- **Why not return `0`:** returning `0` is precisely the failure MEMORY.md and FR-52 warn against — an absent RSSI rendered as `0` is indistinguishable from a dead-but-present link. The agent must return *absence* (noSuchObject) or omit the OID, so LibreNMS records **no value**, and the platform's `unavailable` discriminated state (ADR 0005 / ADR 0007 Decision 3) fires. **The design must NOT produce a fabricated `0`.**

AC-D2 verification: after a poll of D4, the withheld metric reads **unavailable** in the LibreNMS UI/API for that sensor (no data point / null), not `0`, not a made-up value.

---

## FR-D1 — Wiring into LibreNMS

- **Network path (respects existing topology).** The snmpsim container joins the **existing `nms.network` bridge** — it is an ordinary bridge device. LibreNMS polls it **outbound** by container name (`nms-snmpsim`) resolved via aardvark-dns, exactly like any bridge peer. **It does NOT need pasta:** pasta was required only for the *inbound* trap/syslog *receivers* whose source-IP had to be preserved (F-1). Outbound polling has no source-IP-attribution problem — LibreNMS knows which device it is polling because it initiated the query to a known address. So the sim stays on the bridge, keeping name resolution simple and leaving the F-1 pasta split untouched.
  - LibreNMS is added with the device **address = `nms-snmpsim`** (bridge DNS name) or the container's stable bridge IP; each virtual device is distinguished by its **community string**, so all 4 devices share the one address but differ by community. (snmpsim maps community → recording file.)
- **Adding devices.** Use **`lnms device:add`** inside the librenms container, one per device, e.g.
  `podman exec --user librenms nms-librenms lnms device:add nms-snmpsim --v2c --community <community> --port 1161 --force` (exact flags per the installed `lnms` version; the maker confirms flag names against `lnms device:add --help` before running — do not assume). The LibreNMS REST API `POST /api/v0/devices` is the equivalent and either is acceptable.
- **SNMP credentials injected at runtime, NEVER committed or printed.** Community strings (or v3 creds) are generated on the host and stored **only** in the server-side `~/nms/.env` (recorded elsewhere as `KEY=<set:NN>` shape) and referenced by the quadlet `EnvironmentFile`. They never enter a manifest, this doc, a commit, a log, or a terminal echo. If a community leaks to a terminal, self-report + rotate (the stack has done this twice correctly — MEMORY.md). v2c is acceptable for a POC simulator tier; v3 is optional and only if the human wants it demonstrated.
- **Where metrics land.** LibreNMS polls the sim agents on its normal 5-minute cycle and writes to **both sinks** it is configured for: RRD (native-UI graphs) and **InfluxDB v2** via the proven top-level `influxdbv2.*` write path (deploy-fix-evidence F-2; 798-point bucket read confirmed). No new datastore config — the demo devices ride the existing, verified write path. AC-D1: query `from(bucket:"librenms") |> range(start:-<poll window>) |> count()` for one new device returns `>0`.

---

## FR-D3 — Self-monitor `10.121.77.206`, no sudo

The system `snmpd` on the host binds `161/udp` and its config/service require sudo → **OFF-LIMITS**. Options in the requirement's preference order:

- **(a) Preferred — a user-space SNMP agent on an unprivileged port.** Stand up a **second snmpsim (or net-snmp) agent representing the host**, bound to a **high UDP port** (e.g. `1161/udp` on the sim container, a distinct community `sim-host`), whose recording reflects the host's actual identity (hostname, a HOST-RESOURCES-style profile). LibreNMS polls it like any other sim device.
  - **Honesty caveat (load-bearing):** a static/user-space agent that does **not** read live host counters reports a *representation* of the host, not its live CPU/mem/disk. That is a **host-representing profile (option b)**, not true self-telemetry — and this design will NOT present a synthetic host profile as if it were live host metrics. If the human wants *live* host metrics without sudo, the only honest path is a user-space agent that actually samples the host (e.g. a net-snmp agent a user can run reading `/proc`), which is more moving parts; the maker attempts it best-effort and reports exactly what it does and does not read live.
- **(b) Host-representing snmpsim profile** — as above but explicitly labelled a profile, useful for a demo device entry with correct identity but not live resource telemetry.
- **(c) Honest fallback — reduced device (ICMP/ping only).** If neither a live nor a representing user-space agent is acceptable/working without sudo, add `10.121.77.206` (or its loopback/host-reachable address from the LibreNMS container's perspective) as a **ping-only device** (LibreNMS `snmp disable` / add with `--ping-only`). This is exactly what device 2 already is in the live stack (`172.16.10.22`, ping-only) — a proven pattern.

**Best-effort path chosen for the plan:** attempt (a)/(b) — a user-space host-representing agent — and **fall back to (c) ping-only** if it cannot honestly report live metrics without sudo.

**What is uncollectable in the worst case (c only), stated honestly for AC-D3:** with ping-only, LibreNMS collects **reachability and ICMP latency only**. Uncollectable without the host's real `snmpd` (which needs sudo): **CPU load, memory/swap usage, disk/filesystem usage, per-interface traffic counters, process/service state, and system uptime from the host itself.** The recorded statement must say this plainly rather than let a ping-only device imply full monitoring. **No sudo is attempted under any branch.**

---

## FR-D4 / FR-D5 — Storage, units, SELinux, persistence, rollback

- **Storage under `~/nms` (= `/opt/airlinq/aqaillm/nms`).** Recordings live in a host directory, e.g. `~/nms/snmpsim/data/*.snmprec`, mounted into the container **read-only** where possible.
  - **SELinux label: `:z` (shared), NOT `:Z`.** Rationale per the standing MEMORY.md checklist item (this is the 4th time the distinction matters): if the recording directory is only ever consumed by the single snmpsim container, `:Z` (private) would be technically correct — but to avoid the repeated `:Z` foot-gun and keep it readable if a second consumer (a host-representing agent) is added, and because the directory is host-authored then container-read (cross-context), **use `:z`**. The maker confirms the consumer count at execution; single-consumer-only may use `:Z`, multi-consumer MUST use `:z`. Flag either choice explicitly in the manifest comment.
- **Units (FR-D5 persistence).** One **quadlet unit** `deploy/librenms-podman/nms-snmpsim.container`, `WantedBy=default.target`, `Restart=on-failure`, `LogDriver=k8s-file` + `--log-opt max-size=10m` (container-log cap is a co-tenancy precondition — same as every existing unit). Enabling it the same way as the stack means the sim agents survive a restart of the simulator tier, so the demo devices persist without manual re-add. The **LibreNMS device entries themselves persist in MariaDB** (added once via `lnms device:add`), independent of the sim container lifecycle — a sim restart just makes them reachable again.
- **Image pinning.** `Image=` pinned per FR-D1; resolved digest recorded in the unit comment.
- **Disk / co-tenancy (AC-D4).** Before and after: `df -h /opt/airlinq` must stay `<80%` (baseline ~39%; a few recordings + one small container are megabytes). Off-limits listeners (9092/2181/8077/5000) unchanged. No third-party container/image/service touched. Nothing written outside `$HOME`.
- **Rollback (targeted only, never prune).** Reverse in order:
  1. `podman exec --user librenms nms-librenms lnms device:delete <each sim device>` (removes the 4 demo devices + the self-monitor entry from MariaDB).
  2. `systemctl --user disable --now nms-snmpsim.service` (or `podman rm -f nms-snmpsim`).
  3. `podman volume rm` only if a named volume was created; remove `~/nms/snmpsim/` recording dir.
  4. `podman rmi <pinned snmpsim image>` **by explicit name/digest only**.
  - **NEVER `podman system prune`, NEVER `loginctl disable-linger`.** The pre-existing `amx-mcp-server` image and the account's `:8077`/`:5000` services must be untouched (MEMORY.md — shared-UID blast radius).

---

## Security notes (flagged explicitly)

- **SNMP credentials** (community strings / v3 creds) are the only secrets introduced. Runtime-injected via `~/nms/.env`, never committed/printed; leak → self-report + rotate. v2c community strings are low-sensitivity for a simulator tier but still treated as secrets.
- **No new external listener.** snmpsim's `1161/udp` is **not published to the host** — it is reachable only on the `nms` bridge by LibreNMS. This preserves the datastore-not-published / minimal-surface invariant (deploy-fix-evidence isolation check 9a). Confirm it does not appear in host `ss`.
- **No LibreNMS core change** (FR-07) — devices are added via the supported `lnms`/API surface only.
- **No fabricated data** — reaffirmed: recordings are device profiles; all TSDB metrics come from real LibreNMS polls of the agents.

---

## Mini-plan (ordered; human runs go-ahead, then the maker executes) — maps to AC-D1..D4

Every step records expected-vs-actual under `.claude/team/artifacts/demo-simulated-hosts/`, secrets redacted. **Pre-step 0:** confirm human go-ahead (requirement's imposed pre-execution gate) and device count (3/4/5).

| # | Step | Verification | AC |
|---|---|---|---|
| 1 | Pre-flight ledger: `df -h /opt/airlinq`, off-limits listener count, `podman ps` baseline. | disk `<80%`; listeners = 4; baseline recorded. | AC-D4 |
| 2 | Author recordings `~/nms/snmpsim/data/{sim-switch,sim-router,sim-radio,sim-withhold}.snmprec` (+ `sim-host` if self-monitor uses an agent). Set correct `sysObjectID`/`sysDescr` per profile; radio uses `UI-AF60-MIB` OIDs; D4 = radio recording with `af60StaRSSI` withheld (omit / `noSuchObject`). | files present; `sysObjectID` values match target OS defs; D4 diff shows exactly one OID withheld; no secrets in files. | AC-D1, AC-D2 |
| 3 | Author + enable quadlet `nms-snmpsim.container` (pinned image + digest, `Network=nms.network`, `1161/udp` NOT published, recordings mounted `:z`, log cap 10m). Generate communities into `~/nms/.env` only. Start via `systemctl --user`. | container Up; `1161/udp` NOT in host `ss`; communities only in `.env` (`<set:NN>` shape), not in manifest/terminal. | AC-D1, AC-D4 |
| 4 | Prove agents answer on the bridge: from the librenms container, `snmpget`/`snmpwalk` each community against `nms-snmpsim:1161` for a known OID (and confirm D4 returns `noSuchObject` for the withheld OID). | each device answers; D4 returns absence (not `0`) for `af60StaRSSI`. | AC-D2 |
| 5 | Add the 4 devices to LibreNMS (`lnms device:add ... --community <c> --port 1161`, one per community; flags confirmed against `--help`). | 4 devices created in LibreNMS; each classified as intended OS (switch/router/`airos-af60`) — generic classification is a fix-the-recording finding. | AC-D1 |
| 6 | Discover + poll (`lnms device:poll <id>` or wait one cycle). | devices show up/polled; radio shows SNR/RSSI sensors; D4's withheld sensor shows **unavailable/null**, not `0`. | AC-D1, AC-D2 |
| 7 | Confirm metrics in InfluxDB: `from(bucket:"librenms") \|> range(start:-<window>) \|> count()` for one sim device. | `>0` points for a new device. | AC-D1 |
| 8 | Self-monitor `10.121.77.206`: attempt user-space host agent (a/b); if not honestly live without sudo, add as ping-only (c). Record exactly what is/ isn't collected. No sudo attempted. | host appears as a device; either SNMP metrics OR ping-only with an explicit recorded list of what is uncollectable and why. | AC-D3 |
| 9 | Persistence check (FR-D5): restart the sim tier (`systemctl --user restart nms-snmpsim`); confirm devices still poll without re-add. | devices poll after restart; entries persist in MariaDB. | AC-D1 |
| 10 | Post-flight ledger: `df -h /opt/airlinq` `<80%`; listeners = 4; no third-party container/image/service touched; nothing outside `$HOME`. | all invariants hold vs step 1. | AC-D4 |
| — | Rollback (if aborting): device:delete → disable/rm unit → rm recordings/volume → rmi by name. Never prune, never disable-linger. | targeted removal only; `amx-mcp-server`/`:8077`/`:5000` untouched. | AC-D4 |

AC-D5 (dashboards look demo-ready) is human-judged after step 9.

---

## Confirmation statements

- **Fabricates nothing:** all InfluxDB metrics are produced by LibreNMS polling real (simulated) SNMP agents. `.snmprec` files are device profiles (wire-level agent behaviour), never metrics injected into the TSDB. No step writes to InfluxDB/RRD directly; if one appeared it would be a defect and removed.
- **Needs no sudo:** rootless container, unprivileged UDP `1161`, outbound polling, no privileged bind, no host `snmpd`, no sysctl. Self-monitor's worst case (ping-only) is fully non-privileged.
- **Co-tenancy honoured:** `~/nms` only, `df -h /opt/airlinq` abort at 80%, targeted removes only (no prune), no disable-linger, `:z` for shared volume, off-limits listeners untouched, third-party workloads untouched.
