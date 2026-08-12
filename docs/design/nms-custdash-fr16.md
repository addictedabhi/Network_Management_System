# AirNMS — Customisable Dashboard + FR-16 User Provisioning (combined design)

- **Work item:** `nms-platform-foundation` — Phase 3, next slice (dev-fast; design checkpoint before build)
- **Author:** Technical Architect · 2026-08-12
- **Status:** DRAFT for human G2-style go-ahead via Jarvis. Doc-only; no code, no host contact, no commit.
- **Builds ON:** the committed tree at `0ad5fe8` (Phase 2/2.5 + branding + Phase-3 four-feature build landing on `feature/nms-phase3-features`). Reuses the ratified architecture: BFF-only data path, opaque Redis session, `MetricValue` union, strict-nonce CSP, four data-states.
- **Supersedes:** the Phase-3 "customisable dashboard CUT / deferred" call (MEMORY item 27). The human has now asked to design it for real. This doc treats it as in-scope and designs the persistence store honestly.

> **Security floor (non-negotiable, carried in):** no token in the browser; `web ↛ bff` (structural guard); every read/write via the BFF; `unavailable ≠ 0`; strict-nonce CSP (no `unsafe-inline` on `script-src`); server-side authz. Every new write endpoint below is **session-gated, Zod-validated, and per-user-scoped server-side**.

---

## FEATURE 1 — Customisable / arrangeable dashboard

A user adds / removes / reorders / resizes widgets on a **personal** dashboard; the layout **persists per user across sessions**. Available widgets = the REAL panels we already have (below). No fabricated data in any widget.

### 1.1 Available widget set (POC-honest — real panels only)

Only panels backed by data we actually poll (deploy evidence 2026-08-11):

| Widget | Source (reused, no new data path) | Honest states |
|--------|-----------------------------------|----------------|
| `FleetKpiTiles` | `/api/v1/devices` (counts, up/down) | real |
| `P2PLinkMatrix` | `/devices/:id/metrics/latest` RF (2 radios) | sim-radio-02 RSSI **"Not available"** (FR-24) |
| `TopInterfaces` | `ports` derivatives (switch/router) | radios/ping-host absent (not shown) |
| `ThroughputChart` | `/devices/:id/metrics/series` (`ifInOctets_rate`/`ifOutOctets_rate`) | switch/router only |
| `CpuMemHeatmap` | `cpuUsage` / `mempool` | radio mem + ping-host mem grey **N/A**, never green-0 |
| `AlarmFeed` | `/api/v1/alarms` | 2 real alarms; acknowledger null → "—", never fabricated |
| `DeviceKpiPanel` | `/devices/:id` + `/metrics/latest` | per-device honest unavailables |

No widget invents a series. `unavailable ≠ 0` holds at the value **and** colour level (heatmap N/A stays outside the good→bad scale — MEMORY heatmap-green lesson).

### 1.2 Layout-persistence store — options weighed

The layout is a small per-user JSON document: an ordered list of `{ widgetId, x, y, w, h, params? }`. Tens of bytes to a few KB per user; single-writer (the owning user); read once per dashboard load. This shape drives the recommendation.

**(a) Redis (already deployed for sessions) — a per-user layout key.**
- Pros: zero new dependency, zero migration, zero new operational surface on the shared POC host; the BFF already owns a Redis client and session store; trivially per-user-keyed (`dash:layout:<sub>`).
- Cons: Redis is currently used session/ephemeral-flavoured. **Durability is a config property, not an inherent limit** — it must be verified: if the deployed Redis has **AOF (`appendonly yes`) or RDB snapshotting** enabled, a layout key survives restart; if it is a pure in-memory cache with no persistence, layouts are lost on restart. Sessions being ephemeral is *acceptable* (re-login); a lost saved layout is a worse UX. **Mitigation:** store layout under a **separate keyspace with no TTL** (sessions have a TTL; layouts must not), and **verify the deployed Redis persistence config** before relying on it. If persistence is off, this option requires enabling AOF (a Redis config change on the host — small, but a host change).

**(b) A new BFF-owned relational store (MariaDB/Postgres the BFF owns).**
- Pros: durable, queryable, clean schema, natural per-user PK.
- Cons: a **NEW dependency + a versioned-migration mechanism the BFF does not yet have + a new operational surface** (a datastore process, backups, connection pool, credentials) on a shared POC host carrying a third party's production workloads. For a single small JSON doc per user this is heavy. It would force an ADR for the migration mechanism and a data-model contract that does not otherwise exist. **Disproportionate at POC scale.**

**(c) LibreNMS's own `users_widgets` / `dashboards` (the native schema the seed work mapped).**
- Pros: reuses a store the human already uses; the seed work (Task 2) already proved the schema (`dashboards` + `users_widgets` plural, keyed by `user_id`; native "NOC Triage" = `dashboard_id=4`).
- Cons: **couples the custom UI to LibreNMS's DB and its `user_id` space** (direct DB writes to a third-party schema — a db-rules/overlay red flag: LibreNMS relational store is "read-mostly, never hand-alter"). Our custom widgets are NOT LibreNMS native widgets (LibreNMS `users_widgets.widget` references LibreNMS's own widget catalog, not our React panels), so we would be stuffing foreign layout data into a schema that does not model it, and mixing custom-UI layouts with the human's native dashboards in the same table. Also requires resolving our OIDC `sub` → LibreNMS `user_id`, a fragile join. **Rejected: it violates the "LibreNMS DB is read-mostly" posture and mis-models the data.**

### 1.3 RECOMMENDATION — **(a) Redis, layout keyspace, no TTL** + verify persistence

Bias per the brief: **least new operational surface that is still per-user durable.** Option (a) adds **zero** new process/dependency/migration; the only precondition is confirming (and if needed enabling) Redis persistence — far smaller than standing up a relational store (b) or writing into a third-party schema (c).

- **Key:** `dash:layout:v1:<userSub>` where `<userSub>` is the OIDC subject from the **server-side session** (never client-supplied). Value: Zod-validated JSON. **No TTL** (distinct from session keys, which expire).
- **Durability precondition (verify at build, not assume — the ASM-1 / schema-surprise discipline):** confirm the deployed Redis has AOF or RDB on. If OFF, either enable `appendonly yes` (host config, flagged to the human) **or** fall back to option (b) as a documented contingency. State this as a build-time gate, not a settled fact.
- **Why not an ADR-forcing store:** no new datastore, no migration mechanism → the durable-contract change is small.

### 1.4 ADR-0010 call

Current highest ADR is 0009. **Recommendation: YES, take ADR-0010 = "Custom-UI dashboard layout persistence in Redis."** Rationale: this introduces a **new team-owned persisted data class** (per-user UI state) and a **new durability dependency on Redis config** — a durable architectural contract (persistence model + why not a relational store, why not the native schema). It is exactly the kind of decision a future maintainer needs the reasoning for. The ADR is short (one Nygard record: context = per-user layout persistence for a POC; decision = Redis keyspace, no TTL, verify AOF/RDB; consequences = Redis becomes a persistence store not just a cache, contingency = relational store if we outgrow it). **I will draft `docs/adr/0010-dashboard-layout-persistence.md` as part of this checkpoint if the human approves the store choice** (cheap; not a separate blocking step).

### 1.5 Custom dashboard vs the native "NOC Triage" dashboard — **INDEPENDENT, do not mirror**

**Recommendation: the custom-UI arrangeable dashboard is INDEPENDENT of the native `dashboards`/`users_widgets`. It does NOT read or mirror the native store.**

Reasons (stated, not silent):
- The two widget catalogs are **disjoint**: native `users_widgets.widget` references LibreNMS's own widget types (graphs, alert lists rendered by LibreNMS); our widgets are React panels backed by the BFF. There is no faithful mapping — mirroring would either lose fidelity or require a translation layer that models nothing real.
- Mirroring couples our UI to LibreNMS `user_id`s and its schema (the read-mostly posture). The native "NOC Triage" (dashboard_id=4) is the human's LibreNMS artifact, reached via the native UI (already SSO-gated) — it stays there, untouched, and the seed keeps recreating it on fresh installs. That path is complete and should not be duplicated.
- **No silent duplication:** the custom dashboard is a *separate personal layout* over *our* panels. If a user wants the native NOC Triage view, they open the native UI (Open Admin Portal). Two intentional surfaces, clearly separated.

### 1.6 New BFF endpoints (Feature 1)

All under the existing BFF, session-gated, per-user-scoped from the **session `sub`** (never a client-supplied user id — server-enforced, no IDOR). REST envelope + machine error codes per API rules.

| # | Endpoint | Method | Auth | Body / behaviour |
|---|----------|--------|------|------------------|
| D1 | `/api/v1/dashboard/layout` | GET | session (read) | Returns the caller's layout from `dash:layout:v1:<sub>`. If none, returns a **default layout** (200 with a seeded default, or 404 → client renders default — pick 200+default for simplicity). No cross-user read possible: key derived from session only. |
| D2 | `/api/v1/dashboard/layout` | PUT | session (write) | **Zod-validated** full-layout replace. Writes `dash:layout:v1:<sub>`. **CSRF header required** (same double-submit/header pattern as `POST /alarms/:id/ack`). Body size-limited. Rejects unknown widget ids (allowlist = the 7 real widgets) and out-of-range geometry. |
| D3 | `/api/v1/dashboard/layout` | DELETE | session (write) | Reset to default (delete the key). CSRF header. Optional — include only if cheap. |

**Server-side per-user scoping (the load-bearing control):** the user id is taken **exclusively** from the validated session, so a user physically cannot read or write another user's layout — there is no request parameter that carries a user id. This is structural (no IDOR surface), not a trusted-client check.

**Zod schema (validation contract):**
```
LayoutSchema = {
  version: literal('v1'),
  widgets: array(max ~20) of {
    id: enum(FleetKpiTiles|P2PLinkMatrix|TopInterfaces|ThroughputChart|CpuMemHeatmap|AlarmFeed|DeviceKpiPanel),
    x,y,w,h: int in bounded grid range,
    params?: bounded object (e.g. deviceId: int) — strict, reject unknown keys
  }
}
```
Strict mode (reject extra fields), max body size, max widget count — per api-rules input-validation. No new store schema/migration (Redis key, not a table).

### 1.7 Feature 1 sizing

- BFF D1/D2(/D3) endpoints + Zod + Redis layout store + tests: **S–M**.
- ADR-0010: **XS**.
- Web: react-grid-layout (or equivalent) arrangeable canvas, add/remove/resize, persist via D2, CSP-safe (client component, no inline style injection that forces `style-src 'unsafe-inline'` — verify a real cold load under strict nonce; grid libs that inject inline styles are a CSP risk to check): **M–L** (the weight is here).
- **Feature 1 total: M–L**, backend small, UI heavy. **Risk to watch:** the grid library must not require `unsafe-inline` style-src (CSP floor). Verify on a real cold load before committing to a library.

---

## FEATURE 2 — FR-16 user provisioning: **VERDICT = CLOSE (satisfied by auto-provision + per-login role sync)**

The `ensureUser` stub (`packages/bff/src/librenms/client.ts:321`) is a documented no-op. FR-16 asks the platform to provision the LibreNMS user at the mapped level. **I verified against the real LibreNMS 25.7.0 source** (`/tmp/lnms/librenms-25.7.0`) what the platform actually does today.

### 2.1 Evidence (real 25.7.0 source)

**(1) No user-management REST API — confirmed.** `routes/api.php` has **no `users` create/update-level route** (`grep -niE "user"` returns nothing user-management-shaped). Jarvis's preliminary grep is confirmed rigorously: there is **no supported REST path** to create a user or set a level. Building `ensureUser` against a REST endpoint is not even possible without one.

**(2) `sso` mechanism auto-provisions on first login — `SSOAuthorizer::authenticate()`** (`LibreNMS/Authentication/SSOAuthorizer.php:53-67`): with `sso.create_users` it `firstOrNew(['username'=>...])` and `save()`s the user; with `sso.update_users` it re-saves realname/email/descr on every login. `HAS_AUTH_USERMANAGEMENT=true`, `CAN_UPDATE_USER=true`.

**(3) The level/role is RE-SYNCED from the group map on EVERY login — this is the decisive finding.** Provisioning and role assignment are separate steps, and the role step runs each login:
- **Header-SSO path (our deployment):** `LegacyUserProvider::retrieveByCredentials` (`app/Providers/LegacyUserProvider.php:209`):
  ```php
  $roles = $auth->getRoles($user->username);
  if ($roles !== false) { $user->syncRoles($roles); }
  ```
  `getRoles()` (`SSOAuthorizer.php:getRoles`) recomputes the level from `sso.group_level_map` (group_strategy=map) on each call, then `syncRoles` overwrites the user's roles. So **a group change in the IdP is reflected on the user's NEXT login** — not frozen at first login.
- **OIDC/Socialite path:** `SocialiteController::setRolesFromClaim` runs after every `Auth::login` and `syncRoles` from the claim — same per-login re-sync guarantee.

**(4) Our deployment uses the header-SSO path.** The native LibreNMS UI is fronted by **oauth2-proxy** (`nms-oauth2proxy.container`, OIDC client to Keycloak `nms` realm, `SET_XAUTHREQUEST=true`, scope includes `groups`), and LibreNMS is configured with the `sso` auth mechanism (`config/20-sso.php` = "Keycloak SSO auth mechanism"; nginx.conf:94 confirms `sso.static_level=0` fail-closed for the unmapped case → `group_strategy=map` with a `group_level_map`). So oauth2-proxy validates the OIDC session and passes identity/groups headers; LibreNMS's `SSOAuthorizer` provisions on first login and `syncRoles` from the group→level map **on every login**.

### 2.2 Verdict — **FR-16 is SATISFIED-BY-AUTO-PROVISION. Formally CLOSE it. Build nothing.**

- LibreNMS's `sso` mechanism **already provisions** the account on first SSO login (create_users) **and re-syncs the level** from the same group→level map on **every** login (update_users + `syncRoles`). The "level set only at first login, never re-synced" gap that would justify building a sync path **does not exist** in 25.7.0 for either SSO path.
- There is **no supported REST/user API** to call anyway — a bespoke `ensureUser` would have to either hit a non-existent endpoint or write LibreNMS's DB directly (violating the read-mostly posture and FR-07 spirit). Both are worse than the native mechanism that already does the job correctly.
- Our BFF's `roleMap` (engineer=10/readonly=5/operator=1, admin=10; fail-closed) governs **our** authorization; LibreNMS's own `group_level_map` governs the **native** UI's level. Both derive from the same Keycloak groups, so they stay consistent by construction. `ensureUser` calling LibreNMS to "also set the level" would be **redundant** with `syncRoles` and could only drift or conflict.

**A redundant provisioning call is worse than an honest close** (POC-honesty). FR-16 gets closed with this reasoning.

### 2.3 What actually changes (tiny)

- **Close FR-16** in the requirement doc / plan with the reasoning above (satisfied-by-auto-provision; no REST user API exists; per-login `syncRoles` covers level drift).
- **`ensureUser`:** keep it as an **honestly-documented no-op** (it already is, and already correctly does NOT throw). Update its comment from "FORMALLY DEFERRED to Task 7" → "FR-16 CLOSED: LibreNMS `sso` auto-provisions and re-syncs level from the group→level map on every login (verified against 25.7.0 `SSOAuthorizer`/`LegacyUserProvider`); no supported user API exists; a call here would be redundant with `syncRoles`." Removing the method entirely is also fine (callers already best-effort); keeping the documented no-op preserves the seam if a future non-SSO IdP ever needs it. **Recommend: keep as documented no-op** (cheaper, and the comment now carries the verified rationale).
- **Standing caveat to record:** this holds for the SSO/OIDC path. If a future deployment provisions users by some non-SSO route, FR-16 would re-open as a new work item — not this one.

**Feature 2 sizing: XS** (a comment update + a requirement-doc close note; no code path built).

---

## Consolidated NEW BFF endpoints (backend delta)

| # | Endpoint | Method | Source | Auth | Feasible? |
|---|----------|--------|--------|------|-----------|
| D1 | `/api/v1/dashboard/layout` | GET | Redis `dash:layout:v1:<sub>` | session (read) | YES — BFF already owns Redis client |
| D2 | `/api/v1/dashboard/layout` | PUT | Redis (Zod-validated write, CSRF header) | session (write, per-user from `sub`) | YES |
| D3 | `/api/v1/dashboard/layout` | DELETE (optional) | Redis | session (write, CSRF) | YES |

No LibreNMS API involved for either feature. **FR-16 adds no endpoint** (closed).

---

## Build order & sizing

1. **ADR-0010** (dashboard layout persistence) — XS, if human approves store choice.
2. **Verify deployed Redis persistence** (AOF/RDB) — gate for the store choice; if off, flag host config or fall back to relational store. XS but load-bearing.
3. **BFF D1/D2(/D3)** — Redis layout store + Zod + CSRF + per-user-scope tests (incl. negative: no cross-user read/write). S–M.
4. **Web arrangeable dashboard** — grid library (CSP-safe, verify cold load under strict nonce), 7 real widgets, persist via D2. M–L.
5. **FR-16 close** — comment update on `ensureUser` + requirement-doc close note. XS.

**Overall: M–L slice.** Weight is the arrangeable-grid UI; backend is small; FR-16 is a close, not a build.

## What to cut / defer
- **DELETE (D3) reset endpoint** — optional; drop if it adds noise (client can PUT the default).
- **Cross-user / shared dashboards, dashboard templates, per-widget deep config** — out of scope; personal single layout only at POC.
- **If Redis persistence is OFF and the human won't enable AOF** — either accept "layout may reset on Redis restart" as a documented POC limitation, or escalate the relational-store contingency (option b) as a separate decision. Do not silently ship a store that loses data.

## Open items for the human (checkpoint)
1. **Approve the Redis layout store + ADR-0010?** (vs relational store, vs native schema — recommendation: Redis + ADR-0010.)
2. **Independent custom dashboard confirmed** (not mirroring native NOC Triage)? Recommendation: independent.
3. **FR-16 CLOSE accepted** on the verified evidence (per-login `syncRoles`, no user REST API)? Recommendation: close, keep `ensureUser` as a documented no-op.
