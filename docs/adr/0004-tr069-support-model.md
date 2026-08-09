# 0004. TR-069 (CWMP) support model — scope decision proposal

- **Status:** **ACCEPTED (2026-08-09) — option (a), simulator tolerance only.** The human decided OQ-21 at G2, in line with the Architect's recommendation. **No content below is changed** — the recommendation became the decision, so the reasoning stands exactly as written.
- **Scope consequence, stated so it cannot be misread:** the simulator harness (plan Task 12) makes the platform *tolerant* of a device that speaks TR-069/CWMP. It does **NOT** build an ACS, and **no TR-069 data path into LibreNMS is created**. Real TR-069 monitoring is a **future separate work item with its own G1**. Any drift toward an ACS inside this work item is scope creep: stop and escalate. TR-069 *writes* would additionally collide with OOS-2 (no configuration management).
- **Date:** 2026-08-09
- **Deciders:** **Human only** (this is a scope decision, not an implementation detail)
- **Work item:** `nms-platform-foundation`
- **Relates to:** OQ-21, requirement doc §10.1, team-config §8, DEP-9, FR-50..53, FR-01, FR-07

## Context

TR-069 entered this project through the **test-environment decision** (OQ-17, resolved 2026-08-09: verification uses simulated devices speaking SNMP *and* TR-069), not through the architecture reference and not through any functional requirement. This matters: no FR in the requirement spec asks for TR-069 *data* in the custom UI. Every data-bearing requirement (FR-20..29, FR-37..39) is expressed in terms of SNMP-derived metrics and LibreNMS inventory.

The protocols are not interchangeable in a way that lets one substitute for the other:

| | SNMP (LibreNMS-native) | TR-069 / CWMP |
|---|---|---|
| Session initiation | Manager polls the device | **Device initiates** to an ACS (`Inform` on boot/periodic/event) |
| Data model | OID tree, MIBs | Parameter paths (`InternetGatewayDevice.*` / `Device.*`), TR-098/TR-181 |
| Transport | UDP, typically 161 | SOAP/HTTP(S), device→server |
| Server role | Poller | **ACS** — must be reachable by devices, manage sessions, hold per-device state |
| LibreNMS support | Native, the core of the product | **None.** Not a LibreNMS collection protocol. |

LibreNMS has no TR-069 collection path. There is no configuration setting, no supported extension point, and no device-definition mechanism that makes LibreNMS speak CWMP. Consequently, ingesting TR-069 data means **adding a new component to the architecture** — an ACS or a CWMP-terminating adapter that normalises parameters and writes them somewhere the platform can read (the TSDB directly, or into LibreNMS via its API as a synthetic device, which LibreNMS's data model does not cleanly accommodate).

Per FR-07 and G-6, making LibreNMS itself speak TR-069 is off the table: it would be a core modification, which is defined as a design failure.

## Options

### Option (a) — Simulator tolerance only (RECOMMENDED)
TR-069 simulators exist in the test harness solely to prove the platform **tolerates and correctly ignores** non-SNMP devices. No TR-069 data enters the platform. No ACS is built.

Concretely, this means the harness can present a device that speaks CWMP and does **not** answer SNMP, and the verifiable expectation is that LibreNMS marks it unreachable/undiscovered without crashing, without corrupting the inventory, and without the custom UI rendering fabricated values for it — which is a real and valuable test, because it exercises the same "no data" path as FR-24/NFR-22 from a different direction.

- **Scope impact:** near zero beyond the harness work already required by FR-50..53.
- **Satisfies:** the letter of the OQ-17 test-environment decision (simulators speak SNMP and TR-069).
- **Delivers:** no TR-069 monitoring capability.
- **Risk:** if the human's actual intent behind OQ-17 was "we have TR-069-managed CPE in the estate that must be monitored", this option does not meet that need, and the gap surfaces later. **This is the question the human must answer.**

### Option (b) — ACS / adapter ingestion component
Add a CWMP-terminating service: an ACS endpoint (or an off-the-shelf ACS such as GenieACS, fronted by an adapter) that receives device `Inform` sessions, extracts parameters, and feeds the TSDB and/or an inventory projection the BFF can read.

- **Scope impact: material increase.** This is a new deployable service with its own security surface (device-facing HTTPS endpoint, device authentication, per-device credential management), its own data model mapping (TR-181 parameters → platform metrics), its own storage decisions, and its own scale characteristics (device-initiated traffic is bursty and not rate-controllable by the platform, unlike polling).
- **Consequences the requirement spec does not currently cover:** no FR defines *which* TR-069 parameters matter, what device classes are involved, whether config *write* (TR-069's primary purpose) is wanted — which would collide directly with OOS-2 (network configuration change is out of scope) — or how TR-069 devices appear in an inventory whose system of record is LibreNMS/MariaDB (FR-05).
- **Honest estimate:** this is not a task inside Phase 1. It is comparable in size to Phase 1 itself and needs **its own requirement cycle (a new G1)**, because at least eight new requirements and a security review are missing.
- **Would deliver:** genuine TR-069 monitoring.

### Option (c) — Defer entirely
Remove TR-069 from the current work item, including from the harness. Revisit as a separate work item if the estate genuinely requires it.

- **Scope impact:** slightly *negative* (less harness work than option (a)).
- **Con:** contradicts the already-approved OQ-17 decision text, which explicitly names TR-069 simulators. Choosing (c) means amending that decision.

## Recommendation

**Option (a) — simulator tolerance only, for Phase 0/1.**

Reasoning:

1. **No functional requirement needs TR-069 data.** Phase 1's scope is SSO, alarm console, and inventory (requirement doc §12). Not one of FR-10..19, FR-30..35, FR-37..40 involves TR-069. Building an ACS now would deliver a component with no consumer.
2. **The cheapest correct move is to preserve optionality.** Option (a) costs almost nothing and keeps the TR-069 question open; option (b) is irreversible in effort terms and pre-commits a security surface (a device-facing internet-reachable endpoint) before anyone has written a requirement for it.
3. **Option (b) is a requirements gap, not a design gap.** I cannot design it responsibly: I do not know the device classes, the parameters of interest, whether writes are wanted (they would conflict with OOS-2), or the expected device count. Designing against invented answers would be exactly the failure mode the team protocol forbids.
4. **Option (a) still yields test value** — the non-SNMP-device tolerance path described above is a real negative test.

**If the human indicates that TR-069 devices must actually be monitored,** the correct response is not to expand this design: it is to raise a **separate work item with its own G1** for TR-069 ingestion, and to keep Phase 1 on its current scope. I will note in the design doc that Phase 1's critical path is unaffected either way.

## Consequences of the recommendation

**If (a) is approved:**
- The simulation harness (FR-50..53) implements SNMP fully, plus a minimal CWMP responder sufficient to present as a TR-069-speaking, SNMP-silent device.
- No platform component consumes TR-069 data; no ACS exists; no device-facing endpoint is exposed.
- Acceptance criteria are unaffected — no AC currently depends on TR-069 data.
- A future TR-069 ingestion work item remains cleanly possible: the BFF would gain read endpoints over whatever store the adapter writes to, and ADR 0002's rule (browser reads only via the BFF) already covers it.

**If (b) is chosen:** this ADR is superseded, Phase 1 scope must be renegotiated, and a new requirement cycle precedes any design.

**If (c) is chosen:** the OQ-17 resolution text is amended to drop TR-069, and FR-50..53 lose their CWMP element.
