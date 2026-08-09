# 0005. Time-series store choice: TimescaleDB, behind a MetricsReader port

- **Status:** **ACCEPTED (revision 2, 2026-08-09) — OQ-3 resolved by the human: TimescaleDB — BUT rev 2's core premise is measured FALSE at deploy (F-2). See the Revision-3 note below.** The isolation strategy (MetricsReader port) is ACCEPTED and stands unchanged under every option. Revision 1 was BLOCKED on OQ-3; its option analysis is retained below as superseded context.

> ## Revision 3 note (2026-08-09) — F-2: the LibreNMS→TimescaleDB write path does NOT exist
>
> **Rev 2's Decision point 2 ("the write path is less-travelled and must be VERIFIED in Phase 0, not assumed") was the right flag — and deployment measured the path ABSENT, not misconfigured.** LibreNMS 25.7.0 ships datastore drivers `Rrd, Graphite, InfluxDB, InfluxDBv2, Prometheus, OpenTSDB, Kafka` and **no PostgreSQL/TimescaleDB driver**; TimescaleDB exposes no Influx/Graphite listener. The hypertable + 14-day retention are correctly built but `count(*)=0` — nothing can write to them. Evidence: `task-0.2-0.6-deployment-evidence.md` (FR-58 check 6b). This invalidates the premise the human answered OQ-3 on.
>
> **This is a human decision (it revisits OQ-3), tracked in ADR 0009**, which presents two options with trade-offs: **(a)** keep TimescaleDB and add a Graphite→TimescaleDB carbon bridge; **(b)** switch to InfluxDB v2 (LibreNMS-native). **Rev 2 below is retained verbatim as superseded context** — its reasoning for choosing TimescaleDB (FR-26 percentile-in-SQL, FR-28 reconcilability) was not wrong; only its assumption that LibreNMS could write to it was. **The `MetricsReader` port and isolation strategy stand under BOTH options** (rev 1 named both adapter classes precisely so OQ-3 could move without a redesign). On decision: if (a), rev 2 stands and this becomes rev 3-a; if (b), a rev 3-b records InfluxDB v2. Until the human decides, FR-58 check 6b stays FAIL and no Phase-2 read adapter is built. Design detail: `docs/design/nms-platform-foundation-deployment-findings.md` §F-2.

- **Date:** 2026-08-09
- **Deciders:** Human (OQ-3), Technical Architect (isolation strategy)
- **Work item:** `nms-platform-foundation`
- **Relates to:** OQ-3, OQ-4, FR-04, FR-46, DEP-5, NFR-07, requirement doc §12

## Context

FR-04 requires LibreNMS to write metrics to a dedicated TSDB, and FR-46 requires dashboard time-series reads to go through the platform backend. **OQ-3 (InfluxDB vs TimescaleDB) was unresolved at revision 1** and was a human decision. It is now **resolved: TimescaleDB** (human decision, 2026-08-09). Revision 1's refusal to invent it stands as the right call — the two options differ in query language, client library, schema model, and operational profile.

## Why this does not block Phase 1

Phase 1 (requirement doc §12) is SSO + alarm console + inventory: **FR-10..19, FR-30..35, FR-37..40, FR-43, FR-46..47**. Of these, the only time-series-adjacent item is FR-46, which states the *rule* for reads (via the backend, never browser-direct) rather than requiring any specific chart. Every chart requirement lives in Phase 2/3 (FR-22..23, FR-26..27). Alarms and inventory come from the LibreNMS REST API and MariaDB-backed inventory, not the TSDB.

So Phase 1 needs the TSDB **stood up and receiving writes** (Phase 0 infrastructure, FR-04) but does not need a single read query. That is the seam this ADR exploits.

## Decision (isolation strategy — the part I am deciding)

Phase 1 defines a **`MetricsReader` port** in the BFF: a narrow interface expressed purely in domain terms, with no vendor type in its signature.

```
MetricsReader
  querySeries(request: SeriesQuery): Promise<SeriesResult>
  queryLatest(request: LatestQuery): Promise<LatestResult>
  checkHealth(): Promise<DependencyHealth>
```

where `SeriesQuery` names a metric, a device/interface selector, a time range, and an aggregation step, and `SeriesResult` carries typed points plus an explicit `unavailable` discriminator — the type-level basis for FR-24/NFR-22, so an absent metric cannot be silently coerced to `0`.

**No Influx line-protocol type, no Flux/InfluxQL string, and no SQL fragment appears in any signature or in any caller.** Exactly one adapter implements this port, selected at startup by validated configuration. Phase 1 ships:

- the port and its types in `packages/bff`,
- a `checkHealth()` implementation used by `/ready` (NFR-21), which is the *only* Phase-1 code path that actually touches the TSDB,
- no read adapter beyond health, because Phase 1 has no read requirement.

The real read adapter (`InfluxMetricsReader` or `TimescaleMetricsReader`) is a **Phase 2 task**, written once OQ-3 is answered. If the answer arrives during Phase 1, nothing changes; if it arrives late, Phase 2 starts with one adapter to write rather than a refactor to perform.

## Decision (revision 2) — TimescaleDB

**OQ-3 is resolved: the time-series store is TimescaleDB.** The human decided this on 2026-08-09 and it is recorded in team-config §8 and the requirement doc revision history. What follows is what that decision now *obliges*, because a resolved choice creates work that an open question did not:

1. **TimescaleDB is a service in the Phase 0 deployment topology** on `10.121.77.206`, alongside LibreNMS, MariaDB, Redis, RRDCached and Keycloak. It appears in the pinned Compose manifest (plan Task 0.2) with an explicitly pinned image — no `:latest`. Its resource cost is counted in the ADR 0008 sizing table (~1–2 vCPU / 2 GB / 20 GB+, disk-growing).
2. **The LibreNMS→Timescale write path must be VERIFIED during Phase 0, not assumed.** This was named as TimescaleDB's one real cost in revision 1 and the decision does not remove it: LibreNMS's Influx output path is the better-trodden one. Plan Task 0.6 therefore checks that a metric row for a polled simulated device actually lands in TimescaleDB — presence of the service proves nothing. If the write path does not work as configured, that is a Phase 0 finding to report, not something to work around in the BFF. **[Rev-3 note: this is exactly what happened — F-2. The path is absent. See the Revision-3 note at the top.]**
3. **The Phase 1 read surface does not change.** Phase 1 still performs **no** time-series reads (see "Why this does not block Phase 1" above), so Phase 1 ships the port plus `checkHealth()` only — now with a **Timescale/Postgres** health probe rather than a vendor-undecided one. The read adapter is `TimescaleMetricsReader` and remains a Phase 2 task.
4. **The port stays.** The `MetricsReader` abstraction is *not* now redundant. It keeps SQL out of every caller, which is what makes FR-26/FR-28's percentile method reviewable in one place, and it is the seam that makes a future store change a one-file change. Deleting it because the vendor is known would trade a small abstraction for scattered SQL in every chart endpoint.
5. **What the decision makes easier, and it is worth naming:** FR-26 requires 95th-percentile computation and FR-28 requires the method to be **documentable and reconcilable**. In SQL that reconciliation is a readable query an operator can re-run by hand. That argument was flagged in revision 1 as "a nudge, not a decision" — the human's choice has landed on the side it pointed to.
6. **Credential handling is unchanged and non-negotiable:** the TimescaleDB credential is held **server-side by the BFF only**, injected at runtime, never committed, and never delivered to a browser. **No browser→TSDB connection** — ADR 0002 and CON-6 stand in full. A SQL-speaking store is, if anything, a stronger reason to hold that line: a leaked Postgres credential is a more general capability than a leaked read-only metrics token.

**OQ-4 (keep RRD alongside) — position unchanged and now confirmed by the deployment package:** RRD is kept. RRDCached is in the FR-54 service list and in the Compose manifest, so the native-UI graphs keep working (FR-40/G-3). Both stores receive writes; the custom UI reads only TimescaleDB.

## Considered options for the decision I was NOT making at revision 1 (superseded — retained as the trade-off record)

Recorded so the decision is reviewable, and because an ADR should show what was weighed rather than only what won:

**InfluxDB** — the better-trodden LibreNMS path; LibreNMS ships first-class Influx output configuration. Purpose-built retention/downsampling. Cost: a query language (Flux or InfluxQL, version-dependent) that nobody else in this stack uses, and the 1.x/2.x/3.x split is a genuine versioning hazard that must be pinned deliberately.

**TimescaleDB** — PostgreSQL, so the query language is SQL, percentile work (FR-26's 95th percentile) is expressible with well-understood SQL functions, and the operational knowledge is commodity. Cost: the LibreNMS→Timescale write path is less travelled than the Influx one and needs verification during Phase 0 rather than assumption.

**A relevant nudge, not a decision:** FR-26 requires 95th-percentile computation and FR-28 requires the method to be *documentable and reconcilable*. That reconciliation argument is easier to win in SQL than in Flux. This is one input among several — retention policy, existing organisational standards (which OQ-3 explicitly asks about), and operational familiarity may well outweigh it.

**OQ-4 (keep RRD alongside?) is coupled to this** and is also unresolved. Keeping RRD preserves native-UI graph behaviour (relevant because FR-40/G-3 keep the native UI as the admin surface, and native graphs breaking would be a visible regression). Recommendation: **keep RRD in Phase 0/1**, since it is LibreNMS's default and removing it is an optimisation with a user-visible downside.

## Consequences

**Positive:** Phase 1 proceeds without guessing; the vendor choice lands behind one interface with one implementation site; swapping vendors later touches one file rather than every chart endpoint.

**Negative:** a port with only a health implementation in Phase 1 is mild speculative generality. Accepted, because the alternative is either blocking Phase 1 on a human decision that does not gate it, or scattering vendor calls and paying for it later. The port is also small enough (two read methods) to avoid over-abstraction.

**Blocking note (revision 1, now discharged):** revision 1 stated the human must answer OQ-3 before Phase 2 begins, and that it did not block G2. **OQ-3 was answered at G2 (TimescaleDB), so Phase 2 is unblocked on this axis.** The residual risk moved rather than disappeared: it now sits in the Phase 0 verification of the LibreNMS→Timescale write path (Decision point 2 above), which is a measurable check rather than an open question. **[Rev-3 note: that measurable check FAILED — F-2 — and the residual risk has now materialised into ADR 0009's human decision.]**
