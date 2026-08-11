# 0009. LibreNMS → TSDB write path: carbon bridge vs InfluxDB v2 (F-2)

- **Status:** **ACCEPTED — Option (b): switch the TSDB to InfluxDB v2 (LibreNMS-native).** Human decision on OQ-3 (re-answered), 2026-08-09, routed through Jarvis. TimescaleDB is dropped as the metrics store. Gate posture: approved under the existing G2 by direct human decision (amend-and-proceed, no re-gate); the FR-58 re-run is the quality gate. **This ADR records a made decision — it is not asking for one.** The PROPOSED two-option analysis below is retained verbatim as decision history.
- **Date:** 2026-08-09 (proposed and accepted same day)
- **Deciders:** Human (OQ-3 owner — decided Option (b)); Technical Architect (author, recommendation only).
- **Work item:** `nms-platform-foundation`
- **Relates to:** OQ-3, ADR 0005 (rev 3-b — InfluxDB v2, this ADR drives that revision), ADR 0002 (BFF-only data path), ADR 0008 (deployment topology), FR-04, FR-26, FR-28, FR-46, FR-58.
- **Supersedes:** ADR 0005 rev 2's TimescaleDB choice (and its assumption that LibreNMS can write to TimescaleDB — that assumption was measured false, see Context). ADR 0005's `MetricsReader` port and isolation strategy are NOT superseded and stand under the chosen option.
- **Design detail:** `docs/design/nms-platform-foundation-deployment-findings.md` §F-2.

## Decision (ACCEPTED — Option (b), InfluxDB v2)

**The time-series store is switched from TimescaleDB to InfluxDB v2**, LibreNMS's first-class `InfluxDBv2` datastore. The human chose the native-datastore option over building a bespoke Graphite→TimescaleDB carbon bridge: it removes a new team-owned deployable and its failure modes on the shared POC host, at the price of the SQL query surface (FR-26 percentile / FR-28 reconciliation move to Flux/InfluxQL).

What this decision obliges (all doc-only here; host execution is the maker's dispatch):

1. **ADR 0005 rev 2's TimescaleDB choice is superseded.** ADR 0005 moves to **revision 3-b (InfluxDB v2)**; rev-1/rev-2 reasoning is retained as history there.
2. **The `MetricsReader` port stands, unchanged.** No vendor type is in its signatures. The Phase-2 adapter target is **`InfluxMetricsReader`** (not `TimescaleMetricsReader`). This is an adapter selection, not a redesign — rev 1 named both candidate adapters precisely so OQ-3 could move without a refactor.
3. **Container swap:** the pinned `timescale/timescaledb` container is replaced by a deliberately pinned `influxdb:2.x` (the 1.x/2.x/3.x split is a known hazard — pin v2 explicitly, never `:latest`).
4. **Retention becomes a bucket policy:** the 14-day retention (previously a Timescale retention policy) is re-expressed as an InfluxDB v2 **bucket retention set as a precondition of first start** — the shared-disk / waived-snapshot guardrail (team-config §8 guardrail 4) is unchanged in intent, only in mechanism.
5. **The vestigial TimescaleDB container is removed** from `~/nms` with co-tenancy care. It carries **`count(*)=0`** — nothing ever wrote to it, so there is **no data migration**.
6. **BFF credential handling is unchanged and non-negotiable:** the InfluxDB v2 token is held server-side by the BFF only, injected at runtime, never committed, never delivered to a browser. No browser→TSDB connection — ADR 0002 / CON-6 stand in full.
7. **OQ-4 unchanged:** RRD is kept alongside for native-UI graphs (FR-40/G-3). Both stores receive writes; the custom UI reads only the TSDB (now InfluxDB v2).

**Consequence for the write path:** FR-58 check 6b (metrics landing in the TSDB) was FAIL under TimescaleDB because no driver existed. Under InfluxDB v2 there is a native driver; the maker's FR-58 re-run targets metrics actually landing in an InfluxDB v2 bucket. Until that re-run passes, the write path remains UNVERIFIED-in-execution — but it is no longer UNVERIFIABLE-by-design (the missing-driver blocker is gone).

---

*The following is the original PROPOSED analysis, retained verbatim as decision history. Where it reads "the human decides", that decision has now been made — Option (b) — as recorded above.*

## Context

ADR 0005 rev 2 accepted TimescaleDB (human's OQ-3 answer at G2) and Decision point 2 flagged the LibreNMS→Timescale write path as *verify-don't-assume*. Deployment measured it **absent, not misconfigured**: LibreNMS 25.7.0 ships datastore drivers `Rrd, Graphite, InfluxDB, InfluxDBv2, Prometheus, OpenTSDB, Kafka` and **no PostgreSQL/TimescaleDB driver**; TimescaleDB exposes no Influx/Graphite listener. The hypertable + 14-day retention are correctly built but `count(*) = 0`. The premise under which the human answered OQ-3 — that LibreNMS could feed a SQL store — is false. Evidence: `task-0.2-0.6-deployment-evidence.md` (FR-58 check 6b).

This is the memory-recorded lesson: *a G2-approved assumption about a third-party product's capability is not verified until something connects the two ends.* It surfaced only at deploy because no earlier gate touched a running LibreNMS.

## Options

### Option (a) — Graphite→TimescaleDB carbon bridge (keeps TimescaleDB)
LibreNMS `Graphite` datastore emits `metric value timestamp\n` over TCP; a new internal-only carbon-listener container maps those lines into `nms_metrics`. Keeps the human's TimescaleDB choice and the SQL read surface (FR-26 percentile, FR-28 reconcilability). **Cost:** a new team-owned deployable whose failure modes (schema mapping, bounded buffering/backpressure on a shared-disk host, health visibility) the Architect owns; a plan amendment; and — because it is code — its own G-cycle or an explicit "write path unverified" deferral.

### Option (b) — switch TSDB to InfluxDB v2 (LibreNMS-native)  ← **CHOSEN**
LibreNMS ships `InfluxDBv2` first-class; configure it and drop the bridge. **Cost:** revises OQ-3 and ADR 0005 (human decision); gives up SQL ergonomics (FR-26/FR-28 move to Flux/InfluxQL); changes the Phase-2 `MetricsReader` adapter target from `TimescaleMetricsReader` to `InfluxMetricsReader` (the port itself is unchanged); swaps the TimescaleDB container for a pinned `influxdb:2.x`; re-expresses the 14-day retention as a bucket policy (still a precondition of first start); and must pin v2 deliberately (the 1.x/2.x/3.x split is a known hazard).

## What does NOT change either way
- **ADR 0005's `MetricsReader` port** — vendor-neutral, no SQL/Flux/line-protocol in any signature. It anticipates *either* adapter (both were named in rev 1). The decision picks which single adapter is written in Phase 2; it is not a refactor.
- **ADR 0002 / CON-6** — BFF-only, no browser→TSDB. Both options internal-only, never published.
- **OQ-4** — RRD kept alongside for native-UI graphs.
- **Phase 1** — zero TSDB reads; only `checkHealth()`, whose probe target follows the decision.

## Recommendation (Architect — human decided)
**Option (a) if the write path is built and verified in this work item; otherwise Option (b).** OQ-3 was chosen *for* SQL's reconcilability (FR-28) and percentile ergonomics (FR-26); only the transport broke, and a documented transport (carbon) restores it without discarding the reason for the choice. But (a) is a new bespoke deployable with real failure modes on a shared POC host — if minimising new components wins, (b) moves the write path into a product built for it at the price of the SQL surface. Deciding question for the human: **how load-bearing are FR-26/FR-28's SQL ergonomics for this platform's dashboards?** — **RESOLVED: the human chose (b), minimising new components on the shared POC host.**

## Consequences
- **On (a):** TimescaleDB and ADR 0005 rev 2 stand; a new bridge component + G-cycle; `TimescaleMetricsReader` in Phase 2. *(Not chosen.)*
- **On (b) — CHOSEN:** ADR 0005 gets a rev 3-b (InfluxDB v2); OQ-3 re-answered; `InfluxMetricsReader` in Phase 2; container swap; bucket-retention precondition; vestigial TimescaleDB container removed (count=0, no migration).
- **Historical note (superseded by the ACCEPTED decision above):** *"Until decided: the TSDB write path is UNVERIFIED and FR-58 check 6b remains FAIL. No Phase-2 read adapter should be built until the target is chosen."* — The target is now chosen (InfluxDB v2). The Phase-2 read adapter is `InfluxMetricsReader`; FR-58 check 6b is re-run by the maker against InfluxDB v2.
