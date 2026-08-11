# AirNMS UI 2.5 — Enhanced Device Table + Operational Dashboard (design)

- **Work item:** `nms-platform-foundation` — Phase 2.5 (dev-fast enabler)
- **Author:** Technical Architect · 2026-08-11
- **Status:** DRAFT for human approval (G2) via Jarvis
- **Scope:** UI-only, on the ALREADY-APPROVED architecture (BFF-only data path, `MetricValue` discriminated union, InfluxMetricsReader). **No new architecture, no ADR** — the two decisions that could need one (native deep-link shape, ack endpoint) are FLAGGED to Jarvis in §D, not invented here.

> **Reference disclaimer (read first).** The human cited "Airlinq CMP Manage Device" as a quality bar. **We have NO access to CMP** — no field list, no layout, no screenshots. Everything below is derived from **our own FRs** (FR-20..49, NFR-30, FR-24, FR-43) and the **live data we actually have** (the 5 polled devices + InfluxDB v2 `wireless-sensor`/`ports` series). "CMP-grade" is interpreted only as "polished, operational, at-a-glance" and expressed with OUR real data. Where a CMP-specific field would be a guess, it is omitted. This is a load-bearing honesty constraint, not a caveat.

## Live data we are designing against (from the Task A deploy evidence)

| id | hostname (LibreNMS) | kind | reachability | what LibreNMS actually polls |
|----|--------------------|------|--------------|------------------------------|
| 2 | 172.16.10.22 | ping-only host | Down | ICMP only — **no SNMP**: no CPU, no memory, no interfaces, no RF |
| 3 | sim-switch-01 (demo-switch-01) | switch | Up | snmpsim: interface counters (`ports`); CPU/mem **likely absent** |
| 4 | sim-router-01 (demo-router-01) | router | Up | snmpsim: interface counters (`ports`); CPU/mem **likely absent** |
| 5 | sim-radio-01 (demo-radio-01, AF60) | p2p radio | Up | RF sensors: Local RSSI **-54 dBm**, Local SNR **34 dB** |
| 6 | sim-radio-02 (demo-radio-02, AF60) | p2p radio | Up | RF sensors: SNR present; **Local RSSI WITHHELD** (FR-52) → renders "Not available" |

Ids 1 (nms-sim-device-01) and 7 (selfmon) exist but are not part of the operator inventory story. **The dashboard will honestly show gaps** — most CPU/mem cells and the alarm feed are empty/"Not available" at POC scale. That is the correct output, not a defect (memory: `unavailable ≠ 0`, FR-24).

---

## A. Enhanced device table (Item 2)

Extends the existing `packages/web/src/components/DeviceTable.tsx` + `app/devices/page.tsx`.

### A.1 Columns

| Column | Source | Notes |
|--------|--------|-------|
| Hostname | `Device.hostname` (BFF `GET /api/v1/devices`) | link → detail; free-text search target |
| Type/role | `Device.kind` | per-column filter |
| Location/site | `Device.location` | per-column filter |
| Reachability | `Device.reachability` | **status badge — icon + text, never colour-only (NFR-30)** |
| Alarm count | see A.5 | **POC = `0` / empty, honestly** — no alarm rules exist |
| Actions | detail · "Open in native LibreNMS" | A.5 |

- **Status badges (up / down / flapping):** icon glyph **+ text label**, colour is decorative only. Up = check icon "Up", Down = cross icon "Down", Flapping = pulse icon "Flapping". Flapping is a **BFF-computed** state (≥3 transitions in 5 min, OQ-12), NOT a native LibreNMS field — at POC it will effectively never fire; render only when the BFF asserts it. Reuse the `reach reach--*` classes but add an icon + `aria-label`.
- **Density toggle** (comfortable/compact) and **column show/hide**: client-side view state only, no data impact.

### A.2 Expandable rows → per-device KPIs

Expanding a row fetches per-device KPIs via existing BFF endpoints. **Each KPI maps to available / unavailable-by-design per device type** — the build must render "Not available" (via `<MetricValueCell>`), never 0, for the unavailable cells:

| KPI | BFF source | ping-host (id 2) | switch/router (3,4) | AF60 radio (5) | AF60 withheld (6) |
|-----|-----------|:---:|:---:|:---:|:---:|
| CPU % | `GET /devices/:id/metrics/latest?metric=…` (Influx) — **NOT YET REGISTERED**, see D-3 | n/a | **likely n/a** (snmpsim) | likely n/a | likely n/a |
| Memory % | same, **not yet registered** — D-3 | n/a | **likely n/a** | likely n/a | likely n/a |
| Uptime | `Device.uptimeSeconds` (LibreNMS) | n/a (down) | available | available | available |
| Key iface throughput (in/out) | `metrics/latest?metric=ifInOctets_rate\|ifOutOctets_rate&hostname=…&interfaceId=…` | n/a | **available** (`ports`) | possible | possible |
| RSSI | `metric=af60StaRSSI&hostname=…` | n/a | n/a | **-54 dBm** | **Not available** (withheld) |
| SNR | `metric=af60StaSNR&hostname=…` | n/a | n/a | **34 dB** | 34 dB |
| Mod-rate | **no reader mapping yet** — D-3 | n/a | n/a | n/a today | n/a today |

**Honesty rules for the build:**
- The **ping-only host (id 2) has NO CPU/mem/interfaces/RF** — all KPI cells render "Not available", the whole expanded panel is essentially "This device is monitored by ICMP only." Do NOT show zeros.
- **snmpsim switch/router may not expose CPU/mem** — treat CPU%/Memory% as "Not available" unless a live series proves otherwise. Interface throughput IS available (`ports` measurement verified live).
- **CPU/mem/mod-rate are NOT in `METRIC_REGISTRY` or the route `ALLOWED_METRICS` today.** They will read via the legacy predicate and almost certainly return `unavailable`. The plan may add registry entries **only if a live series exists to point at** — otherwise the honest state is "Not available", which is already correct with zero new code. **Do not fabricate a mapping to a series that isn't there.**

### A.3 Sort + filter + search — SERVER-SIDE paginated, applied in the BFF

- The table stays **server-side paginated** through the existing contract: `GET /api/v1/devices?page&perPage(&hostname&location&reachability)` → `Paged<Device>` with a **real total** (Task-6 `windowPage`).
- **Task-6 finding (memory, ASM-1 CLOSED):** the LibreNMS list endpoints do **not** paginate/filter server-side (they ignore limit/offset/type/location; `count` = array length). So the BFF **fetches the LibreNMS set, then windows it** — and filter/sort/free-text-hostname-search apply **in the BFF over the fetched set**. At POC scale (tens of devices) this is correct and cheap.
- **Sort** (by column) and **per-column filter** (type/location/reachability) and **hostname search** are all expressed as BFF query params and applied BFF-side before windowing, so the client always receives a bounded, correct page with an accurate `meta.total`.
- **`>5,000` caveat (item 23):** fetch-then-window does not scale past a few thousand devices; a real server-side cursor is **future work (item 23)**, out of scope here. State this in the UI help/dev notes; do not silently pretend it scales.

### A.4 Loading / error / empty states
The table uses the existing `<DataState>` (loading spinner `role=status`, error `role=alert` from machine-readable code + retry, distinct empty). Per-KPI unavailability inside an expanded row uses `<MetricValueCell>` — three visually/semantically distinct states already exist in code.

### A.5 Row actions

- **View detail:** existing `/devices/:id` route.
- **"Open in native LibreNMS" (per-device deep link):** the BFF endpoint **already exists** — `GET /api/v1/admin-portal-url?deviceId=<id>` (role-gated `admin`/`engineer`, server-side per FR-42) returns `{ base }/device/<id>`. **URL shape to VERIFY on the host before build:** LibreNMS canonical device page is `…/device/device=<id>` (query-style), whereas the current BFF builds `…/device/<id>` (path-style). **This is D-1 — a shape to confirm, not to guess.** The deep link goes through the gateway/native root (`https://10.121.77.206:8443/…`), which is behind the working oauth2-proxy SSO, so it opens without a second credential prompt (FR-40/41).
- **Alarm count column + ack action:** **POC has NO alarm rules → count renders `0`/empty, honestly** (never a fabricated number). Ack is **role-gated server-side** per FR-34 — but **there is NO ack BFF endpoint today** (only `devices` + `admin-portal-url` exist; no alarms route). So for 2.5 the ack action is **not wired**; if the human wants ack in this slice it needs a new BFF `POST /api/v1/alarms/:id/ack` calling the LibreNMS ack API (FR-33/35) — **D-2, flagged, not built silently.**

---

## B. Operational dashboard (Item 3)

Extends `app/dashboard/page.tsx`. Layout is a responsive grid; the **P2P link matrix is the visual centerpiece**, top row full-width.

For EVERY panel, four **distinct** states (FR-43 + FR-24, per the Item-1 bug lesson):
**loading** (fetch in flight) · **error** (backend failed — `role=alert`, machine code, retry) · **empty** (backend OK, no rows — e.g. "No active alarms") · **unavailable** (a specific metric absent — per-cell "Not available"). Empty ≠ error ≠ unavailable — three different renders, plus loading.

### Layout
```
┌───────────────────────────────────────────────────────────┐
│ FLEET KPI TILES  (total · up/down/unreachable · alarms · %polled) │
├───────────────────────────────────────────────────────────┤
│ ★ P2P LINK PERFORMANCE MATRIX  (centerpiece, full width)          │
├──────────────────────────────┬────────────────────────────┤
│ TOP-N INTERFACES (95th pct)  │ CPU / MEMORY HEATMAP        │
├──────────────────────────────┼────────────────────────────┤
│ THROUGHPUT TIME-SERIES       │ ALARM FEED + trend sparkline │
└──────────────────────────────┴────────────────────────────┘
```

### B.1 Fleet KPI tiles
- **Source:** `GET /api/v1/devices` (full windowed set) — count total, and bucket by `reachability` (up/down/unknown→"unreachable"). "% polled OK" = up / (up+down). "Active alarms by severity" = **0 across the board at POC** (no alarms route/rules) → show `0` honestly with a subtitle "no alarm rules configured".
- **States:** loading skeleton tiles; error if `/devices` fails; never "empty" (fleet always has a count, even if 0).

### B.2 ★ P2P Link Performance Matrix (centerpiece) — FR-20/21/24
- **Source:** `InfluxMetricsReader` via `metrics/latest` for `af60StaRSSI` + `af60StaSNR`, keyed by **hostname** (the tag LibreNMS actually writes). Both AF60 sim radios are single-poll dual-end (ADR 0007: AF60 reports both ends from one poll) — **no pairing code needed for the 2 sim radios**; render them as the two rows of the matrix directly.
- **Layout:** one row per link. Columns: **Endpoint A · Endpoint B · Link state · SNR · RSSI · severity indicator**. Severity is **icon + text + colour (never colour-only, NFR-30)**. This is the panel that visually anchors the dashboard — large cells, clear worst-first sort (FR-21).
- **The withheld device (id 6 / demo-radio-02): RSSI = "Not available"** (genuinely absent series — the FR-24 proof shown live), SNR = 34 dB. This is the honesty showcase: an RF matrix that renders an absent RSSI as "Not available", NOT as 0 or healthy.
- **States:** loading (querying Influx); error (Influx unreachable → whole panel error); empty (no P2P devices — not the case here); **unavailable per cell** (withheld RSSI). All four are exercised by the two live radios.

### B.3 Top-N interfaces by 95th-percentile bandwidth — FR-26/28
- **Source:** InfluxDB `ports` series (`INOCTETS`/`OUTOCTETS`, per-second derivative), 95th percentile over a selectable window. **The 95th-pct method must be documented in a tooltip (FR-28).**
- **Real data:** only the snmpsim switch/router expose `ports`; nms-sim-device-01 showed ~69/46 Bps (real derivatives). So Top-N will list a **handful of interfaces with tiny real rates** — honest, not padded. Devices without `ports` simply do not appear (they have no interfaces), which is correct, not empty-state.
- **States:** loading; error (Influx down); empty ("No interface throughput data collected") when no `ports` series exist.

### B.4 CPU / memory heatmap — FR-27
- **Source:** current CPU/mem (LibreNMS health / Influx). **HONEST FLAG: snmpsim devices likely expose NO CPU/mem**, and the ping host certainly does not. So **most/all heatmap cells will render "Not available"** at POC. The heatmap must render an explicit "Not available" cell (icon + text, NFR-30) — NOT a 0% (green) cell, which would falsely imply a healthy, idle CPU.
- **States:** loading; error; **unavailable per cell** (the dominant state here); empty ("No devices in the selected group").

### B.5 Throughput time-series
- **Source:** `metrics/series` over `ports` derivatives for a selected device/interface (InfluxDB), ranges 1h/24h/7d/30d (FR-22 pattern).
- **States:** loading; error; **empty** ("No data points in this window" — a genuine measured absence, distinct from unavailable); a real measured **0-rate** line is legitimate where genuinely idle (per evidence: demo-router/switch 0 Bps is a real timestamped zero, distinct from unavailable).

### B.6 Alarm feed + trend sparklines — FR-30/32
- **Source:** would be a LibreNMS alerts endpoint via a BFF alarms route — **which does NOT exist yet** (D-2). **POC has NO alarm rules → the panel's first-class state is a genuine EMPTY: "No active alarms."** NEVER fabricate alarm rows or a non-zero trend. The empty state is the deliverable here, not a placeholder for missing work.
- **States:** loading; error (if an alarms route existed and failed); **empty ("No active alarms")** — the operative state at POC; sparklines render flat/empty honestly.

### B.7 Data freshness (FR-44)
Each live panel shows "updated Xs ago" from the latest point timestamp so a stalled read is visibly stale, not falsely current.

---

## C. Charting choice — **ECharts**

- **Decision: Apache ECharts** (via `echarts` core + a thin React wrapper we control, or `echarts-for-react`), one-line reason: **it renders to `<canvas>` by default, so it injects NO inline `<style>`/`<script>` and needs NO `unsafe-inline`** — the safest fit under the strict nonce CSP, versus Recharts (SVG via Recharts/D3) which is fine for markup but pulls a heavier client bundle and more inline-style risk.
- **HARD CSP REQUIREMENT (must not regress item 21):** the app runs under `script-src 'self' 'nonce-…' 'strict-dynamic'` with **NO `unsafe-inline`**. ECharts canvas rendering does not require inline scripts or inline styles, so it is compatible. **Build constraints:**
  - Import ECharts as a normal ES module bundled by Next (covered by `'self'`/`'strict-dynamic'`) — do **not** inject it via an inline `<script>` or a CDN `<script>` (would need `unsafe-inline`/extra host → **reject**).
  - Use **canvas renderer** (default). If SVG renderer is ever chosen, verify it does not emit inline `<style>` needing `style-src 'unsafe-inline'`.
  - Do **not** set chart container styles via inline `style-src`-triggering attributes that would force `'unsafe-inline'` in `style-src`; use CSS classes.
- **If any candidate lib forced `unsafe-inline`, it is rejected** — the CSP floor is not relaxed for charting (memory: floor relaxation is the human's call, not the build's). ECharts-canvas clears this bar; that is why it wins over the alternatives.
- **SSR/nonce note:** charts are **client components** (`'use client'`), mounted after hydration — they do not participate in the per-request RSC inline-script path that is the open CSP issue (deploy evidence "OPEN ISSUE"). No nonce needs to be threaded into ECharts. (The separate Next-16 cold-load nonce issue is being resolved independently per memory 2026-08-11 option 2; this design does not touch or regress it.)

---

## D. Decisions FLAGGED to Jarvis (not decided here)

- **D-1 — native deep-link URL shape.** Confirm on the host whether the LibreNMS device page is `…/device/device=<id>` (query-style) or `…/device/<id>` (path-style, what the BFF builds today). One-line host check; if it differs, fix the BFF string. **Do not guess — verify.**
- **D-2 — alarm ack + alarm feed endpoints do not exist.** The alarm-count column and the alarm feed panel are honest-empty at POC. If the human wants a working ack action or a live alarm feed in 2.5, that needs a **new BFF alarms route** (`POST /api/v1/alarms/:id/ack` + `GET /api/v1/alarms`) calling LibreNMS (FR-30/33/34/35, server-side role gate). Scope decision for the human — otherwise 2.5 ships the honest empty states.
- **D-3 — CPU/mem/mod-rate metric registry.** These are not registered in `METRIC_REGISTRY`/`ALLOWED_METRICS`. Add entries **only if a live series is confirmed to exist** for the sim devices; if none exists, the honest "Not available" render needs zero new code. Do not add a mapping to a non-existent series.

## E. Reconciliation
- **ADR 0007 (P2P):** honoured — AF60 both-ends-per-poll means no pairing code for the 2 sim radios; matrix renders them directly. Multi-vendor MIB-inference pairing stays future Phase-2.
- **Item 23 (pagination scale):** fetch-then-window is POC-correct; `>5,000` server cursor is future, stated in-UI.
- **CSP floor (item 21):** ECharts-canvas, ES-module-bundled, client-side — no `unsafe-inline`, no regression.
- **Security floor:** no new browser-reachable credential; all reads via existing BFF endpoints; ack (if approved) is server-side role-gated. `unavailable ≠ 0` enforced by `MetricValue` + `<MetricValueCell>` across every new panel.
