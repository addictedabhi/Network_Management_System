# 0009. LibreNMS → TSDB write path: carbon bridge vs InfluxDB v2 (F-2)

- **Status:** **PROPOSED — DECISION PENDING HUMAN.** This ADR revises a human-answered open question (OQ-3) and therefore does not self-resolve. Two options are presented with trade-offs and an Architect recommendation; the human decides via Jarvis (gate).
- **Date:** 2026-08-09
- **Deciders:** Human (OQ-3 owner) — pending; Technical Architect (author, recommendation only)
- **Work item:** `nms-platform-foundation`
- **Relates to:** OQ-3, ADR 0005 (rev 2 — TimescaleDB, this ADR revisits it), ADR 0002 (BFF-only data path), ADR 0008 (deployment topology), FR-04, FR-26, FR-28, FR-46, FR-58.
- **Supersedes on decision:** ADR 0005 rev 2's assumption that LibreNMS can write to TimescaleDB (that assumption is false — see Context). ADR 0005's `MetricsReader` port and isolation strategy are NOT superseded and stand under either option.
- **Design detail:** `docs/design/nms-platform-foundation-deployment-findings.md` §F-2.

## Context

ADR 0005 rev 2 accepted TimescaleDB (human's OQ-3 answer at G2) and Decision point 2 flagged the LibreNMS→Timescale write path as *verify-don't-assume*. Deployment measured it **absent, not misconfigured**: LibreNMS 25.7.0 ships datastore drivers `Rrd, Graphite, InfluxDB, InfluxDBv2, Prometheus, OpenTSDB, Kafka` and **no PostgreSQL/TimescaleDB driver**; TimescaleDB exposes no Influx/Graphite listener. The hypertable + 14-day retention are correctly built but `count(*) = 0`. The premise under which the human answered OQ-3 — that LibreNMS could feed a SQL store — is false. Evidence: `task-0.2-0.6-deployment-evidence.md` (FR-58 check 6b).

This is the memory-recorded lesson: *a G2-approved assumption about a third-party product's capability is not verified until something connects the two ends.* It surfaced only at deploy because no earlier gate touched a running LibreNMS.

## Options

### Option (a) — Graphite→TimescaleDB carbon bridge (keeps TimescaleDB)
LibreNMS `Graphite` datastore emits `metric value timestamp\n` over TCP; a new internal-only carbon-listener container maps those lines into `nms_metrics`. Keeps the human's TimescaleDB choice and the SQL read surface (FR-26 percentile, FR-28 reconcilability). **Cost:** a new team-owned deployable whose failure modes (schema mapping, bounded buffering/backpressure on a shared-disk host, health visibility) the Architect owns; a plan amendment; and — because it is code — its own G-cycle or an explicit "write path unverified" deferral.

### Option (b) — switch TSDB to InfluxDB v2 (LibreNMS-native)
LibreNMS ships `InfluxDBv2` first-class; configure it and drop the bridge. **Cost:** revises OQ-3 and ADR 0005 (human decision); gives up SQL ergonomics (FR-26/FR-28 move to Flux/InfluxQL); changes the Phase-2 `MetricsReader` adapter target from `TimescaleMetricsReader` to `InfluxMetricsReader` (the port itself is unchanged); swaps the TimescaleDB container for a pinned `influxdb:2.x`; re-expresses the 14-day retention as a bucket policy (still a precondition of first start); and must pin v2 deliberately (the 1.x/2.x/3.x split is a known hazard).

## What does NOT change either way
- **ADR 0005's `MetricsReader` port** — vendor-neutral, no SQL/Flux/line-protocol in any signature. It anticipates *either* adapter (both were named in rev 1). The decision picks which single adapter is written in Phase 2; it is not a refactor.
- **ADR 0002 / CON-6** — BFF-only, no browser→TSDB. Both options internal-only, never published.
- **OQ-4** — RRD kept alongside for native-UI graphs.
- **Phase 1** — zero TSDB reads; only `checkHealth()`, whose probe target follows the decision.

## Recommendation (Architect — human decides)
**Option (a) if the write path is built and verified in this work item; otherwise Option (b).** OQ-3 was chosen *for* SQL's reconcilability (FR-28) and percentile ergonomics (FR-26); only the transport broke, and a documented transport (carbon) restores it without discarding the reason for the choice. But (a) is a new bespoke deployable with real failure modes on a shared POC host — if minimising new components wins, (b) moves the write path into a product built for it at the price of the SQL surface. Deciding question for the human: **how load-bearing are FR-26/FR-28's SQL ergonomics for this platform's dashboards?**

## Consequences
- **On (a):** TimescaleDB and ADR 0005 rev 2 stand; a new bridge component + G-cycle; `TimescaleMetricsReader` in Phase 2.
- **On (b):** ADR 0005 gets a rev 3 (InfluxDB v2); OQ-3 re-answered; `InfluxMetricsReader` in Phase 2; container swap; bucket-retention precondition.
- **Until decided:** the TSDB write path is UNVERIFIED and FR-58 check 6b remains FAIL. No Phase-2 read adapter should be built until the target is chosen.
