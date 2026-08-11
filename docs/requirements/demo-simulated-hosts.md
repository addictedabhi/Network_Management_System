# Requirement — Demo simulated hosts + self-monitor (quick item)

**Work item:** `demo-simulated-hosts`
**Mode:** dev · **Task-size class:** `quick` (Jarvis-proposed; human confirms at go-ahead)
**Parent:** `nms-platform-foundation` (the deployed POC on `10.121.77.206`)
**Date:** 2026-08-10
**Gate:** requirement + mini-plan written; **awaiting human go-ahead before ANY host execution** (adds running containers to a shared box).

## Why this is `quick`, not `standard`
This is demo-data population plus a monitoring-config task on the already-approved, already-deployed architecture. No new components, no new ADR-level decisions, no change to the security model. Per team-protocol §2, a quick item carries a Mini-plan here instead of separate design/plan documents. **One deviation I am imposing anyway:** a human go-ahead is required before host execution, because this creates new long-running containers on a shared host carrying a third party's production Kafka. Scope + device count deserve an explicit OK.

## Problem / goal
The POC is live but sparse. The human wants it populated with a few hosts and real data, the deployed server itself monitored, and the product presented as "AirNMS". Three sub-goals, all clarified with the human:

1. **AirNMS rebrand → custom UI only.** Recorded as **FR-44a/FR-44b** in the parent requirement doc; the native LibreNMS UI stays stock (FR-07/G-6). **Nothing to build on the host** — deferred to Task 10. Not part of this work item's execution; noted for completeness.
2. **Add a few hosts with real data — via SNMP simulators, NOT fabricated metrics.** Injecting rows into InfluxDB/RRD would violate the no-fabricated-data rule and FR-52. Instead, stand up **~3–5 simulated devices** exposing SNMP so LibreNMS genuinely discovers, polls, and stores real metrics. This is an early, lightweight slice of Task 12 (the FR-50..53 simulation harness).
3. **Self-monitor `10.121.77.206`.** Best-effort via localhost SNMP, honestly caveated (see FR-D3).

## Functional requirements (this item)

| ID | Priority | Requirement |
|---|---|---|
| FR-D1 | MUST | Stand up **3–5 simulated devices** exposing SNMP (v2c/v3), added to LibreNMS so they are discovered and polled, with real metrics landing in InfluxDB v2. Device mix: at least one **switch-like** (many interfaces), one **router-like**, and ideally one **P2P-radio-like** exposing SNR/RSSI/mod-rate OIDs for the eventual P2P matrix. |
| FR-D2 | MUST | **At least one simulated device SHALL be able to withhold a selected OID on demand**, so the "metric unavailable" path (parent FR-24 / FR-52) is exercisable with honest data. |
| FR-D3 | SHOULD | Add `10.121.77.206` itself as a monitored device **best-effort via localhost SNMP**. If a rootless/user-space SNMP agent or a host-representing simulator works **without sudo**, use it. Otherwise add the host as a **reduced device** (ICMP/ping reachability, or a user-space agent) and **report the limitation honestly**. **Never attempt sudo**; the system `snmpd` almost certainly needs it and is off-limits. |
| FR-D4 | MUST | All simulators run **rootless under `~/nms`** within the co-tenancy guardrails (team-config §8): no third-party workloads touched, disk abort on `df -h /opt/airlinq` ≥80%, targeted removes only (no `podman prune`), self-report+rotate any credential exposure, never fabricate a result. |
| FR-D5 | SHOULD | The added devices SHALL persist across a container restart of the simulator tier (units enabled the same way as the existing stack), so the demo survives without manual re-add. |

## Acceptance criteria (testable)
- **AC-D1:** After the simulators are up and a poll cycle completes, LibreNMS lists **≥3 new devices** as up/polled, and querying the InfluxDB `librenms` bucket for one of them returns **>0 points** over the last poll window.
- **AC-D2:** For the device configured to withhold an OID, the corresponding metric reads as **unavailable in LibreNMS/the API** (not `0`, not a fabricated value) — the honest FR-24/FR-52 signal.
- **AC-D3:** `10.121.77.206` appears as a monitored device; **either** full SNMP metrics **or**, if sudo was required and correctly refused, a reduced device with reachability plus an explicit, recorded statement of what could not be collected and why.
- **AC-D4:** Post-run: `df -h /opt/airlinq` < 80%; off-limits listeners (9092/2181/8077/5000) unchanged; no third-party container/image/service touched; nothing written outside `$HOME`.
- **AC-D5 [human-judged]:** the populated dashboards look demo-ready to the human.

## Mini-plan (to be filled by the Architect's minimal design, then executed after human go-ahead)
- **Simulator choice:** e.g. `snmpsim` (snmpsim-command-responder) in a rootless container, or a scripted SNMP responder — Architect picks, with rationale, respecting rootless/no-sudo/co-tenancy.
- **Device profiles:** the 3–5 profiles (switch/router/P2P-radio) and where their SNMP walk data / recordings come from.
- **OID-withholding mechanism** for FR-D2.
- **Wiring:** how LibreNMS is pointed at the simulators (add-device, SNMP community/v3 creds injected at runtime, never committed).
- **Self-monitor approach** for `10.121.77.206` and the no-sudo fallback.
- **Storage/units** under `~/nms`; retention already governed by the Influx bucket policy.
- **Rollback:** targeted `podman rm` of the simulator units/volumes.

## Out of scope
- The AirNMS UI rebrand itself (Task 10).
- Any change to LibreNMS core, the SSO cutover, or the existing stack topology.
- Fabricated/injected metrics of any kind.
- Production-scale device counts (this is a demo slice, not FR-53's 5,000-device scale test).

## Sign-off
| Gate | Status | Approver | Date |
|---|---|---|---|
| Requirement + mini-plan | **Design complete** (`docs/design/demo-simulated-hosts-design.md`), stayed `quick`. | — | 2026-08-10 |
| Pre-execution go-ahead | **GRANTED by the human 2026-08-10 ("Go ahead"), device count = 4** (D1 switch, D2 router, D3 AF60 P2P radio, D4 AF60 with `af60StaRSSI` withheld). Host execution authorized under the standing co-tenancy guardrails. | Human | 2026-08-10 |
| Verification | Pending — maker executes the 10-step mini-plan, then reports observed poll + InfluxDB point counts, the withhold-OID check, and the self-monitor result | — | — |
