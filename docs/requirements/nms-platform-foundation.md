# Requirement Specification — NMS Platform Foundation

**Work item:** `nms-platform-foundation`
**Mode:** dev
**Task-size class:** `standard` (human-approved 2026-08-09)
**Gate:** **G2 OPEN — design, plan, and ADRs approved by the human 2026-08-09.** Implementation may begin per `docs/plans/nms-platform-foundation-plan.md`.
**Author:** Jarvis (Product Manager / orchestrator)
**Date:** 2026-08-08 (revised 2026-08-09 with G1 resolutions)
**Source architecture reference:** `LibreNMS_Custom_UI_Architecture.md` (repo root)
**Status:** APPROVED at G1. Acceptance criteria (§9) and performance targets (§6.2) confirmed as written. Implementation still requires G2 (design + plan) approval.

### Revision log
| Date | Change |
|---|---|
| 2026-08-10 | **AIRNMS custom UI + BFF DEPLOYED LIVE (Phase-2 milestone).** Reachable at `https://10.121.77.206:8443/app` (custom UI), BFF at `/bff/*`, native LibreNMS unchanged at root behind oauth2-proxy (reached via Open Admin Portal). Routing ADDITIVE/non-destructive - the maker declined to re-root the native UI to avoid breaking the working SSO. Real Keycloak SSO login end-to-end verified; inventory shows the 5 live devices from real LibreNMS; dashboard shows real InfluxDB v2 metrics; **FR-24 proven on-screen against LIVE data - the withheld AF60 renders RSSI 'Not available', not 0** (screenshots in artifacts). BFF /ready all-green incl. the now-REAL idp probe. Security floor re-swept CLEAN (no secret in the 8 served JS chunks/HTML; cookie HttpOnly; storage empty; web-not->bff intact). A live metric-schema fix was needed (LibreNMS writes wireless-sensor/ports measurements keyed by hostname). suite 393 green. **OPEN - SECURITY-FLOOR DECISION FOR THE HUMAN (NFR-13/AC-F#33): CSP unsafe-inline vs Next.js 16 - reconciliation item 21.** |
| Date | Change |
|---|---|
| 2026-08-09 | **Deploy findings resolved.** F-2: TSDB switched from TimescaleDB to **InfluxDB v2** (LibreNMS-native; ADR 0009 accepted, ADR 0005 revised, OQ-3 re-answered). F-5/OQ-7 role→level **CLOSED**: `nms-engineer=10`, `nms-readonly=5`, unmapped/native-fallback=`1` (`nms-operator` maps per ADR 0003/0007 role table; admin=10). F-1 source-IP topology fix accepted as architect-owned. |
| 2026-08-10 | **AIRNMS native-UI rebrand COMPLETE end-to-end (config-only, FR-07 intact).** Text surfaces via `project_name`/`page_title_suffix` (`<title>`, sidebar, About, footer). Navbar LOGO via `title_image='images/custom/airnms_logo.png'` — the human's real 1536×1024 image auto-cropped + LANCZOS-resized to 340×64 (aspect-preserved, letterboxed), staged DURABLY via a quadlet `Volume=` bind-mount (`~/nms/branding/airnms_logo.png` → served `html/images/custom/`, `:Z` single-consumer) because `html/images` is baked into the image. Verified on the RENDERED navbar (authenticated): `<img src=".../images/custom/airnms_logo.png" alt="AIRNMS">`, drawn LibreNMS SVG glyph gone (0 `<svg>`, 0 brand-red on page), survived a container recreate (identical sha256 served). Transparency honest: dark background kept (source is a glow render, won't key clean) and blends into the dark navbar. No core/blade/template overwritten. Repo-tracked (uncommitted): `deploy/librenms-podman/config/airnms_logo.png` + the manifest bind-mount line + `30-branding.php`. Known-remaining "LibreNMS": favicon + deep docs/install strings (core-only, accepted). |
| 2026-08-10 | **Deployment COMPLETE, FR-58 5/5.** F-2 resolved (InfluxDB v2, 798 points, 14d bucket retention set before first start, TimescaleDB removed targeted). F-1 resolved (snmptrapd+syslogng on `Network=pasta:--map-gw`; real `172.16.10.22` → device_id 2; DB/Redis loopback-published, externally invisible). F-5 resolved (break-glass mysql admin FIRST, `nms` realm + 2 clients + 4 groups + oauth2-proxy, `auth_mechanism=sso` flipped LAST, one-step rollback; SSO login works). Two latent fixes under execution: LibreNMS reads top-level `influxdbv2.*` config keys; a `:Z`→`:z` SELinux fix on the 4-consumer `librenms-data` volume. FR-56 now tickable (FR-56a POC exception stands). |
| 2026-08-09 | **GATE POSTURE (human decision): amend-and-proceed, no re-gate.** The human explicitly accepted that the ADR-0009 datastore change (InfluxDB v2) is **approved under the existing G2 via direct decision** and does NOT require a fresh G2 gate. Rationale (Jarvis's, accepted by the human): every substantive choice — option (b), the role→level values, the F-1 topology approach — was made by the human directly, so no unapproved decision is being introduced; only the mechanics of decided ones. **The quality gate for this change is the FR-58 RE-RUN** (currently PARTIAL 4/5), which must reach 5/5 and close F-1 + F-2 before the deployment is considered complete. |
| Date | Change |
|---|---|
| 2026-08-08 | Initial draft written from the architecture reference. |
| 2026-08-09 | **G2 APPROVED.** Design + plan + 8 ADRs approved as revised. Remaining open questions resolved by the human: **OQ-3 TimescaleDB**; **OQ-11** top-2 P2P vendors (architect selects + justifies in ADR 0007); **OQ-21** TR-069 simulator-tolerance-only; **OQ-23** server `10.121.77.206`, SSH creds in gitignored repo-root `Credentials.md`; **OQ-24** Docker Compose; **OQ-25** Keycloak co-hosted (subject to a discovered-specs floor check); plus AUTH_MODE=dev-local, OQ-5 logout, OQ-7 role table, OQ-10 timeouts, OQ-12 flapping (≥3 transitions / 5 min), OQ-14 polling. **NFR-05 wording fixed** to the achievable reading. **DEPLOYMENT AUTHORIZED:** agents may SSH to the server and execute the deployment under explicit guardrails (see §5.8). |
| 2026-08-09 | **OQ-22 resolved:** LibreNMS runs on a **remote, human-provided server**, and its **installation on that server is IN SCOPE** as an explicit deployment work package. Added FR-54..58 (engine deployment + verification). Scope of the work item grew — the engine is now deployed by this project, not assumed pre-existing. |
| 2026-08-09 | **G1 approved.** OQ-1 resolved (Node/TypeScript + React/Next.js, option a); OQ-6 resolved (BFF security deviation approved); OQ-17 resolved (dummy SNMP + TR-069 pollers); performance targets, acceptance criteria, and `standard` class approved as written. New **OQ-21** (TR-069 support model) and **OQ-22** (LibreNMS runtime location) raised. `team-config.md` and all four overlays updated for the Node stack; the Maven open question was retired. |

---

## 0. Document purpose and standing

This repository is greenfield: at the time of writing it contains only `README.md` and the architecture reference. This specification is therefore the **founding requirement document** for the Network Management System (NMS). It converts the architecture reference into numbered, testable requirements so that a Technical Architect can produce a design and implementation plan (G2) against a fixed, human-approved scope.

Nothing in this document is a design decision. Where the architecture reference implies a technology choice, this document records it as a **constraint to be confirmed** or as an **open question**, not as a settled fact. Section 11 lists every question that must be answered by the human; several of them are blocking.

---

## 1. Problem statement

The organisation operates a mixed network estate — routers, switches, and point-to-point (P2P) microwave/wireless backhaul links — expected to exceed **5,000 managed devices** across distributed remote sites. It needs a Network Management System that provides device discovery, SNMP polling, syslog/trap ingestion, alarm processing, and metric retention.

Building that collection engine from scratch is unjustifiable: **LibreNMS** already provides mature, broadly-supported discovery, SNMP v1/v2c/v3 polling, trap/syslog handling, alert rule processing, and a distributed poller model. However, the LibreNMS **native user interface** is optimised for generalist administration, not for the day-to-day operational workflows of a NOC team watching P2P link health and core switch capacity. Its density, navigation model, and lack of purpose-built P2P RF views make routine operational tasks slower than they need to be.

The problem to solve is therefore **not** "build an NMS" but:

> Use LibreNMS as a headless collection and alerting engine, and put a purpose-built operational UI in front of it — without losing access to the native UI for administrative depth, and without forcing users to authenticate twice or maintain two sets of accounts.

Two consequences follow, and both are in scope:
1. A **custom operations UI** must exist, reading from LibreNMS's API and time-series store.
2. **Single sign-on** must span the custom UI and the native LibreNMS UI, so that moving between them is a click, not a login.

### 1.1 Why this is worth doing (value statement)

- **Mean time to detect / triage on P2P links falls.** RF degradation (falling SNR, RSSI drift, mod-rate flapping) is currently visible only by drilling into per-device graphs. A dedicated link matrix surfaces it at a glance.
- **One alarm console instead of several views.** Operators acknowledge from the same screen where they triage.
- **Administration is not re-implemented.** MIB definitions, threshold editing, and system config stay in the native UI. This removes a very large and permanently-growing scope from the custom build — the single biggest cost control in this architecture.
- **No duplicate identity administration.** Users, roles, and offboarding are managed once, at the IdP.

---

## 2. Goals and scope

### 2.1 Goals

| ID | Goal |
|---|---|
| G-1 | Deploy LibreNMS as the headless backend engine: discovery, SNMP polling, syslog/trap ingestion, alert rule evaluation, metric generation. |
| G-2 | Deliver a custom operations UI covering the P2P wireless, router, and switch monitoring workflows defined in FR-10 through FR-49. |
| G-3 | Retain the native LibreNMS UI, reachable from the custom UI, as the administrative surface. |
| G-4 | Unify authentication across both UIs behind one OIDC/OAuth2 Identity Provider, with role mapping driven from the IdP. |
| G-5 | Ensure the deployed architecture sustains >5,000 devices without operator-visible dashboard latency degradation (see NFR section). |
| G-6 | Keep LibreNMS upgradeable — customisations must not fork or patch LibreNMS core. |

G-6 deserves emphasis: it is a goal, not a nicety. Any design that requires editing LibreNMS core source to satisfy a requirement in this document should be treated as a design failure and escalated, because it converts every future LibreNMS security release into a merge exercise.

### 2.2 In scope

- **LibreNMS installation and deployment on the human-provided remote server** (see FR-54..58) — including MariaDB, RRDCached, Redis, the dispatcher/poller service, SNMP prerequisites, and firewall/port configuration. This is an explicit deliverable, not an assumed pre-existing environment (OQ-22, resolved 2026-08-09).
- LibreNMS deployment configuration (single node initially; distributed pollers as per phasing in §12).
- Time-series store integration — **TimescaleDB** (OQ-3 resolved 2026-08-09; ADR 0005 revision 2).
- Custom operations UI: dashboards, alarm console, device inventory, device detail, cross-UI navigation.
- An API gateway / backend-for-frontend (BFF) layer between the custom UI and LibreNMS.
- OIDC SSO integration for both the custom UI and LibreNMS native UI, including role/level mapping.
- Redis-backed caching for inventory/topology API responses.
- Real-time telemetry delivery to the browser.

### 2.3 Explicitly out of scope (this work item)

| ID | Out of scope | Rationale |
|---|---|---|
| OOS-1 | Re-implementing LibreNMS administration in the custom UI (MIB management, alert *rule authoring*, threshold editing, poller/system config, user CRUD). | Deliberate; native UI retains these. Note the distinction: alarm *acknowledgment* IS in scope (FR-30); alarm *rule authoring* is not. |
| OOS-2 | Network configuration **change** / provisioning (pushing config to devices), NetConf/Ansible-driven config management. | This is a monitoring system, not a configuration management system. |
| OOS-3 | Automated remediation / closed-loop actions triggered by alarms. | Future consideration; requires change-control design first. |
| OOS-4 | NetFlow / sFlow / IPFIX traffic analysis and deep packet inspection. | Separate data pipeline and storage profile. |
| OOS-5 | IPAM / DCIM (NetBox-style source-of-truth inventory management). | LibreNMS inventory is discovery-derived; authoritative IPAM is a separate system. |
| OOS-6 | Billing, capacity-planning forecasting, and customer-facing SLA reporting portals. | Not requested. |
| OOS-7 | Mobile native applications. Responsive web only (and see OQ-9 for how far responsive must go). | Scope control. |
| OOS-8 | Migration of historical metrics from any existing monitoring system. | No existing system named. |
| OOS-9 | Multi-tenancy with per-tenant data isolation. | Not requested; would materially change the authorization design, so it must be confirmed out (OQ-8). |
| OOS-10 | IdP (Keycloak) deployment and hardening as a product deliverable. | Treated as an existing/provided platform dependency — but see OQ-2, because if no IdP exists, standing one up is a prerequisite project. |

---

## 3. Users and personas

| Persona | Description | Primary surface | Needs |
|---|---|---|---|
| **NOC Operator** (primary) | Watches the estate on shift; first responder to alarms. | Custom UI | Fast situational awareness, alarm triage and acknowledgment, minimal clicks, no admin clutter. |
| **Network Engineer** | Investigates and resolves faults; capacity questions. | Custom UI + native UI | Historical graphs, per-interface detail, P2P RF trends, escalation context. |
| **NMS Administrator** | Owns the monitoring platform itself. | Native LibreNMS UI (primarily) | Device onboarding, MIBs, alert rules, thresholds, poller health. |
| **Identity Administrator** | Manages the IdP. | IdP console | Group/role definitions that map to NMS access levels. |
| **Read-only stakeholder** (e.g. management, adjacent teams) | Views dashboards, changes nothing. | Custom UI | Read-only dashboards; must not be able to acknowledge or mutate. |

---

## 4. User stories

- **US-1** As a NOC Operator, I want a single dashboard showing the health of every P2P link, so I can spot RF degradation before it becomes an outage.
- **US-2** As a NOC Operator, I want one alarm console across routers, switches, and P2P links, filterable by device type and severity, so I triage in one place.
- **US-3** As a NOC Operator, I want to acknowledge an alarm in one click and have that acknowledgment reflected in LibreNMS, so my colleagues and the native UI see the same state.
- **US-4** As a Network Engineer, I want the top-N interfaces by 95th-percentile bandwidth, so I can identify saturation candidates.
- **US-5** As a Network Engineer, I want a CPU/memory heatmap across core switches, so I can see resource pressure across the estate at once.
- **US-6** As a Network Engineer, I want to jump from the custom UI to the native LibreNMS UI for a device without logging in again, so deep-dives are frictionless.
- **US-7** As an NMS Administrator, I want to keep using the native LibreNMS UI for MIBs, rules, and thresholds, so I am not blocked by custom-UI feature gaps.
- **US-8** As any user, I want to log in once at the corporate IdP and reach both UIs, so I manage one credential.
- **US-9** As an Identity Administrator, I want NMS access levels driven by IdP group membership, so joiner/leaver processes work through existing identity governance.
- **US-10** As a NOC Operator, I want interface up/down/flapping state to update without manually refreshing, so the wall display stays current.
- **US-11** As a read-only stakeholder, I want dashboard access without any ability to change state, so I can observe safely.
- **US-12** As an NMS Administrator, I want the platform to survive a LibreNMS version upgrade without custom-code rework, so security patching is routine.

---

## 5. Functional requirements

Priority: **MUST** (MVP), **SHOULD** (target release), **COULD** (backlog). Requirements are grouped by area. Each has a verification note in §9.

### 5.1 Platform / backend engine (FR-01 – FR-09)

| ID | Priority | Requirement |
|---|---|---|
| FR-01 | MUST | LibreNMS SHALL be deployed and operated as the sole collection engine, performing device discovery, SNMP v1/v2c/v3 polling, and metric generation for all managed devices. |
| FR-02 | MUST | LibreNMS SHALL ingest syslog messages and SNMP traps from managed devices and make them queryable via its API/eventlog. |
| FR-03 | MUST | LibreNMS SHALL evaluate alert rules server-side and expose resulting alarms via its REST API. Alarm rule evaluation is never re-implemented in the custom UI. |
| FR-04 | MUST | LibreNMS SHALL write time-series metrics to a dedicated TSDB (InfluxDB or TimescaleDB — OQ-3) in addition to, or in place of, RRD (OQ-4). |
| FR-05 | MUST | Device configuration/inventory metadata SHALL be stored in the LibreNMS relational store (MariaDB) and treated as the inventory system of record for this platform. |
| FR-06 | SHOULD | LibreNMS SHALL run in distributed-poller mode with a Redis-backed work queue, allowing poller worker nodes to be added horizontally. |
| FR-07 | MUST | No requirement in this document SHALL be satisfied by modifying LibreNMS core source. Integration uses supported extension points only: REST API, config, TSDB output, and standard SSO mechanisms. |
| FR-08 | MUST | The LibreNMS REST API token(s) used by the platform SHALL be held exclusively server-side (gateway/BFF) and SHALL NEVER be transmitted to, or reachable by, a browser client. |
| FR-09 | SHOULD | Poller health and queue depth SHALL be observable (metrics/endpoint) so operators can detect polling falling behind. |

> **Note on FR-08.** The architecture reference's Nginx sample (§4.3) injects a **global** LibreNMS API token at the proxy for `/api/v0/`. As written, that endpoint is reachable by the browser and would let any authenticated — or, depending on proxy config, any unauthenticated — caller act with global API privileges. FR-08 and FR-25 exist to forbid that pattern. This was raised as **OQ-6** and **resolved at G1 on 2026-08-09: the BFF model is approved.** The browser never holds a LibreNMS token; the BFF authenticates the user, authorises the action, then calls LibreNMS server-side with a service token. The reference's Nginx snippet must not be implemented as written.

### 5.2 Authentication and SSO (FR-10 – FR-19)

| ID | Priority | Requirement |
|---|---|---|
| FR-10 | MUST | Both the custom UI and the LibreNMS native UI SHALL delegate authentication to a single external OIDC/OAuth2 Identity Provider (Keycloak or equivalent — OQ-2). No local password authentication in either UI for normal users. |
| FR-11 | MUST | The custom UI SHALL authenticate using the OIDC **Authorization Code flow with PKCE**. Implicit flow SHALL NOT be used. |
| FR-12 | MUST | Access tokens SHALL NOT be persisted in `localStorage` or `sessionStorage`. Tokens SHALL be held in memory and/or in `Secure`, `HttpOnly`, `SameSite` cookies issued by the platform's own backend. |
| FR-13 | MUST | The LibreNMS native UI SHALL be configured for SSO via its supported mechanism (Socialite/OIDC or the documented `sso` auth mechanism), configured through `config.php` / environment — not by patching core (per FR-07). |
| FR-14 | MUST | A user who has authenticated in one UI SHALL reach the other UI without re-entering credentials, for as long as the IdP session is valid. |
| FR-15 | MUST | IdP-asserted group/role claims SHALL map to platform authorization roles, and to LibreNMS user levels, by explicit configured mapping. The initial role set is: `nms-operator`, `nms-engineer`, `nms-admin`, `nms-readonly` (final names and LibreNMS level mapping per OQ-7). |
| FR-16 | MUST | Users SHALL be auto-provisioned in LibreNMS on first SSO login, with level derived from FR-15's mapping, and their level updated on subsequent logins when IdP claims change. |
| FR-17 | MUST | Token refresh SHALL occur silently before access-token expiry; on refresh failure the user SHALL be returned to the IdP login rather than shown a broken UI. |
| FR-18 | MUST | Logout SHALL terminate the local session and initiate IdP single logout (RP-initiated logout), so a logged-out user cannot resume by revisiting either UI. Behaviour of the LibreNMS session on logout must be explicitly verified (OQ-5). |
| FR-19 | SHOULD | Session inactivity timeout and absolute session lifetime SHALL be configurable and enforced (values per OQ-10). |

### 5.3 Custom UI — P2P wireless (FR-20 – FR-24)

| ID | Priority | Requirement |
|---|---|---|
| FR-20 | MUST | The UI SHALL present a **P2P Link Performance Matrix** listing every P2P link with, per link: both endpoints, link state, current SNR, current RSSI, and a visual severity indication against configured thresholds. |
| FR-21 | MUST | The matrix SHALL support sorting and filtering by link state and by SNR/RSSI severity, so the worst links surface first. |
| FR-22 | SHOULD | Selecting a link SHALL open a detail view with time-series charts for SNR, RSSI, and modulation rate over selectable ranges (at minimum 1h / 24h / 7d / 30d). |
| FR-23 | SHOULD | The link detail view SHALL show modulation-rate stability (e.g. mod-rate changes over the window) and frequency utilisation where the device exposes those OIDs. |
| FR-24 | MUST | Where a P2P metric is unavailable for a device (unsupported OID / vendor), the UI SHALL display an explicit "not available" state and SHALL NOT render it as zero or as healthy. |

> FR-24 is a correctness requirement, not a cosmetic one: rendering an unavailable RSSI as `0` on an RF dashboard is indistinguishable from a catastrophic link failure, and rendering it as healthy hides a real gap in monitoring coverage. **How P2P links are identified and paired is OQ-11 and is a blocking design input.**

### 5.4 Custom UI — routers and switches (FR-25 – FR-29)

| ID | Priority | Requirement |
|---|---|---|
| FR-25 | MUST | The UI SHALL present an infrastructure overview with per-interface state indicators distinguishing **Up**, **Down**, and **Flapping** (flapping = state changes exceeding a configured count within a configured window; parameters per OQ-12). |
| FR-26 | MUST | The UI SHALL present **Top-N interfaces by bandwidth**, computed on the **95th percentile** of throughput over a selectable window, with N configurable (default 10). |
| FR-27 | MUST | The UI SHALL present a **CPU and memory heatmap** across a selectable device group (default: core switches), colour-scaled against configured thresholds. |
| FR-28 | SHOULD | The 95th-percentile calculation method (in/out treated separately or combined; sample interval; window inclusivity) SHALL be documented in the UI (tooltip or help text) so engineers can reconcile figures with other tools. |
| FR-29 | SHOULD | Heatmap and Top-N views SHALL allow drill-through to the corresponding device or interface detail view. |

> FR-28 exists because 95th-percentile bandwidth is a figure people argue about and bill on. An undocumented percentile is an unusable percentile.

### 5.5 Custom UI — unified alarm console (FR-30 – FR-36)

| ID | Priority | Requirement |
|---|---|---|
| FR-30 | MUST | The UI SHALL present a unified alarm feed spanning all managed device types, sourced from LibreNMS. |
| FR-31 | MUST | The feed SHALL be filterable by device type (at minimum: Router, Switch, P2P/Microwave), by severity, and by acknowledgment state. |
| FR-32 | MUST | Each alarm SHALL display: device, affected entity (interface/sensor where applicable), severity, rule name/description, first-raised timestamp, duration, and acknowledgment state including who acknowledged it. |
| FR-33 | MUST | An authorised user SHALL be able to acknowledge an alarm from the console in one action; the acknowledgment SHALL be persisted **via the LibreNMS API** so that LibreNMS remains the single source of truth and the native UI reflects it. |
| FR-34 | MUST | Acknowledgment SHALL be permitted only for roles authorised to do so; `nms-readonly` SHALL be denied, and the denial SHALL be enforced **server-side** (hiding the button is insufficient). |
| FR-35 | MUST | If an acknowledgment call to LibreNMS fails, the UI SHALL surface the failure and SHALL NOT display the alarm as acknowledged. Optimistic UI state must be reverted on failure. |
| FR-36 | SHOULD | The alarm feed SHALL update without manual page refresh, within the latency target in NFR-05. |

### 5.6 Custom UI — inventory, device detail, navigation (FR-37 – FR-44)

| ID | Priority | Requirement |
|---|---|---|
| FR-37 | MUST | The UI SHALL provide a device inventory list with search and filtering by hostname, device type/role, site/location, and reachability state. |
| FR-38 | MUST | Inventory lists SHALL be paginated server-side; no view SHALL fetch an unbounded device or interface set. |
| FR-39 | MUST | A device detail view SHALL show identity/metadata, reachability, uptime, per-interface list with state and utilisation, and relevant health metrics. |
| FR-40 | MUST | A persistent **"Open Admin Portal"** action SHALL be present in the custom UI, navigating to the native LibreNMS UI without a credential prompt (per FR-14). |
| FR-41 | SHOULD | Where context permits, cross-navigation SHALL be **deep** — from a device in the custom UI to that same device's page in the native UI. |
| FR-42 | SHOULD | The "Open Admin Portal" action SHALL be presented only to roles with native-UI privileges, so operators are not sent to a portal that will reject them. |
| FR-43 | MUST | Every view that loads data SHALL implement explicit **loading**, **error**, and **empty** states. A view that silently renders blank on backend failure is a defect. |
| FR-44 | SHOULD | The UI SHALL indicate data freshness (e.g. "updated Xs ago") on real-time views, so a stalled stream is visibly stale rather than falsely current. |
| FR-44a | MUST | The **custom operations UI SHALL be branded "AirNMS"** — application title, header/logo, browser tab title, and login/landing text. The branding lives ENTIRELY in the custom Next.js UI (a Task-10 deliverable). |
| FR-44b | MUST | LibreNMS core, themes, and templates are **NEVER modified on the host** (FR-07 / goal G-6). **AMENDED 2026-08-10 (human request):** the native UI's visible *name* MAY be rebranded to "AIRNMS" using LibreNMS's OWN supported config keys only (`project_name`, `page_title_suffix` in the `~/nms/config/*.php` include) — this is configuration, not core modification, so it is FR-07-compliant. Applied and verified live: `<title>` reads `... | AIRNMS`, footer "Powered by AIRNMS", About page AIRNMS. **Explicitly NOT changed (core-only, remain "LibreNMS", accepted):** the drawn logo SVG glyph (needs a staged `title_image` asset — not config-only, and the human asked for name only) and deep help/docs/install strings. The "Open Admin Portal" jump (FR-40) still leads to the (now name-rebranded but otherwise stock) native UI. |

> FR-44 is the counterpart to FR-36: a dashboard that has silently stopped updating is more dangerous than one that is visibly down, because it is trusted.

> **On FR-44a/b (AirNMS brand):** the human asked to "remove the LibreNMS name and call it AirNMS." Clarified and accepted: the rebrand is a **custom-UI** concern only. Patching LibreNMS core/themes on the host to hide its name would violate FR-07 (never modify core) and break the upgrade path (G-6) — so the native admin surface stays stock LibreNMS, and "AirNMS" is the identity of the bespoke operations UI users spend their time in. This is a Task-10 requirement recorded now so it is not forgotten; nothing to build until the UI is scaffolded.

### 5.7 Real-time telemetry and data access (FR-45 – FR-49)

| ID | Priority | Requirement |
|---|---|---|
| FR-45 | MUST | Real-time updates (link state, alarms, key RF metrics) SHALL be delivered by a push mechanism (WebSocket or SSE — OQ-13) rather than aggressive client polling. |
| FR-46 | MUST | Dashboard time-series reads SHALL query the TSDB via the platform backend. The browser SHALL NOT hold TSDB credentials or connect to the TSDB directly. |
| FR-47 | MUST | All browser-to-platform data access SHALL pass through the platform's own API gateway/BFF, which enforces the caller's identity and role on every request. |
| FR-48 | SHOULD | Inventory and topology responses SHALL be cached (Redis) with an explicit, documented TTL, and the cache SHALL be invalidated or short-TTL'd such that operationally significant changes appear within the freshness target (NFR-06). |
| FR-49 | SHOULD | On loss of the real-time connection the UI SHALL reconnect automatically with backoff, and SHALL indicate degraded/disconnected state while reconnecting (supporting FR-44). |

> **On FR-46 vs the architecture reference.** The reference suggests the custom UI read "straight from InfluxDB". Read *path* directness is a good performance instinct, but it must terminate at the platform backend, not the browser — a browser holding TSDB credentials is an unauthenticated read of all metrics for everyone. FR-46 keeps the low-latency read while keeping the credential server-side. Confirmed by the same G1 decision on OQ-6.

### 5.8 LibreNMS engine deployment (FR-54 – FR-58)

Added 2026-08-09 following the OQ-22 resolution. The LibreNMS engine was previously treated as a pre-existing platform dependency; the human has confirmed it must be **installed by this project** on a server they provide, and must run together with the custom UI.

| ID | Priority | Requirement |
|---|---|---|
| FR-54 | MUST | LibreNMS SHALL be installed on the human-provided remote server, together with its required supporting services: **MariaDB**, **RRDCached**, **Redis**, the **dispatcher/poller service**, a web server/PHP-FPM stack, and SNMP prerequisites. |
| FR-55 | MUST | The installation SHALL follow an approved, documented, and **repeatable** method — either the official LibreNMS Docker Compose distribution or the official native install procedure (decision per OQ-24). Ad-hoc, undocumented manual setup is not acceptable, because an unreproducible engine cannot be recovered or upgraded. |
| FR-56 | MUST | Required network access SHALL be documented and configured: inbound HTTP/HTTPS for the native UI and API, **SNMP/UDP 161** outbound to managed devices, **UDP 162** inbound for traps, **UDP 514** inbound for syslog, and access from the BFF host to the LibreNMS API. Ports not required SHALL NOT be exposed. |
| FR-57 | MUST | The deployed engine SHALL be configured for SSO per FR-13, with the client secret injected at runtime and never committed (NFR-09). **Clarified by ADR 0008 Decision 3:** LibreNMS has **no OIDC auth module**, so this is satisfied by `auth_mechanism = sso` behind an **OIDC-authenticating reverse proxy** which is itself the OIDC client. The literal wording "`auth_mechanism` plus OIDC client parameters" is not implementable as written. |
| FR-58 | MUST | Deployment SHALL be verified before dependent work proceeds: LibreNMS reachable over HTTPS, its REST API answering authenticated calls (**and refusing unauthenticated ones**), at least one simulated device successfully discovered **and demonstrably polled** (advancing counters, not mere presence), and metrics landing in **TimescaleDB** (a recent-row count > 0 — OQ-3 resolved). `LIBRENMS_BASE_URL` for the BFF SHALL then point at this server. Verification also includes the negative tests in design §12.7, of which the **header-injection bypass test is Critical**. |

> **FR-56 CONFLICT — RESOLVED 2026-08-09. The human APPROVED the scoped exception (FR-56a). FR-56's text above remains UNCHANGED as the production requirement; FR-56a below carves out the POC host only.**
>
> **FR-56a (approved 2026-08-09) — POC scoped exception.** On the shared POC host `10.121.77.206`, where rootless Podman cannot bind privileged ports without root, the engine SHALL publish **UI/API on 8080/8443**, **SNMP traps on 1162/udp**, and **syslog on 1514/udp**. Trap and syslog ingestion is therefore verified **from project-controlled simulators only**; real network devices cannot reach these ports without a privileged redirect. **FR-56 (161/162/514) remains the requirement for any production or dedicated-host deployment and is NOT satisfied by the POC.** The human accepted simulator-only ingestion for this phase (decision 7, 2026-08-09).
>
> Task 0.1's reconnaissance of `10.121.77.206` found **no usable sudo**, so the deployment proceeds under the human's option-3 decision as a **rootless-Podman** install (ADR 0008 revision 3, plan Task 0.4c). Rootless containers **cannot bind ports below 1024** — Podman's official `rootless.md` states *"Podman can not create containers that bind to ports < 1024"* — and every workaround (kernel firewall redirect, `redir`, lowering `net.ipv4.ip_unprivileged_port_start`) **requires root we do not have and must not request**.
>
> **Consequence:** on that host, traps are received on **1162/udp** and syslog on **1514/udp**; the UI/API listen on **8080/8443** rather than 80/443. Outbound **SNMP/UDP 161 is unaffected** and the "ports not required SHALL NOT be exposed" clause is met more strictly than the approved design required (only four ports published; no datastore has a host listener).
>
> **What is genuinely not met:** real network devices send traps to **162** and syslog to **514** and generally cannot be reconfigured. So FR-56's trap/syslog clauses are verifiable **only against project-controlled simulators**, which can be pointed at the high ports. **FR-56 must NOT be marked satisfied on the strength of the Task 0.6 evidence.**
>
> **Recommended resolution for the human — keep FR-56 as approved (it is the correct production requirement) and add a scoped exception:**
>
> > **FR-56a (POC deployment exception, host `10.121.77.206`).** On the rootless-Podman POC deployment, the trap and syslog receivers bind **1162/udp** and **1514/udp** because rootless containers cannot bind ports below 1024 and no privileged redirect may be installed on that host. FR-56's 162/514 clauses are therefore **verified against project-controlled simulators only** and are **NOT satisfied for real network devices**. Satisfying FR-56 as written requires either (a) root on the deployment host to install a port redirect, (b) a privileged or dedicated host running plan branch 0.4a/0.4b, or (c) a device-side change to non-standard destination ports, which is generally unavailable. **Production deployment MUST satisfy FR-56 as originally worded.**
>
> **The real question for the human is a scope question, not a wording one:** is a POC that cannot receive traps from a real device sufficient for this phase? If the goal is to prove the UI/BFF/SSO architecture against a working collection engine, plausibly yes. If it is to prove ingestion from the live estate, no — and a privileged host is needed. Full analysis: plan §"POC limitations of the 0.4c rootless-Podman deployment".

> **DEPLOYMENT AUTHORIZATION (human decision, 2026-08-09).** The human has explicitly authorized agents to connect to the target server and execute the deployment: *"use the credentials to deploy the solution."* This **overrides** the earlier "human executes / team documents" framing in this section and in the plan's Tasks 0.4–0.6. Target host: **10.121.77.206**. SSH credentials live in the **gitignored repo-root `Credentials.md`**.
>
> Mandatory guardrails on that authorization:
> 1. **Credential hygiene (Critical).** Agents read `Credentials.md` solely to establish the connection. Its contents are NEVER copied into any doc, config, log, artifact, commit, handoff, status file, or terminal echo. Reference the **path only**. A leak here is a Critical finding under team-protocol §6.
> 2. **Evidence per step.** Every Task 0.x step records expected-vs-actual output as evidence under `.claude/team/artifacts/nms-platform-foundation/`, with credentials and secrets redacted.
> 3. **Stop before destruction.** Destructive or irreversible host actions — disk wipes, OS-level changes, removing or reconfiguring pre-existing services — STOP and confirm with the human first.
> 4. **Stop if the host is shared.** If the server turns out to host unrelated production services, STOP and report before installing anything.
> 5. **Facts before actions.** Server OS, Docker availability, CPU/RAM/disk, and sudo are still unknown; SSH fact-gathering is the first step (Task 0.1) and its findings gate the install path (Compose vs native) and the Keycloak co-host decision.
> 6. **Keycloak floor check.** Keycloak is co-hosted only if discovered specs exceed the ADR 0008 floor (4 vCPU / 8 GB); at or below it, flag back to the human before installing Keycloak.

> **Scope note.** This is a genuine scope increase relative to the G1-approved spec, which listed LibreNMS deployment as configuration only and treated the runtime as provided (former ASM/DEP framing). It adds a systems-administration work package — OS-level installation, service management, and firewall configuration on a host this team does not yet have details for. It also introduces a dependency ordering constraint: **FR-54..58 must complete before the BFF can be verified against a real LibreNMS API**, so it belongs in Phase 0.

> **Superseded sentence, retained for the record.** This scope note previously ended: *"Per team-protocol §5, no agent executes a deployment against a shared or protected environment — the human runs the install steps, or explicitly designates the server as a disposable/lab target."* That is **superseded by the DEPLOYMENT AUTHORIZATION block above**: the human authorized agent execution on `10.121.77.206` on 2026-08-09. The general team-protocol §5 posture is unchanged for every other environment. Design §12.1 and ADR 0008 revision 2 record the reasoning on both sides of the change.

---

## 6. Non-functional requirements

### 6.1 Scale and capacity

| ID | Priority | Requirement |
|---|---|---|
| NFR-01 | MUST | The architecture SHALL support **≥5,000 managed devices** without redesign, via horizontal poller scale-out. |
| NFR-02 | MUST | Polling SHALL complete within its interval at target scale — i.e. poller queue depth SHALL be stable (not monotonically growing) under sustained load. Target polling interval per OQ-14. |
| NFR-03 | SHOULD | Adding a poller worker node SHALL require no application code change — configuration and registration only. |

### 6.2 Performance

| ID | Priority | Requirement |
|---|---|---|
| NFR-04 | MUST | Primary dashboard views (P2P matrix, infrastructure overview, alarm console) SHALL render usable content within **≤3 s p95** on a warm cache at target scale. |
| NFR-05 | MUST | Real-time state changes (interface up/down, new alarm) SHALL appear in an open UI within **≤10 s p95 of LibreNMS *recording* the change** — i.e. measured from the moment the value is persisted by LibreNMS, NOT from the moment the physical change occurred on the device. **Clarified 2026-08-09 (human decision).** End-to-end latency as experienced by an operator is therefore this figure PLUS the polling interval (OQ-14), which is a property of SNMP polling and outside this requirement's control. Trap- and syslog-driven events are not subject to the polling delay and so will typically be faster. |
| NFR-06 | SHOULD | Cached inventory data SHALL be no more than **60 s** stale. |
| NFR-07 | SHOULD | Time-series chart queries (≤7-day window) SHALL return within **≤2 s p95**. |
| NFR-08 | SHOULD | The UI SHALL remain responsive with a 5,000-row inventory view, using server-side pagination and/or list virtualisation. |

*These targets are proposed by Jarvis as reasonable operational defaults; they are not derived from a stated SLA. The human should confirm or replace them (OQ-15) — they become the Tester's pass/fail thresholds.*

### 6.3 Security

| ID | Priority | Requirement |
|---|---|---|
| NFR-09 | MUST | No LibreNMS API token, TSDB credential, IdP client secret, or SNMP community string SHALL ever be delivered to a browser or committed to the repository. Secrets are injected at runtime from environment/secret store. |
| NFR-10 | MUST | All external traffic SHALL be HTTPS/TLS. HTTP SHALL redirect to HTTPS. HSTS SHALL be set with `max-age` ≥ 31536000. |
| NFR-11 | MUST | Authorization SHALL be enforced server-side on every API request. Client-side role checks are presentation only and SHALL NOT be the sole control (reinforces FR-34). |
| NFR-12 | MUST | Session cookies SHALL be `Secure`, `HttpOnly`, and `SameSite` (`Lax` or `Strict`; value per design). |
| NFR-13 | MUST | Security headers SHALL be set: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`. |
| NFR-14 | MUST | ID/access tokens SHALL be validated on the server: signature against IdP JWKS, `iss`, `aud`, and `exp`. Unvalidated token acceptance is a Critical defect. |
| NFR-15 | MUST | Logs SHALL NOT contain tokens, secrets, SNMP communities, `Authorization` header values, or PII. Redaction SHALL be applied at the logger layer. |
| NFR-16 | MUST | Every API endpoint SHALL declare its auth requirement explicitly; there SHALL be no implicitly public data endpoint. |
| NFR-17 | SHOULD | Rate limiting SHALL be applied to authentication callbacks and to write operations (e.g. acknowledgment). |
| NFR-18 | SHOULD | Acknowledgments and other state-changing actions SHALL be audit-logged with actor identity, target, and timestamp. |
| NFR-19 | SHOULD | CORS SHALL be restricted to known origins; wildcard origin with credentials SHALL NOT be used. |

### 6.4 Availability and operability

| ID | Priority | Requirement |
|---|---|---|
| NFR-20 | MUST | Custom UI unavailability SHALL NOT stop collection, alerting, or notification — the LibreNMS engine is independent of the presentation layer. |
| NFR-21 | MUST | Each deployable service SHALL expose `/health` (liveness, no dependency calls) and `/ready` (readiness, dependency-aware) endpoints. |
| NFR-22 | MUST | If LibreNMS API or the TSDB is unavailable, affected views SHALL degrade explicitly with an error state (per FR-43), never with fabricated, cached-as-live, or zero-valued data. |
| NFR-23 | SHOULD | Services SHALL emit structured JSON logs including a correlation ID propagated across the gateway → LibreNMS/TSDB call chain. |
| NFR-24 | SHOULD | Platform metrics (request rate, error rate, latency percentiles) SHALL be exposed in Prometheus format. |
| NFR-25 | SHOULD | Availability target for the monitoring platform SHALL be defined and met (proposed 99.5% for the UI tier; confirm via OQ-15). |
| NFR-26 | COULD | Component redundancy (multiple gateway instances, DB replication, TSDB HA) — scope per phasing (§12) and OQ-16. |

### 6.5 Maintainability and quality

| ID | Priority | Requirement |
|---|---|---|
| NFR-27 | MUST | LibreNMS SHALL remain upgradeable through its documented upgrade path; no core patches (enforces FR-07/G-6). |
| NFR-28 | MUST | Automated tests SHALL cover new code to the project standard (≥80% line coverage on new code) with authorization and error paths explicitly tested. |
| NFR-29 | MUST | Configuration SHALL come from environment/config files with startup validation — fail fast on missing or invalid config rather than failing per-request later. |
| NFR-30 | SHOULD | Accessibility baseline WCAG 2.1 AA for the custom UI, including keyboard operability and non-colour-only severity encoding. |

> NFR-30's last clause matters more here than in a typical app: this UI encodes severity as colour on a heatmap and an RF matrix. Colour-only severity excludes colour-blind operators from the primary signal of the product. Shape, icon, or text must accompany colour.

---

## 7. External dependencies and assumptions

### 7.1 Dependencies (must exist or be provided)

| ID | Dependency | Notes |
|---|---|---|
| DEP-1 | OIDC Identity Provider (Keycloak or equivalent) with admin access to register two clients and define groups/roles. | Blocking for all SSO requirements. OQ-2. |
| DEP-2 | LibreNMS-supported host(s) with SNMP reachability to managed devices. | |
| DEP-3 | MariaDB for LibreNMS. | |
| DEP-4 | Redis (poller queue + API cache). | |
| DEP-5 | TSDB — InfluxDB or TimescaleDB. | OQ-3. |
| DEP-6 | TLS certificates for all public hostnames. | |
| DEP-7 | DNS names for custom UI, native UI path/host, and IdP; shared parent domain if cookie sharing is used. | |
| DEP-8 | SNMP credentials/communities for managed devices. | |
| DEP-9 | **Device simulators ("dummy pollers") speaking SNMP and TR-069** for verification. | **OQ-17 RESOLVED 2026-08-09** — see §10.1. Building/configuring these simulators is a design deliverable. |
| DEP-10 | A **remote server provided by the human**, on which this project installs LibreNMS (FR-54..58). | **OQ-22 RESOLVED 2026-08-09** — remote host, human-provided; installation is in scope. Access details are still an input needed: see OQ-23. |

### 7.2 Assumptions (to be confirmed — an incorrect assumption here is a scope change)

| ID | Assumption |
|---|---|
| ASM-1 | LibreNMS's REST API exposes everything the custom UI needs for the FRs above; any gap is filled by TSDB reads, not by LibreNMS core changes. **ASM-1 VERIFIED BY EXECUTION 2026-08-11 (Task 6, live LibreNMS 25.7.0) — confirmed with material caveats:** every endpoint EXISTS and carries the needed fields, BUT the devices/alerts **list** endpoints do NOT paginate or filter server-side (LibreNMS `list_devices` ignores `limit`/`offset`; `count` = array length, not a grand total; `type`/`location` filters ignored) — the opposite of the BFF's assumption. **Fixed in the BFF** (`windowPage()` — window + true total in the BFF, POC-scale bounded; >5,000 (NFR-01) needs a server-side cursor on a dedicated host, flagged). The **log** endpoints (`/logs/eventlog`, sibling of alertlog) DO paginate server-side (`limit`/`start`) and carry a `username` actor field → acknowledger-identity (FR-32) satisfiable. Ports: per-device `/ports` empty for sim devices; global `/ports?columns=…&device_id` works. Same "documented vs live API differ" class as the InfluxDB hostname-keying finding. |
| ASM-2 | Managed P2P radios expose SNR/RSSI/mod-rate via SNMP OIDs supported by existing LibreNMS device definitions (vendor list per OQ-11). |
| ASM-3 | A single IdP realm serves all NMS users; no federation across multiple IdPs. |
| ASM-4 | Single tenant / single organisation (see OOS-9, OQ-8). |
| ASM-5 | Users access the platform from a managed corporate network or VPN; the platform is not exposed to the public internet. Confirm — this materially affects the security posture required. |
| ASM-6 | English-only UI; no i18n requirement. |
| ASM-7 | Modern evergreen browsers only. |
| ASM-8 | The custom UI is the operational surface; native-UI usability is not a project concern beyond reachability and SSO. |

---

## 8. Constraints

| ID | Constraint |
|---|---|
| CON-1 | LibreNMS is a fixed platform choice (human-stated). Alternatives are not to be re-litigated. |
| CON-2 | LibreNMS core is not to be modified (FR-07). |
| CON-3 | **RESOLVED 2026-08-09.** The stack is **TypeScript/Node**: custom UI in React/**Next.js**, API gateway/BFF in **Node/TypeScript**; LibreNMS remains **PHP/Laravel**, deployed as-is. The system is polyglot by construction. The init-time Java/Maven toolchain assumption is **retired** — `team-config.md` §7 and all four overlays were updated accordingly, and the "Maven not installed" open question was withdrawn. Verified on this machine: Node v24.16.0, npm 11.13.0. |
| CON-4 | Commit policy is `manual`: agents never commit or push (team-config §3). |
| CON-5 | Protected branch `main`; work proceeds on `feature/<ticket-id>-short-description`. |
| CON-6 | The global-API-token proxy pattern in the architecture reference §4.3 is **prohibited** by FR-08/NFR-09. **RESOLVED 2026-08-09:** replaced by a **BFF** that authenticates the user, authorises the action, and calls LibreNMS server-side with a service-held token. An approved, deliberate deviation from the architecture reference. |
| CON-7 | Verification uses **simulated devices** (dummy pollers over SNMP and TR-069), not production hardware — see §10.1. |

---

## 9. Acceptance criteria

Per team-protocol §2, G1 does not open until the human confirms these as observable pass/fail checks. Each is stated as **precondition/input → expected observable result**. `[human-judged]` marks criteria that are inherently subjective and therefore recorded as not agent-verifiable — no agent should invent a mechanical check for them.

### AC-A — SSO and identity

1. Given an unauthenticated user opens the custom UI → they are redirected to the IdP; the authorization request uses `response_type=code` **and** includes `code_challenge`/`code_challenge_method=S256`.
2. Given valid IdP credentials → the user lands authenticated in the custom UI, and no access token or refresh token is present in `localStorage` or `sessionStorage`.
3. Given an authenticated custom-UI session → clicking "Open Admin Portal" reaches the native LibreNMS UI **without** any credential prompt, authenticated as the same identity.
4. Given a first-time SSO user in an IdP group mapped to operator → a corresponding LibreNMS user exists after login, at the mapped level.
5. Given a user whose IdP group changes from operator to admin → after next login their LibreNMS level reflects the new mapping.
6. Given an API request carrying a token with an invalid signature, wrong `aud`, wrong `iss`, or past `exp` → the gateway returns 401 and serves no data (four separate checks).
7. Given a logged-out user → revisiting both the custom UI and the native UI requires re-authentication.
8. Given a `nms-readonly` user → an acknowledgment API request crafted directly against the gateway (bypassing the UI) returns 403 and the alarm remains unacknowledged.

### AC-B — P2P wireless

9. Given P2P links exist with current data → the matrix lists every such link with both endpoints, state, SNR, and RSSI values matching the values in LibreNMS/TSDB for the same timestamp.
10. Given links with differing SNR relative to thresholds → sorting/filtering by severity places the worst link first, and severity is conveyed by a non-colour cue in addition to colour.
11. Given a device that does not expose an RSSI OID → the UI shows an explicit "not available" indicator, and shows neither `0` nor a healthy state.
12. Given a link with historical data → the detail view renders SNR, RSSI, and mod-rate charts for 1h/24h/7d/30d ranges without error.

### AC-C — Routers and switches

13. Given an interface currently up / currently down → the overview shows Up / Down respectively (two checks).
14. Given an interface whose state changed more than the configured count within the configured window → it is shown as **Flapping** rather than merely Up or Down.
15. Given interface throughput history → the Top-N list ranks interfaces by 95th-percentile throughput, and the displayed value matches an independent 95th-percentile calculation over the same raw samples within a stated tolerance.
16. Given N configured to a value other than 10 → exactly that many rows are returned.
17. Given the Top-N view → the percentile method (direction handling, sample interval, window) is discoverable in the UI.
18. Given CPU/memory data for the selected group → the heatmap renders one cell per device with colour and non-colour encoding consistent with configured thresholds.
19. Given a heatmap or Top-N entry → activating it navigates to that device's/interface's detail view.

### AC-D — Alarm console

20. Given active alarms across routers, switches, and P2P devices → all appear in one feed with device, entity, severity, rule, first-raised time, duration, and acknowledgment state populated.
21. Given filters applied by device type, then severity, then acknowledgment state → the result set matches the filter in each case (three checks).
22. Given an authorised user acknowledges an alarm → the LibreNMS API records the acknowledgment, and the native LibreNMS UI shows it acknowledged by that user.
23. Given the LibreNMS API returns an error on acknowledgment → the UI surfaces an error and the alarm remains displayed as unacknowledged.
24. Given a new alarm is raised in LibreNMS while the console is open → it appears without manual refresh within the NFR-05 target.

### AC-E — Inventory, navigation, resilience

25. Given a populated inventory → search by hostname fragment and filters by type, site, and reachability each return the correct subset (four checks).
26. Given an inventory larger than one page → responses are server-side paginated and include pagination metadata; no response returns the unbounded set.
27. Given a device detail view → identity, reachability, uptime, and per-interface state/utilisation are present and consistent with LibreNMS.
28. Given the LibreNMS API is stopped → dependent views show an explicit error state (no blank view, no zeroed data), and `/ready` reports not-ready while `/health` still reports live.
29. Given the real-time connection is severed → the UI indicates disconnected/stale state and reconnects automatically when service returns.
30. Given the custom UI and gateway are stopped entirely → LibreNMS continues polling and alerting, verifiable in the native UI (proves NFR-20).

### AC-F — Security and scale

31. Given the full frontend bundle and all browser-observable network traffic → no LibreNMS API token, TSDB credential, or client secret appears anywhere (static and dynamic inspection).
32. Given a request to any documented data endpoint without authentication → 401, with no data returned (enumerated across endpoints).
33. Given an HTTPS response from the platform → HSTS, CSP, `X-Content-Type-Options`, frame-ancestors/`X-Frame-Options`, `Referrer-Policy` are present; session cookies carry `Secure`, `HttpOnly`, `SameSite`.
34. Given platform logs after an authenticated session including an acknowledgment → no token, secret, community string, or `Authorization` value appears; the acknowledgment is audit-logged with actor and target.
35. Given a load representative of target scale (per the design's documented test method) → dashboard p95 render meets NFR-04 and poller queue depth remains stable per NFR-02.
36. `[human-judged]` The operational usefulness of the P2P matrix, heatmap, and alarm console for real NOC shift work — assessed by the human/NOC representative, not agent-verified.
37. `[human-judged]` Visual design, density, and information hierarchy of the custom UI.

*Criterion 35 (scale) was **RE-SCOPED at G2.7 on 2026-08-09 (human decision) to POC scale — tens of devices**, not the >5,000-device NFR-01 target. Reason: the POC deploys to a shared host under rootless Podman with no sudo and a 35 GB disk budget (see §5.8 and ADR 0008 rev 3), which cannot represent target scale. **NFR-01/NFR-02 remain requirements** and must be verified on a dedicated, appropriately-sized host in a later phase; they are NOT satisfied by this POC. Criteria AC-F#36 and #37 remain human-judged.*

---

## 10. Verification approach (informative)

To be detailed by the Tester at G2.7; recorded here so acceptance criteria are known-verifiable at G1:

- **SSO/authz:** browser-driven login flows plus direct API calls with crafted/absent/expired tokens. Negative authorization tests are mandatory, not optional.
- **Data correctness:** compare custom-UI values against LibreNMS API/native UI and against raw TSDB queries for the same timestamp; recompute the 95th percentile independently.
- **Real-time:** induce a state change (lab interface down, synthetic alarm) and measure time-to-appearance.
- **Degradation:** stop LibreNMS API / TSDB / real-time channel individually and assert explicit error and stale states.
- **Security:** bundle and traffic inspection for secrets; header and cookie assertions; log inspection; secret scanning in CI.
- **Scale:** representative simulated device population with queue-depth and latency measurement.

### 10.1 Test environment — simulated devices (OQ-17, RESOLVED 2026-08-09)

Verification does **not** use production hardware. The project instead builds **dummy pollers / device simulators** that present themselves to the platform as managed devices over:

- **SNMP** — the primary, native LibreNMS collection protocol. Simulated agents expose the OIDs the functional requirements need: interface state and counters (FR-25, FR-26), CPU/memory (FR-27), and P2P RF metrics — SNR, RSSI, mod-rate (FR-20..23). Simulators must also be able to **withhold** an OID on demand, because FR-24 and AC-B#11 require verifying the "not available" path — a simulator that always answers cannot test that requirement.
- **TR-069 (CWMP)** — see the scope flag below.

Requirements on the simulation harness:

| ID | Priority | Requirement |
|---|---|---|
| FR-50 | MUST | A device simulation harness SHALL present simulated routers, switches, and P2P radios to the platform over SNMP, with controllable metric values. |
| FR-51 | MUST | The harness SHALL support inducing state changes on demand — interface up/down, flap sequences (FR-25/AC-C#14), and RF degradation — so real-time and alarm paths (AC-D#24, NFR-05) are verifiable. |
| FR-52 | MUST | The harness SHALL support omitting selected OIDs so the "metric not available" path (FR-24) is verifiable. |
| FR-53 | SHOULD | The harness SHALL scale to a device count sufficient to exercise the NFR-01/NFR-02/NFR-04 targets (order 5,000 simulated devices), or acceptance criterion AC-F#35 must be explicitly re-scoped. |

> **TR-069 — SCOPE FLAG for the Technical Architect (OQ-21).** TR-069/CWMP is a **new protocol dimension not present in the architecture reference**, which is SNMP-centric throughout. LibreNMS does not natively collect via TR-069: it is an ACS (Auto Configuration Server) protocol, typically used for CPE management, with a fundamentally different interaction model — device-initiated sessions, an ACS endpoint, and parameter models rather than OIDs. Supporting it plausibly requires **an additional component**: a separate ACS, or an adapter terminating CWMP and feeding LibreNMS or the TSDB.
>
> This document does **not** silently absorb that as in-scope work. The Technical Architect must state, in the G2 design, which of these the project is doing:
> **(a)** TR-069 simulators exist only to prove the platform tolerates/ignores non-SNMP devices (smallest scope);
> **(b)** an ACS/adapter component is added to ingest TR-069 data — a material scope increase needing its own requirements and a human decision;
> **(c)** TR-069 is deferred entirely to a later phase.
> Whichever is chosen comes back to the human through Jarvis as a scope decision, not an implementation detail.

---

## 11. Open questions

### 11.0 Resolved at G1 (2026-08-09)

- **OQ-1 — Stack contradiction. RESOLVED: option (a).** Custom UI and gateway/BFF are **Node/TypeScript with React/Next.js**; LibreNMS stays PHP and is used as-is. The Java/Maven facts in `team-config.md` and all four overlays are replaced with Node facts (Node v24.16.0 — verified; npm 11.13.0 — verified; `build`/`test`/`lint`/`typecheck` script names marked `verified: no` pending the scaffold). The "Maven not installed" open question is **retired**. See CON-3.
- **OQ-6 — API access model. RESOLVED: BFF approved.** No global LibreNMS API token and no TSDB credential is browser-reachable. See CON-6, FR-08, FR-46, NFR-09.
- **OQ-17 — Test environment. RESOLVED: dummy pollers.** Simulated devices over SNMP and TR-069; see §10.1 and FR-50..53. Raised **OQ-21** (TR-069 support model) as a consequence.
- **Performance targets, acceptance criteria, and `standard` task class — APPROVED as written** (§6.2, §9).

**Still blocking G2 (design cannot responsibly proceed without these):**

- **OQ-2 — IdP.** Does an OIDC IdP already exist (Keycloak? Okta? Entra ID?) with admin access to register clients and define groups — or must one be stood up? If the latter, that is a prerequisite project affecting all SSO requirements and the MVP timeline.
- **OQ-3 — TSDB choice.** InfluxDB or TimescaleDB? (Influx is the better-trodden LibreNMS path; Timescale keeps you in PostgreSQL/SQL.) Any existing organisational standard?
- **OQ-11 — P2P link modelling.** How are P2P links identified and paired into "links" (two devices, one logical link)? Which radio vendors/models (Cambium, Ubiquiti, Mimosa, Ceragon, Aviat, other)? Is there an existing naming/tagging convention, or must link pairing be inferred or manually configured? Everything in §5.3 depends on this answer.
- **OQ-21 — TR-069 support model (NEW, raised by the OQ-17 resolution).** Is TR-069 (a) simulator-only tolerance testing, (b) a real ingestion path requiring an ACS/adapter component, or (c) deferred? See the scope flag in §10.1. **A scope decision, not an implementation detail** — the Architect proposes, the human decides.

**Blocking G2.7 / verification (needed before the test plan):**

- **OQ-15 — Performance targets. RESOLVED 2026-08-09: NFR-04..08 approved as written** (≤3 s p95 dashboards, ≤10 s p95 real-time, ≥5,000 devices). NFR-25's availability figure (99.5% UI tier) remains a Jarvis proposal — confirm if a formal SLA is required.
- **OQ-12 — Flapping definition.** What state-change count within what window constitutes "flapping"? (Proposal: ≥3 transitions in 5 minutes.)
- **OQ-14 — Polling interval.** Standard interval target (LibreNMS default 5 min) and whether P2P RF metrics need a faster interval — which materially affects poller sizing and the real-time story.
- **Pre-existing (team-config §7) — run/health-check.** Local run command / dev-server deploy plus health-check URL and expected response. Still open; must be settled during this feature's design.
- **Pre-existing (team-config §7) — artifact collection.** Log paths, screenshot tooling, report locations for tester evidence. Needed before G2.7.
- **OQ-22 — LibreNMS runtime location. RESOLVED 2026-08-09: a remote server the human will provide**, and **installing LibreNMS on it is in scope** for this work item (FR-54..58, §5.8). PHP not being installed locally is therefore moot for the engine — but the developer still needs the remote API reachable to build the BFF against, which makes FR-58 a Phase 0 gating step. *(The pre-existing "Maven not installed" question is retired — Maven is not part of this project.)*
- **OQ-23 — RESOLVED 2026-08-09 (partly by decision, partly by delegation to runtime discovery).** Host is `10.121.77.206`; access is SSH with credentials in the gitignored repo-root `Credentials.md`; **deployment is authorized for agents** under the §5.8 guardrails. The remaining facts (OS, Docker availability, CPU/RAM/disk, sudo, shared-ness) were **not human-answerable** and are **discovered** by plan Task 0.1, which gates the install path. Original text: Server access details (NEW, blocking FR-54..58). Needed from the human before the deployment package can be planned in detail, let alone executed: **hostname/IP**, **OS and version**, **access method** (SSH key? jump host? VPN?), **whether Docker/Compose is permitted** on the host, available **CPU/RAM/disk**, whether the team has **root/sudo**, and whether the host is shared with anything else. Also: is this server treated as a **lab/disposable target** or a **protected environment**? That distinction decides whether any agent may connect at all (team-protocol §5) or whether the human executes every step.
- **OQ-24 — RESOLVED 2026-08-09: Docker Compose.** Original text: Install method. Official **Docker Compose** distribution or **native** install per the LibreNMS official docs? Compose is faster to stand up and to reproduce; native gives finer control and is the more common production path. Depends on OQ-23's Docker answer. Recommend Compose if Docker is permitted.
- **OQ-25 — RESOLVED 2026-08-09: co-host Keycloak**, subject to the ADR 0008 floor check (>4 vCPU / >8 GB; at or below, STOP and flag). Original text: Co-hosting Keycloak (relates to OQ-2). If we are installing LibreNMS on the human's server anyway, standing up **Keycloak on the same server** may be the natural resolution to OQ-2 rather than waiting on a corporate IdP. Jarvis's recommendation: co-host Keycloak for the POC, on the explicit understanding that a POC-grade IdP is **not** a production identity solution and would be replaced by the corporate IdP later. Confirm — this affects the SSO work package and whether OQ-2 remains blocking.

**Non-blocking (needed before the affected requirement is built):**

- **OQ-4 — RRD retention.** Keep RRD alongside the TSDB, or TSDB only? Affects storage sizing and native-UI graph behaviour.
- **OQ-5 — Logout semantics.** On logout, must the LibreNMS session be terminated too (full single logout), or is IdP-session termination sufficient? Affects FR-18 and AC-A#7.
- **OQ-7 — Role mapping.** Confirm the four proposed roles and their exact LibreNMS level mapping (LibreNMS levels: 1 normal, 5/10 admin). Specifically: should `nms-engineer` have native-UI access?
- **OQ-8 — Multi-tenancy.** Confirm single-tenant (OOS-9). If per-site or per-customer data isolation is ever needed, it must be designed now, not retrofitted.
- **OQ-9 — Responsive scope.** Must dashboards be usable on tablet/phone, or is this desktop/NOC-wall only? Affects UI effort noticeably.
- **OQ-10 — Session timeouts.** Inactivity and absolute session lifetimes.
- **OQ-13 — Push transport.** WebSocket or SSE? (SSE is simpler for one-way telemetry; WebSocket is more flexible. Recommendation: SSE unless bidirectional need emerges.)
- **OQ-16 — HA scope.** Is component redundancy in scope now, or deferred to a later phase?
- **OQ-18 — Deployment target.** Docker Compose, Kubernetes, or VMs? Affects NFR-21 probe design and the release story.
- **OQ-19 — Notification channels.** Are LibreNMS alert *transports* (email/Slack/Teams/webhook) in scope for configuration in this work item, or purely native-UI administration (currently implied by OOS-1)?
- **OQ-20 — Ticket ID.** Is there a Jira/ticket ID for branch naming per CON-5? None supplied.

---

## 12. Suggested phasing (informative, for the human's consideration)

Not a commitment — a proposal to keep the MVP achievable. The human may reject or restructure this at G1.

**Phase 0 — Foundation (prerequisite).**
OQ-1, OQ-6, OQ-17, and OQ-22 are resolved. Remaining prerequisites: OQ-2 (IdP), OQ-3 (TSDB), OQ-11 (P2P pairing), OQ-21 (TR-069), and the new OQ-23/24/25 (server access, install method, Keycloak co-hosting). **Phase 0 now carries the LibreNMS deployment work package (FR-54..58) as its first gating step** — the BFF cannot be verified against a real API until FR-58 passes. Stand up LibreNMS + MariaDB + Redis + TSDB, polling a small simulated device set. Scaffold the Node/TypeScript project (UI + BFF) and fix the `build`/`test`/`lint`/`typecheck` script names so the overlays can be marked verified. Register IdP clients. Deliverable: LibreNMS collecting from simulators, IdP reachable, toolchain scaffolded and commands verified.

**Phase 1 — MVP: SSO + alarm console + inventory.**
FR-10..19, FR-30..35, FR-37..40, FR-43, FR-46..47, plus NFR-09..16, NFR-20..22. Delivers the highest-value slice: one login, one alarm console with working acknowledgment, device inventory, and the admin-portal jump. Acceptance: AC-A, AC-D, AC-E (partial), AC-F#31..34.

**Phase 2 — Operational dashboards.**
FR-20..21, FR-24..27, FR-29, FR-36, FR-44..45, FR-49. Adds the P2P matrix, interface states, Top-N 95th-percentile, heatmap, and real-time push. Acceptance: AC-B (partial), AC-C, AC-D#24, AC-E#29.

**Phase 3 — Depth and scale-out.**
FR-22..23, FR-28, FR-41..42, FR-48, distributed pollers (FR-06, FR-09), NFR-01..08 verification at scale, NFR-23..26, NFR-30. Acceptance: AC-B#12, AC-C#17, AC-F#35.

Rationale for putting SSO in Phase 1 rather than deferring it: SSO is the requirement most likely to force structural rework if retrofitted, because it determines how every API call is authenticated and authorised. Building dashboards against a temporary auth shim and converting later would mean rewriting the entire data-access path.

---

## 13. Kickoff record

G1 is approved and the toolchain is now known, so kickoff proceeds. The Technical Architect is dispatched first (design + implementation plan toward G2); Developer, Code Reviewer, and Tester are briefed against the approved design rather than an unknown stack, per the dev-mode pipeline.

| Member | Briefed | Concerns | Estimate |
|---|---|---|---|
| technical-architect | 2026-08-09 — design + plan + 7 ADRs delivered; revision in progress for the FR-54..58 deployment package | ASM-1 verified by design not execution (no live LibreNMS at design time); 3 ASM-1 gaps with non-core fallbacks (link pairing has no LibreNMS source, flapping is BFF-computed not a LibreNMS state, 95th percentile is a TSDB read); NFR-05 wording ambiguous (from LibreNMS *recording* vs change *occurring* — differs greatly at a 5-min poll); OQ-11 is the highest-value blocker since the P2P matrix is the project's justification; FR-53's 5,000 simulated devices on one dev machine is unproven | Phase 0+1 ≈ 21–30 working days (4–6 weeks), one developer; +3–5 days critical path if no IdP exists. Confidence moderate for Phase 0, lower for the SSO item. Deployment package (FR-54..58) will add to this — revised figure pending. |
| developer | pending G2 approval | — | — |
| code-reviewer | on-demand at G2.5 | — | — |
| tester | pending G2.5 (test plan at G2.7) | — | — |

---

## 14. Sign-off

| Gate | Status | Approver | Date |
|---|---|---|---|
| G1 Requirement | **APPROVED** — acceptance criteria confirmed as written, class `standard`, blockers OQ-1/OQ-6/OQ-17 answered | Human | 2026-08-09 |
| G2 Plan | **APPROVED** — design, implementation plan, and ADRs 0001–0008 approved as revised; deployment authorized with guardrails | Human | 2026-08-09 |
| G2.5 Implementation review | **PASSED** — static review loop closed at iteration 3 with ZERO findings (20 reviewer findings + 1 maker-found, all fixed at class level). Human go-ahead granted; `@babel/parser@7.29.8` devDep APPROVED; `concurrently` removal deferred to plan reconciliation | Human | 2026-08-09 |
| G2.7 Test plan | **APPROVED** as drafted. Three sub-questions defaulted to the Tester's recommendations: AC-F#35 re-scoped to POC scale; no standing-red ESLint case (pending Architect decision); transitive laundering remains a documented limitation pending plan-reconciliation item 10 | Human | 2026-08-09 |
| G3 Quality | **APPROVED by the human 2026-08-09** at `e97dfd3`. Test loop closed at iteration 6 (runs 1–4): 58 pass / 0 fail / 1 blocked (G-10, on Task 10). 5 findings raised across runs 1–3, all closed by observation on wider axes; run-4 clean. | Human | 2026-08-09 |
| Deployment (FR-54..58) | **COMPLETE 2026-08-10 — FR-58 = 5/5.** Stack LIVE on `10.121.77.206`, 12 rootless containers, no sudo, co-tenancy clean. All five checks PASS: HTTPS, authenticated REST API, simulated device discovered+polled, **InfluxDB v2 bucket read 798 points** (F-2 resolved), **traps/syslog attributed to real source IP `172.16.10.22` → device_id 2** (F-1 resolved). SSO active via Keycloak (F-5 resolved, break-glass admin retained). **FR-56 is now tickable** for the POC (FR-56a POC exception unchanged: unprivileged ports 8443/1162/1514). | Human | 2026-08-10 |
| G4 Release (code branch) | Pending — G4 package prepared at `.claude/team/artifacts/nms-platform-foundation/G4-PACKAGE.md`; awaits the human's review and their own commit (policy `manual`). Independent of the deployment findings. | Human | — |

**All G2-blocking open questions are RESOLVED** as of 2026-08-09 (see the revision log). Remaining non-blocking items, to be settled during implementation: the artifact-collection question in `team-config.md` (needed before G2.7), NFR-25's availability figure (no formal SLA stated), and the still-unknown server facts that Task 0.1 will discover (OS, Docker availability, CPU/RAM/disk, sudo). OQ-2 is answered by co-hosting Keycloak (OQ-25) subject to the ADR 0008 resource floor check. The Technical Architect must surface any of these that block its design rather than assuming an answer.
