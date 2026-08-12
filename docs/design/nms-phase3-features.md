# AirNMS Phase 3 — Four Features (design + endpoint map)

- **Work item:** `nms-platform-foundation` — Phase 3 (dev-fast; design checkpoint before build)
- **Author:** Technical Architect · 2026-08-12
- **Status:** DRAFT for human G2-style go-ahead via Jarvis. Doc-only; no code, no host contact.
- **Builds ON:** the working tree at `0ad5fe8` (Phase 2 + 2.5 + branding + fluid UI, all uncommitted for the human's G4). Reuses the already-approved architecture (BFF-only data path, `MetricValue` union, `InfluxMetricsReader`, strict-nonce CSP). **No new ADR** unless the human accepts a new time-series/log data-path (flagged in §F, not decided here).

> **Scope discipline.** This is a proportionate design: scope + approach + endpoint map, grounded in the data we ACTUALLY have (deploy evidence 2026-08-11). Every panel below names its real series and states, up front, what is honestly **"Not available"** at POC. No fabrication (`unavailable ≠ 0`, FR-24). Four data-states everywhere (loading / error / empty / unavailable — distinct). ECharts canvas, no `unsafe-inline`. Fluid `main{width:100%}` shell.

---

## 0. What already exists (reuse, don't reinvent)

**BFF routes already built and green:**
- `GET /api/v1/devices` (+ `hostname/location/reachability/kind/sort/order`, BFF-windowed) · `GET /devices/:id` · `GET /devices/:id/interfaces` · `GET /devices/:id/metrics/latest` · `GET /devices/:id/metrics/series` · `GET /admin-portal-url` (role-gated).
- `GET /api/v1/alarms` (state=1 active, BFF-windowed, severity/acknowledged/deviceKind filters) · `POST /alarms/:id/ack` (**role-gated admin/engineer SERVER-SIDE, CSRF header, actor from session** — the ratified policy is already enforced in `alarms.ts`).

**InfluxMetricsReader registry (live-verified 2026-08-11):** `af60StaRSSI`, `af60StaSNR`, `af60TxCapacity`, `af60RxCapacity` (mod-rate), `cpuUsage` (`processors/usage`), `memUsedBytes`/`memFreeBytes` (`mempool`), `ifInOctets_rate`/`ifOutOctets_rate` (`ports`). `querySeries` (time-windowed) and `queryLatest` both exist. All keyed by `hostname`.

**Live data reality (deploy evidence):**
| id | host | CPU | mem | RF | ports | note |
|----|------|-----|-----|----|----|------|
| 2 | 172.16.10.22 | — | — | — | — | ping-only host, **Down**; ICMP only |
| 3 | sim-switch-01 | ✓ | ✓ | — | ✓ | |
| 4 | sim-router-01 | ✓ | ✓ | — | ✓ | High-CPU alarm fires (34%) |
| 5 | sim-radio-01 (AF60) | ✓ | — | full RF + mod-rate | — | RSSI/SNR/Tx-Rx-cap/Distance/Freq |
| 6 | sim-radio-02 (AF60) | ✓ | — | RF, **RSSI withheld** | — | FR-24 showcase: RSSI "Not available" |

**Two real alarms fire** (Device down on 172.16.10.22; High CPU on sim-router-01). Radio memory and ping-host SNMP are honestly unavailable.

---

## a) Alarm console (full page) — size **M**

Dedicated `/alarms` page beyond the dashboard `AlarmFeed` widget.

**Panels/UI:**
- **Full alert list** — reuses `GET /api/v1/alarms` (active) with **server-side filters** severity / device / type / state, server-side paginated (BFF `windowPage`).
- **Ack workflow** — reuses `POST /alarms/:id/ack` as-is: **role-gated engineer/admin server-side; operators/readonly get 403** (already built, non-negotiable floor). UI hides the button for non-privileged roles (presentation only; the control is the 403).
- **Alarm history / timeline** — per-alarm state-transition history. **NEW endpoint needed** (see below): LibreNMS exposes `/api/v0/alertlog/{hostname?}` which returns `alert_log` rows (state transitions, `time_logged`, `details`) with real server-side `start/limit/from/to/sortorder` and a real `total`. This is the source; the acknowledger-identity work already touched eventlog, so the log-read pattern is familiar.
- **Real-time-ish refresh** — client polling (e.g. 15–30s) of the active list; "updated Xs ago" freshness (FR-44). No WebSocket in this slice.

**Reuse:** `/api/v1/alarms` + ack, both as-is.
**Honestly "Not available" at POC:** only **2 active alarms** exist and **3 alert rules** are configured, so filter dropdowns will be sparse; the timeline for those 2 alarms is real but short. The RSSI rule is a no-op (documented) — not shown as a firing alarm.

**NEW endpoint:** `GET /api/v1/alarms/:id/history` → LibreNMS `GET /api/v0/alertlog?...` (filtered to the alert's device/rule). Session-gated (read; no role gate — reading history is not state-changing). **Feasible: YES** — verified in `list_logs` (real SQL `WHERE`/`LIMIT`, real `total`).

---

## b) P2P link matrix (full page) — size **M/L**

The signature feature as a full `/links` (or `/links/:id`) page — the dashboard `P2PLinkMatrix` widget is the summary; this is the depth.

**Panels/UI:**
- **Per-link trends over time** — RSSI / SNR / mod-rate (Tx/Rx Capacity) **over a selectable window** via `querySeries`. Reuses `GET /devices/:id/metrics/series` for `af60StaRSSI`, `af60StaSNR`, `af60TxCapacity`, `af60RxCapacity` — **all already registered and live-confirmed landing.**
- **Link-health history / stability charts** — derived client-side from the same series (variance, transition markers). No new backend.
- **Frequency utilisation** — `Frequency` sensor lands live (per evidence). **NOT yet registered** in `METRIC_REGISTRY`/`ALLOWED_METRICS` — a small additive registry entry (`af60Frequency` → `wireless-sensor`/`sensor_descr=Frequency`), same shape as the existing RF metrics. Distance likewise available if wanted (`af60Distance`).

**Reuse:** `/devices/:id/metrics/series` + reader as-is; **+2 additive registry rows** (Frequency, optionally Distance) — a registry edit, not a new route.
**AF60 both-ends-per-poll (ADR 0007):** the 2 sim radios each report both ends from one poll — no pairing code. Render each as a matrix row directly.
**Honestly "Not available" at POC:**
- **sim-radio-02 RSSI stays "Not available"** (withheld — the FR-24 proof), SNR/Tx-Rx/Freq present.
- **Series confirmed live:** RSSI, SNR, Tx Capacity, Rx Capacity, Distance, Frequency (per evidence). Radio **memory** is absent (AF60 has no hrStorage) → any mem panel is honest-unavailable.
- Only 2 links exist → the matrix is short by design (not empty).

**NEW endpoint:** none. (Registry additions only.) Trends already flow through the existing series route.

---

## c) Device-detail depth — size **M**

Enriches the existing `/devices/:id` page.

**Panels/UI:**
- **Interface table with per-port throughput charts** — reuses `GET /devices/:id/interfaces` + `GET /devices/:id/metrics/series` (`ifInOctets_rate`/`ifOutOctets_rate`, keyed by `ifName`). Real for switch/router `ports`.
- **Metric history graphs (CPU/mem/RF over time)** — reuses `querySeries` for `cpuUsage`, `memUsedBytes`/`memFreeBytes`, RF metrics. Per device type: switch/router = CPU+mem+ports; radios = CPU+RF; ping host = none.
- **Device syslog / events** — **NEW endpoint** reading LibreNMS `/api/v0/eventlog/{id}` and/or `/api/v0/syslog/{id}`. **Feasibility verified:** both routes exist and `list_logs` supports server-side `start/limit/from/to/sortorder` + real `total`. **POC caveat:** eventlog will have discovery/poll/state events (thin but real); **syslog is likely EMPTY at POC** (snmpsim devices do not emit syslog; the honest empty state — "No syslog messages received" — is the deliverable, not a defect).
- **Health timeline** — from eventlog state changes (reuses the new events endpoint).

**Reuse:** interfaces + series routes as-is.
**Honestly "Not available" at POC:** ping host (id 2) = everything unavailable ("ICMP-only" panel); radios = no mem; **syslog likely empty**; eventlog thin.

**NEW endpoint:** `GET /api/v1/devices/:id/events` → LibreNMS `GET /api/v0/eventlog/{id}` (default) and `?source=syslog` → `/api/v0/syslog/{id}`. Session-gated read. **Feasible: YES.**

---

## d) More dashboards — size **M** (concrete, bounded set)

**Recommendation up front:** ship a **CONCRETE SMALL SET of 3 curated dashboards**, NOT a user-arrangeable/customisable dashboard builder. See customisation call below.

Grounded strictly in metrics we have (CPU/mem/RF/throughput/alarms):

**d.1 — Capacity dashboard** (S)
- Panels: CPU heatmap (`cpuUsage`, switch+router+2 radios = real; ping host unavailable), memory used/free gauges (switch+router only — **radios + ping host "Not available"**), RF link capacity (Tx/Rx Capacity per radio).
- Real series: `cpuUsage`, `mempool`, `af60TxCapacity`/`af60RxCapacity`.
- Honest N/A: radio memory, ping-host everything.

**d.2 — Top-talkers dashboard** (S)
- Panels: Top-N interfaces by throughput / 95th-pct (reuses `ports` derivatives), per-interface sparklines.
- Real series: `ifInOctets_rate`/`ifOutOctets_rate` on switch+router only.
- Honest N/A: devices without `ports` (radios, ping host) simply do not appear — correct, not empty.

**d.3 — Fleet trends dashboard** (M)
- Panels: fleet CPU trend over time (mean/max across polled devices via `querySeries`), active-alarm trend, up/down count over time.
- Real series: `cpuUsage` series; alarm counts from `/api/v1/alarms`; alarm-history trend from the NEW `alertlog` endpoint.
- Honest N/A: alarm trend is short (2 alarms, 3 rules) — a genuine sparse-but-real trend, not padded.

**Customisable/arrangeable dashboard — MY CALL: SCOPE-CREEP, defer.** A drag-and-drop/user-arrangeable dashboard adds layout persistence (a new team-owned store → migration mechanism → an ADR), per-user state, and a large UI surface — for a POC with **4 pollable devices and ~8 real metrics**. The value is near-zero at this scale and the cost (persistence + auth-scoped layout + tests) is high. **Recommend: 3 fixed, well-designed dashboards now; revisit customisation only when the fleet and metric catalog are large enough to warrant it.** If the human wants it, it is a separate work item with its own G1/ADR (new persistence = data-model change = versioned migration, per db-rules).

---

## e) Cross-cutting build constraints (apply to every feature)

- **Four data-states, distinct, everywhere:** loading (in flight) · error (`role=alert`, machine code, retry) · empty (backend OK, no rows — e.g. "No syslog messages") · unavailable (a specific metric absent — per-cell "Not available"). Reuse existing `<DataState>` / `<MetricValueCell>`.
- **`unavailable ≠ 0`** — enforced by `MetricValue` union + reader boundary (already structural). No new numeric-fallback path.
- **Honest empty states named** — thin at POC: alarm timeline (2 alarms), links matrix (2 links), syslog (likely empty), radio memory (absent), ping-host detail (ICMP-only).
- **ECharts canvas, no CSP regression** — client components (`'use client'`), ES-module-bundled, canvas renderer, no inline `<script>`/`<style>`, no `unsafe-inline` on `script-src`. Do not thread a nonce into charts (post-hydration). No CDN script tags.
- **Fluid layout** — all pages/panels live in the `main{width:100%}` shell; CSS classes, no inline styles that would force `style-src 'unsafe-inline'`.
- **Security floor** — no new browser-reachable credential; every read via the BFF; the ONE state-changing action (ack) stays server-side role-gated. New log-read endpoints are session-gated reads (no role gate — reads are not privileged), calling LibreNMS server-side with the server-held token.

---

## f) Consolidated NEW BFF endpoints (the backend delta — key steer)

| # | Endpoint | Method | LibreNMS/Influx source | Auth | Feasible? (verified against real 25.7.0) |
|---|----------|--------|------------------------|------|------------------------------------------|
| N1 | `/api/v1/alarms/:id/history` | GET | `GET /api/v0/alertlog?device=…&from=…&limit=…&sortorder=DESC` | session (read) | **YES** — `list_logs` supports server-side `start/limit/from/to/sortorder` + real `total`; `details` is state-transition JSON. Real per-request pagination (unlike list_alerts). |
| N2 | `/api/v1/devices/:id/events` (`?source=eventlog\|syslog`) | GET | `GET /api/v0/eventlog/{id}` / `GET /api/v0/syslog/{id}` | session (read) | **YES** — both routes exist, same `list_logs` handler, server-side windowed, real `total`. POC: eventlog thin-but-real; syslog likely empty (honest empty state). |
| — | `af60Frequency` (+ optional `af60Distance`) registry rows | (registry edit, not a route) | `wireless-sensor` / `sensor_descr` | — | **YES** — series confirmed landing live; additive `METRIC_REGISTRY` + `ALLOWED_METRICS` entries, identical shape to existing RF metrics. |

**Reused unchanged:** `/devices`, `/devices/:id`, `/devices/:id/interfaces`, `/devices/:id/metrics/latest`, `/devices/:id/metrics/series`, `/alarms`, `/alarms/:id/ack`, `/admin-portal-url`.

**Data-path note (ADR check):** N1/N2 introduce a **new LibreNMS data source (the log tables) into the BFF** — a modest extension of the existing read pattern, NOT a new store or transport. It does not change the credential model or the browser-facing contract shape. My call: **no ADR required** (it is the same "BFF reads LibreNMS server-side, windows, returns a `Paged<T>` envelope" contract already ratified). Flagged here for the human's awareness rather than decided silently; if the human wants it recorded, a one-line ADR (`0010-librenms-log-reads`) is cheap — say so and I'll draft it.

---

## g) Build order, dependencies, sizing

1. **N1 + N2 endpoints first** (BFF, TDD) — unblock (a) history and (c) events. Small, self-contained, testable in isolation. **S each.**
2. **Registry rows** (Frequency/Distance) — trivial, unblocks (b) frequency panel. **S.**
3. **(a) Alarm console** — depends on N1. **M.**
4. **(c) Device-detail depth** — depends on N2 + registry. **M.**
5. **(b) P2P link matrix full page** — depends on registry; otherwise reuses series. **M/L** (the charting-heavy piece).
6. **(d) 3 dashboards** — depend on nothing new beyond N1 (fleet-trends alarm history). **M** total (d.1/d.2 = S, d.3 = M).

**Rough total:** M-to-L slice. Backend delta is small (2 read endpoints + registry rows); the weight is UI/charting.

---

## h) What I'd cut / defer to keep the slice sane

- **Cut: user-arrangeable/customisable dashboard** — scope-creep at POC scale (needs persistence + migration + ADR). Fixed 3-dashboard set instead. (My explicit call.)
- **Defer: syslog panel richness** — snmpsim devices don't emit syslog; ship the endpoint + honest empty state, don't invest in syslog-specific UI until real devices feed it.
- **Defer: WebSocket/SSE real-time** — client polling (15–30s) is sufficient for 4 devices / 2 alarms; a push transport (OQ-13) is a separate decision, not needed for this slice.
- **Defer: alert-rule authoring UI** — out of scope; rules are managed in native LibreNMS.
- **Optional (keep only if cheap): `af60Distance` registry row** — nice-to-have, drop if it adds noise.
