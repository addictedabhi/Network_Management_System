# 0007. P2P link pairing model — vendor scope narrowed to Cambium + Ubiquiti; MIB-inference pairing with a registry override

- **Status:** **Revision 2 — ACCEPTED (2026-08-09) for the vendor selection and pairing model. Remains Phase 2 work; not built in Phase 0/1.** Revision 1 was BLOCKED on OQ-11.
- **Date:** 2026-08-09 (revision 2)
- **Deciders:** Human (OQ-11 directive: "use top 2 vendors for now"), Technical Architect (vendor selection + pairing design)
- **Work item:** `nms-platform-foundation`
- **Relates to:** OQ-11, ASM-2, FR-20..24, AC-B#9..12, requirement doc §12 Phase 2
- **Supersedes:** revision 1 of this ADR, whose "no decision made" position is retained below as §"Revision 1 context (superseded)" because it records why the decision was deferred and what changed.

---

## Revision 2 context — what the human decided, and what they did NOT decide

The human's answer to OQ-11 was a **scope directive, not an estate inventory**: *"use top 2 vendors for now."* That is important to state precisely, because it means:

- **Decided by the human:** the vendor list is narrowed to two, and the Architect picks them.
- **NOT supplied by the human:** the actual vendor/model inventory of the real estate, whether a naming or tagging convention exists today, and whether single-ended radios exist. Those three questions from revision 1 remain unanswered.

So this revision selects vendors on **market position and verifiable LibreNMS support**, not on knowledge of the customer's estate. **If the real estate differs, this ADR is revisited** — that is a scheduled expectation, not a failure mode. Because FR-20..24 are Phase 2, there is time for the estate inventory to arrive before anything is built against this choice.

---

## Decision 1 — the two vendors: **Cambium Networks** and **Ubiquiti**

### Why these two, evidenced rather than recalled

The selection criterion I applied is not "biggest brand" — it is **which two vendors give the strongest combination of P2P backhaul market position AND existing, verifiable LibreNMS device support for the specific metrics FR-20 demands (SNR, RSSI, modulation rate)**. A vendor with market share but no LibreNMS RF support would force us to author device definitions, which is engine work adjacent to the FR-07 line we must not cross; a vendor with LibreNMS support but no presence in the estate's likely hardware is wasted effort.

I verified LibreNMS support directly against the upstream repository (`github.com/librenms/librenms`, `master`, retrieved 2026-08-09) rather than relying on recall. Evidence:

**Cambium Networks — LibreNMS OS definitions and RF sensor classes present:**
- OS discovery definitions: `resources/definitions/os_discovery/ptp250.yaml`, `ptp500.yaml`, `ptp600.yaml`, `ptp650.yaml`, `ptp670.yaml`, `ptp800.yaml`, `epmp.yaml`, `cnpilote.yaml`, `cnpilotr.yaml`.
- OS classes: `LibreNMS/OS/Ptp250.php`, `Ptp500.php`, `Ptp600.php`, `Ptp650.php`, `Ptp670.php`, `Ptp800.php`, `Epmp.php`.
- Vendor MIBs vendored in-tree: `mibs/cambium/CAMBIUM-PTP670-MIB`, `CAMBIUM-PTP650-MIB`, `CAMBIUM-PTP250-MIB`, `CAMBIUM-PMP80211-MIB`, `WHISP-*` (PMP/Canopy), `TERRAGRAPH-RADIO-MIB`.
- Metric interfaces actually implemented: `Epmp` implements `WirelessRssiDiscovery`, `WirelessSnrDiscovery`, `WirelessCapacityDiscovery`, `WirelessDistanceDiscovery`, `WirelessFrequencyDiscovery`, `WirelessQualityDiscovery`. `Ptp670` implements `WirelessPowerDiscovery` and `WirelessRateDiscovery` including **transmit and receive modulation rate** (`transmitModulationRate` / `receiveModulationRate`) plus aggregate data rate.
- **Six PTP product generations covered** — this is the broadest dedicated *point-to-point* coverage of any vendor in the LibreNMS tree, which matters because FR-20 is specifically about P2P links, not access points.

**Ubiquiti — LibreNMS OS definitions and RF sensor classes present:**
- OS discovery definitions: `airos.yaml` (airMAX), `airos-af.yaml` (airFiber), `airos-af-ltu.yaml` (airFiber LTU), `airos-af60.yaml` (airFiber 60).
- OS classes: `LibreNMS/OS/Airos.php`, `AirosAf.php`, `AirosAfLtu.php`, `AirosAf60.php`.
- Vendor MIBs in-tree: `mibs/ubnt/UBNT-AirFIBER-MIB`, `UBNT-AirMAX-MIB`, `UI-AF60-MIB`.
- Metric interfaces actually implemented: `AirosAf60` implements `WirelessRssiDiscovery` and `WirelessSnrDiscovery` and — decisively for a link matrix — discovers **both ends from one poll**: `af60StaRSSI`/`af60StaSNR` (local) *and* `af60StaRemoteRSSI`/`af60StaRemoteSNR` (remote). `AirosAf` implements `WirelessRateDiscovery` (`txCapacity`/`rxCapacity`), `WirelessPowerDiscovery` (`txPower`, `rxPower0`, `rxPower1`), `WirelessFrequencyDiscovery`, `WirelessDistanceDiscovery`, and the `curTXModRate` state sensor with the full QPSK→2048-QAM modulation ladder. `Airos` implements nine wireless interfaces including RSSI, noise floor, capacity, CCQ/quality and utilisation.

**Why the runners-up were not selected** — stated so the choice is reviewable, and so a later estate inventory can reopen it cheaply:

| Vendor | LibreNMS support found | Why not in the top 2 |
|---|---|---|
| **Mimosa** (now Airspan) | `mimosa.yaml`, `LibreNMS/OS/Mimosa.php`, `MIMOSA-NETWORKS-BFIVE-MIB`. Implements SNR, noise floor, power, rate, frequency, error ratio | Genuinely good support and a credible third choice. Excluded on **vendor-continuity risk** (Mimosa's ownership has changed) rather than on technical coverage. **This is the first vendor to add if the estate demands three.** |
| **Siklu** | `siklu.yaml`, `siklu-mhtg.yaml`, `LibreNMS/OS/Siklu.php`, `SikluMhtg.php`, `RADIO-BRIDGE-MIB` | Definitions exist but the sensor coverage found is **voltage and temperature only** — no RSSI/SNR/mod-rate discovery. FR-20's core metrics would need new device definitions. Strong mmWave product, weak LibreNMS fit *today*. |
| **Aviat** | `aviat-wtm.yaml`, `LibreNMS/OS/AviatWtm.php`, `AVIAT-MODEM-MIB` — modulation state sensor with the full QAM ladder | Licensed-microwave carrier/utility segment. Real support, narrower market overlap with an enterprise/ISP P2P estate. Reconsider if the estate is licensed microwave. |
| **Ceragon** | **No OS definition, no OS class, and no MIB directory found in the LibreNMS tree.** | Significant licensed-microwave market share but effectively **unsupported by LibreNMS out of the box**. Selecting it would mean authoring device support — the highest-cost option, and adjacent to the FR-07 boundary. This is exactly the kind of thing recall would get wrong: "Ceragon is a top microwave vendor" is true and *irrelevant* to a LibreNMS-based platform. |

**Selected: Cambium + Ubiquiti.** They are the two with (a) the largest P2P/PTP footprint in the segment this platform serves, and (b) the deepest *already-existing, verified* LibreNMS RF instrumentation — including the three metrics FR-20 names by hand. No LibreNMS core change is needed for either (FR-07 respected).

---

## Decision 2 — the pairing model: **vendor MIB inference, with an explicit registry override**

Revision 1 listed four candidate pairing models. Narrowing to Cambium + Ubiquiti changes the calculus, because both selected vendors **expose the far end over SNMP**. Verified against the in-tree MIBs:

- `UBNT-AirFIBER-MIB`: `remoteMAC`, `linkName`, plus a full remote-side metric block (`remoteTXPower`, `remoteTXModRate`, `remoteRXPower0/1`, `remoteRXGain`).
- `UI-AF60-MIB`: `af60StaRemoteRSSI`, `af60StaRemoteSNR`, `af60StaRemoteDistance` — remote metrics per station index.
- `CAMBIUM-PTP670-MIB`: `remoteMACAddress` / `remoteMACAddressLinked`, `remoteUnitName` / `remoteUnitNameLinked`, `remoteInternetAddress` / `remoteInternetAddressLinked`, `linkName`, plus `wirelessLinkStatus`, `linkLoss`, `vectorError`, `signalStrengthRatio`.
- `CAMBIUM-PMP80211-MIB` (ePMP): `connectedSTAMAC` — already consumed by `Epmp.php` to label per-subscriber sensors.

**Decision: option 3 (vendor MIB inference) is the primary pairing mechanism, with option 2 (an explicit registry) available as a narrow override.** Rationale:

1. **It requires no convention the estate may not have.** Option 1 (naming convention) was the cheapest to build and the most likely to be wrong — and since the human did *not* tell us a convention exists, betting the highest-value feature on one would be exactly the failure revision 1 refused to commit.
2. **The pairing key is authoritative.** A device that reports its peer's MAC is stating a fact about the radio link, not a fact about someone's hostname discipline. Pairing therefore self-heals when a radio is replaced or re-addressed.
3. **The override earns its keep in three real cases** the inference cannot cover: a peer that LibreNMS does not manage (single-ended link), a peer whose `remoteMAC` is unreadable (metric withheld — the FR-24 `unavailable` case), and a deliberate operator correction. The override is a *small* store, not a full link registry to be hand-maintained.

**Pairing algorithm (Phase 2 design intent, not Phase 1 code):**

1. For each device whose LibreNMS OS is in the selected set (`airos`, `airos-af`, `airos-af-ltu`, `airos-af60`, `epmp`, `ptp250/500/600/650/670/800`), read the vendor peer-identity OID for that OS.
2. Normalise the peer key (MAC canonicalised to lowercase colon-free; IP as a secondary key; unit/link name as a tertiary, human-facing label only — **never** as the join key, because names are editable).
3. Join to a managed device by matching the peer key against that device's own interface MACs / management addresses as LibreNMS already records them.
4. A link is **confirmed** when the join is reciprocal (A names B *and* B names A). A one-way join is **provisional** and rendered as such — it is usually a genuine finding (the far end is unmanaged, or unreachable), not noise to be hidden.
5. No join at all → the radio appears as **unpaired**, explicitly. It is never silently omitted from the matrix; an invisible radio is how a dead link stays undetected.
6. The override store, if present, wins over inference for the specific link it names, and records who set it and when.

**Link identity** is derived deterministically from the ordered pair of managed device IDs (lower ID first), so the same link gets the same identity across polls without a generated key needing to be persisted before the registry exists.

**Metric surface per link** (FR-20's columns), from what is verified available: SNR and RSSI at both ends where the vendor reports remote values (Ubiquiti AF60 natively; otherwise from each end's own sensors joined by the link), modulation/data rate from `curTXModRate` / `transmitModulationRate` / `receiveModulationRate`, plus link status from `wirelessLinkStatus` where present. **Every one of these must be able to render as `unavailable`, never as `0`** — see Decision 3.

---

## Decision 3 — what Phase 0/1 must still not foreclose (carried forward unchanged, and now partly discharged)

Revision 1's three no-foreclosure commitments stand, and this revision is the reason two of them were worth making:

- **Device inventory reads (FR-37..39) stay device-oriented**, with no implied link relationship in the API shape or cache keys. Unchanged.
- **No team-owned persistent store in Phase 1.** Still binding — and note that Decision 2's override store *is* a team-owned store, so **Phase 2 must open its own ADR for the versioned-migration mechanism** (the overlay flags it as undecided). It is small, which makes it tempting to add without a decision record. It should not be.
- **`unavailable` as an explicit discriminated state in shared types from the outset** (ADR 0005, ADR 0002 type design). This is now clearly load-bearing: `remoteRXPower0Valid`/`remoteRXPower0Overload` exist in `UBNT-AirFIBER-MIB` precisely because a receive-power reading can be present-but-meaningless. A type that coerces that to `0` would render an overloaded receiver as a healthy one.

---

## Revision 1 context (superseded, retained deliberately)

Revision 1 recorded **"no pairing model is selected"** and refused to choose, on the grounds that FR-20..24's entire acceptance block and the platform's persistence posture hung off an unanswered OQ-11, and that guessing (for example, assuming a naming convention) would be the most expensive kind of wrong. It listed four candidate models — naming convention, explicit configuration registry, vendor MIB inference, LibreNMS grouping/tagging — and named the vendor list as a prerequisite rather than a detail.

**That reasoning was correct and is why this revision is cheap.** What changed is not the reasoning but the input: the human narrowed the vendor scope, which let vendor MIB inference be *evaluated against real MIBs* instead of assumed. The revision-1 position is preserved here because an ADR records how a decision was reached, and "we deliberately did not decide, then decided when the input arrived" is the useful part of the history.

**Still unanswered from revision 1's list** (and therefore still the first thing to ask when the estate inventory arrives): the actual vendor/model mix, whether a naming or tagging convention exists, and whether single-ended radios exist and how they should appear. Decision 2 step 5 gives single-ended radios a defined rendering, which de-risks that last one without pretending it is answered.

---

## Consequences

**Positive:** Phase 2 can now be planned. The pairing mechanism depends on facts verified in the LibreNMS tree rather than on an estate convention nobody has confirmed. Both selected vendors need zero LibreNMS core change (FR-07). The reciprocal-join rule makes "the far end is unmanaged" a visible state instead of a missing row.

**Negative:** the vendor narrowing is an assumption about the estate, made in the estate's absence. If the real estate is, say, Ceragon-heavy, this ADR's Decision 1 is wrong and Decision 2's inference approach may still hold but with device support to author first — a materially larger Phase 2. Additionally, the override store drags in the migration-mechanism decision, which must get its own ADR rather than being smuggled in.

**Risk, stated plainly:** the P2P matrix is per the requirement doc §1.1 the highest-value feature of the product. This ADR removes the *blocking* unknown but not the *estate* unknown. **Obtain the vendor/model inventory before Phase 2 planning begins**, and treat any mismatch with Decision 1 as a trigger to revise this ADR rather than to improvise in code.
