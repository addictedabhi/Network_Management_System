# Design — NMS Platform Foundation (Phase 0 + Phase 1)

**Work item:** `nms-platform-foundation`
**Gate:** **G2 — PROPOSED. Requires human approval before any implementation.**
**Author:** Technical Architect
**Date:** 2026-08-09
**Input:** `docs/requirements/nms-platform-foundation.md` (G1-approved 2026-08-09)
**Reference (sketch, not spec):** `LibreNMS_Custom_UI_Architecture.md`
**Implementation plan:** `docs/plans/nms-platform-foundation-plan.md`
**ADRs:** `docs/adr/0001` … `docs/adr/0008`

> **Revision 2 (2026-08-09).** OQ-22 was resolved in a way that **enlarged scope**: LibreNMS is installed by this project on a **human-provided remote server** (FR-54..58), not assumed pre-existing. This revision **extends** v1 — no v1 decision is withdrawn except one premise in ADR 0003 that the official LibreNMS documentation contradicts (§12.4, ADR 0008 Decision 3). New material: **§12 (LibreNMS deployment work package)**, **ADR 0008**, revised estimate (§11), updated open-question rows (§9). **REVISED by revision 3 (2026-08-09):** the human authorized agent execution on `10.121.77.206` — the **Developer agent executes** the deployment under six guardrails; see §12.1, which retains the former "human executes" position as superseded context.

> **Revision 3 (2026-08-09) — doc-only amendment to the G2-approved design.** Three changes, no new architecture: (1) **§12.1's execution posture is inverted** — agents execute the deployment on `10.121.77.206` under guardrails, with the pre-flight snapshot and every STOP decision staying with the human; (2) the resolved decisions are folded in — **TimescaleDB** (OQ-3, ADR 0005 rev 2), **Keycloak co-hosted subject to a 4 vCPU / 8 GB floor check** (OQ-25/OQ-2), **Docker Compose** as the method with native demoted to a discovered-fact fallback (OQ-24), **TR-069 simulator-tolerance only** (OQ-21, ADR 0004 accepted), and **P2P vendors = Cambium + Ubiquiti** (OQ-11, ADR 0007 rev 2 — still Phase 2 work); (3) **§12.2 changes from "twelve questions for the human" to "facts discovered by SSH"**. No Phase 1 design decision is withdrawn.

---

## 0. Scope of this design

This design covers **Phase 0 (foundation) and Phase 1 (SSO + alarm console + inventory)** only, per requirement doc §12 and my handoff. Phases 2 and 3 get their own design/plan cycles.

**In scope (requirement IDs):**
- Phase 0: **FR-54..FR-58 (LibreNMS engine deployment on the human-provided server — see §12; this is the first gating step)**, FR-01..FR-05 (deployment/config of the engine), FR-07, FR-08, project scaffold, FR-50..FR-53 (simulation harness), NFR-29.
- Phase 1: FR-10..FR-19 (SSO), FR-30..FR-35 (alarm console + acknowledgment), FR-37..FR-40 (inventory, device detail, admin-portal jump), FR-43 (loading/error/empty), FR-46..FR-47 (BFF-only data path), NFR-09..FR-16, NFR-20..NFR-22, NFR-28..NFR-29.
- Acceptance targeted: **AC-A (all), AC-D#20..23, AC-E#25..28, AC-E#30, AC-F#31..34.**

**Explicitly deferred to later phases** (and why it is safe to defer): FR-06/FR-09 (distributed pollers — Phase 3), FR-20..FR-29 (P2P matrix, interface states, Top-N, heatmap — Phase 2/3; P2P vendor scope and pairing model now decided in ADR 0007 rev 2 — Cambium + Ubiquiti, MIB inference — but the work remains Phase 2), FR-36/FR-44/FR-45/FR-49 (real-time push — Phase 2; transport decided now in ADR 0006 because it shapes BFF structure), FR-41/FR-42 deep-linking refinement and FR-48 caching depth (Phase 3), AC-D#24, AC-B, AC-C, AC-E#29, AC-F#35.

**Not designed, deliberately (revision 1 framing; all of these are now RESOLVED at G2 — see the revision-3 note above).** Anything requiring an answer to OQ-2, OQ-3, OQ-11, OQ-12, OQ-14, OQ-21, OQ-22 was left undesigned in revision 1. Their resolutions are folded into §12 and the relevant ADRs; **the Phase-1 design surface is unchanged**, because none of them was a Phase 1 blocker. §9 lists each with its blocking status and my recommendation. Assumptions are marked **[ASSUMPTION — confirm at G2]**.

---

## 1. Architecture decision summary

The system is three tiers with one hard security boundary:

```
   Browser (no credentials, no tokens, ever)
      |  HTTPS: session cookie only
      v
   +--------------------------------------------------+
   |  packages/web   Next.js custom operations UI     |
   |  packages/bff   Node/TS BFF  <-- SECURITY BOUNDARY|
   |    holds: LibreNMS service token, TSDB cred,     |
   |           IdP client secret, Redis session store |
   +----------------+-------------------+-------------+
                    |                   |
        LibreNMS REST API         TSDB (Phase 2 reads)
                    |
   +----------------v-------------------+
   |  LibreNMS (PHP/Laravel) — UNMODIFIED |
   |  MariaDB · Redis queue · pollers     |
   +----------------+---------------------+
                    | SNMP
   +----------------v---------------------+
   |  packages/simulator — device harness |
   +--------------------------------------+
```

The five decisions that define this design, each with its own ADR:

| ADR | Decision | Status |
|---|---|---|
| 0001 | npm workspaces monorepo; `web` never depends on `bff` | Proposed |
| 0002 | BFF is the sole browser→data path; reference's token proxy rejected | Proposed |
| 0003 | BFF-mediated OIDC, opaque Redis-backed session, no browser token | Proposed (OQ-2 assumption) |
| 0004 | **TR-069 support model — SCOPE DECISION FOR THE HUMAN** | **Proposed, recommend (a)** |
| 0005 | TSDB behind a `MetricsReader` port | **ACCEPTED — TimescaleDB** (rev 2). The port stays: it keeps SQL out of every caller and is the seam for a future store change |
| 0006 | Real-time via SSE, not WebSocket | Proposed (Phase 2 build) |
| 0007 | P2P pairing model | **ACCEPTED (rev 2) — Cambium + Ubiquiti; MIB-inference pairing with a registry override.** Still Phase 2 work; nothing built for it in Phase 0/1 |
| 0008 | **LibreNMS engine deployment** — official Docker Compose (images pinned by us) on the human-provided host; authenticating-proxy SSO bridge; Keycloak co-hosted for the POC | **Proposed; branches on OQ-23/OQ-24** |

### 1.1 Alternatives considered at the system level

**Alternative 1 — no BFF; UI talks to LibreNMS through an authenticating reverse proxy.** Closer to the architecture reference. Rejected: LibreNMS API tokens have no per-user scoping, so a proxy either injects a global token (the prohibited pattern — ADR 0002) or must mint per-user tokens, which LibreNMS's model does not support. It also leaves FR-34's server-side denial nowhere to live and no place to shape responses for FR-38's pagination contract.

**Alternative 2 — BFF as Next.js API routes inside one app.** Rejected in ADR 0001: it makes credential isolation a convention rather than a structure, and it makes NFR-20/NFR-21's per-service health story inexpressible.

**Alternative 3 — read LibreNMS's MariaDB directly for inventory instead of using its REST API.** Tempting for FR-37/FR-38 performance. Rejected for Phase 1: the schema is LibreNMS's private contract, and coupling to it converts every LibreNMS upgrade into a compatibility exercise — precisely what G-6/NFR-27 forbid in spirit. My overlay requires an explicit ADR to justify direct DB reads; if API pagination proves inadequate at 5,000 devices, that ADR gets written with measurements, not before.

---

## 2. Module layout (handoff item 1)

Per ADR 0001. The developer overlay defers to this layout.

```
Network_Management_System/
├── package.json                 # workspace root: delegating scripts ONLY, no app code
├── package-lock.json            # single lockfile — the only version-pinning site
├── tsconfig.base.json           # strict TS config inherited by all workspaces
├── .env.example                 # every required var, with placeholder values, no real secrets
├── .gitignore                   # ignores .env*, node_modules, build output, coverage
├── docker-compose.yml           # LibreNMS + MariaDB + Redis + TSDB (Phase 0; see OQ-22)
├── packages/
│   ├── shared/                  # @nms/shared — no I/O, no secrets, no workspace deps
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types/           # Alarm, Device, Interface, Page<T>, MetricPoint, Unavailable
│   │   │   ├── schemas/         # Zod schemas for request validation + response parsing
│   │   │   └── errors/          # ErrorCode union (machine-readable), ApiError envelope
│   │   └── tests/
│   ├── bff/                     # @nms/bff — the security boundary
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts                 # startup: validate config, then listen
│   │   │   ├── config/                  # env schema + fail-fast validation (NFR-29)
│   │   │   ├── http/
│   │   │   │   ├── app.ts               # middleware chain assembly
│   │   │   │   ├── middleware/          # correlationId, securityHeaders, auth, authorize,
│   │   │   │   │                        #   rateLimit, errorHandler
│   │   │   │   └── routes/
│   │   │   │       ├── health.ts         # /health, /ready  (NFR-21)
│   │   │   │       ├── auth.ts           # /auth/login, /auth/callback, /auth/logout, /auth/session
│   │   │   │       ├── alarms.ts          # FR-30..35
│   │   │   │       └── devices.ts         # FR-37..39
│   │   │   ├── auth/                    # oidcClient, jwks verifier, sessionStore, roleMap
│   │   │   ├── librenms/                # LibreNMSClient (the ONLY holder of the API token)
│   │   │   ├── metrics/                 # MetricsReader port (+ health impl only, ADR 0005)
│   │   │   ├── cache/                   # Redis cache wrapper, explicit TTLs (FR-48)
│   │   │   └── observability/           # structured logger + redaction (NFR-15), audit log
│   │   └── tests/
│   │       ├── unit/
│   │       └── integration/             # supertest against the app, LibreNMS mocked at HTTP
│   ├── web/                     # @nms/web — depends on @nms/shared ONLY, never on bff
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── src/
│   │   │   ├── app/             # App Router: /login, /alarms, /devices, /devices/[id]
│   │   │   ├── components/      # DataState (loading/error/empty, FR-43), AlarmTable, ...
│   │   │   ├── lib/             # bffClient (relative URLs + credentials: 'include')
│   │   │   └── hooks/           # TanStack Query hooks
│   │   └── tests/
│   └── simulator/               # @nms/simulator — FR-50..53
│       ├── package.json
│       ├── src/
│       │   ├── index.ts         # CLI entrypoint
│       │   ├── agent/           # SNMP agent per simulated device
│       │   ├── profiles/        # router / switch / p2p-radio OID profiles
│       │   ├── control/         # HTTP control API: set values, flap, withhold OIDs
│       │   └── cwmp/            # minimal CWMP responder (only if OQ-21 = option a)
│       └── tests/
└── docs/{requirements,design,plans,adr}/
```

**Dependency rule (load-bearing, from ADR 0001):** `web → shared`, `bff → shared`, `simulator → shared`. Nothing else. `web` must never list `@nms/bff`.

**Mechanical enforcement.** A reviewer's attention is not a control. The root script `lint:deps` fails the build if `packages/web/package.json` declares `@nms/bff`, or if any file under `packages/web/src` imports from `@nms/bff` or a `../bff` path, or if `packages/shared/src` imports any other workspace. This is the mechanism that makes AC-F#31 hold over time rather than only on the day it is first tested.

### 2.1 Why these boundaries

Each unit answers "what does it do / how is it used / what does it depend on" without reading internals:

- `shared` — the contract. Pure types and validators; zero runtime dependencies on the other packages; safe for both a server and a browser bundle.
- `bff/librenms` — the only module that knows a LibreNMS API token exists. Every LibreNMS call funnels through it, so token handling, retry, timeout, and error translation have exactly one home.
- `bff/auth` — the only module that knows how a session becomes an identity + role. FR-34's denial is one call into `authorize`, not scattered checks.
- `bff/http/routes` — thin: validate input, authorize, call a service, shape the envelope. Route files stay small enough to hold in context, which is why routes are split per resource rather than one router file.
- `web` — rendering and interaction only. It cannot violate the credential rule because it has no access to credential-bearing code.
- `simulator` — an independent deliverable with its own lifecycle; it must run without the BFF or the UI, because Phase 0 uses it before either exists.

---

## 3. Commands, local run, and health checks (handoff item 2)

These resolve the long-standing OPEN QUESTIONs in team-config §9 (run command + health-check URL) and let the developer/tester overlays be marked `verified` once the scaffold lands.

### 3.1 package.json scripts — root (authoritative names)

| Script | Command | Purpose |
|---|---|---|
| `build` | `npm run build --workspaces --if-present` | Builds `shared` → `bff` → `web` → `simulator`. |
| `test` | `npm run test --workspaces --if-present` | Full suite, all workspaces. **This is the single command for `npm test`.** |
| `test:unit` | `npm run test:unit --workspaces --if-present` | Unit tests only. |
| `test:integration` | `npm run test:integration --workspace @nms/bff` | BFF integration tests (LibreNMS mocked at HTTP). |
| `test:coverage` | `npm run test:coverage --workspaces --if-present` | Coverage; enforces ≥80% on new code (NFR-28). |
| `lint` | `npm run lint --workspaces --if-present && npm run lint:deps` | ESLint everywhere plus the dependency-rule check. |
| `lint:deps` | `node scripts/check-workspace-deps.mjs` | Enforces ADR 0001's dependency rule. |
| `typecheck` | `tsc -b --noEmit` (project references, ordered) | Strict typecheck across workspaces. |
| `dev` | `npm run dev --workspace @nms/shared -- --watch & npm run dev --workspace @nms/bff & npm run dev --workspace @nms/web` (via `concurrently`) | Local dev: both services. |
| `dev:bff` | `npm run dev --workspace @nms/bff` | BFF only. |
| `dev:web` | `npm run dev --workspace @nms/web` | UI only. |
| `sim` | `npm run start --workspace @nms/simulator` | Starts the device simulation harness. |

Install is `npm ci` from the repo root (deterministic, per team-config §7).

### 3.2 Local run command

```bash
npm ci                    # once, from repo root
npm run dev               # starts BFF on :4000 and Next.js UI on :3000
npm run sim               # separate terminal: device simulators + control API on :9001
```

- UI: `http://localhost:3000`
- BFF: `http://localhost:4000`
- Simulator control API: `http://localhost:9001`

**REVISED (OQ-22 resolved).** LibreNMS, MariaDB, Redis, RRDCached and the TSDB do **not** run on the developer machine. They run on the **human-provided remote server**, installed by this project as the work package in **§12**. The developer's `.env` sets `LIBRENMS_BASE_URL` to that server's HTTPS URL once FR-58 passes.

The v1 note that "only `LIBRENMS_BASE_URL` changes for remote" was **too optimistic and is withdrawn**: it was true of the *client code* (and remains true — no code changes), but it wrongly implied the environment already existed. Installing it is now an explicit deliverable of comparable weight to a build task. What genuinely does not change is the code: the BFF still reaches LibreNMS over HTTPS through one client module (§2.1), so a local-vs-remote engine is a configuration difference for `packages/bff` and nothing more.

The simulators (`npm run sim`) run wherever they can be reached by the engine's pollers over SNMP/UDP 161 — see §12.6, which is a network-reachability question the human's answer to OQ-23 settles.

### 3.3 Health endpoints (NFR-21) — exact URLs and responses

Both services expose both endpoints. `/health` is liveness and performs **no dependency calls**; `/ready` is dependency-aware.

**BFF liveness — `GET http://localhost:4000/health`** → `200`
```json
{ "status": "ok", "service": "bff", "version": "0.1.0", "uptimeSeconds": 128 }
```

**BFF readiness — `GET http://localhost:4000/ready`** → `200` when all dependencies healthy
```json
{
  "status": "ready",
  "service": "bff",
  "checks": {
    "redis":    { "status": "ok", "latencyMs": 2 },
    "librenms": { "status": "ok", "latencyMs": 41 },
    "idp":      { "status": "ok", "latencyMs": 55 },
    "tsdb":     { "status": "ok", "latencyMs": 8 }
  }
}
```

→ `503` when any dependency is down (this is the AC-E#28 case — LibreNMS stopped):
```json
{
  "status": "not_ready",
  "service": "bff",
  "checks": {
    "redis":    { "status": "ok", "latencyMs": 2 },
    "librenms": { "status": "error", "error": "UPSTREAM_UNAVAILABLE" },
    "idp":      { "status": "ok", "latencyMs": 55 },
    "tsdb":     { "status": "ok", "latencyMs": 8 }
  }
}
```

**Web liveness — `GET http://localhost:3000/health`** → `200` `{ "status": "ok", "service": "web", "version": "0.1.0" }`
**Web readiness — `GET http://localhost:3000/ready`** → `200` `{ "status": "ready", "service": "web", "checks": { "bff": { "status": "ok" } } }`, `503` if the BFF is unreachable.

Two properties are deliberate and directly testable:
- `/ready` returning `503` while `/health` returns `200` is exactly AC-E#28's requirement. Readiness failure must drain traffic, not restart the process — a restart would not fix an upstream LibreNMS outage and would only add flapping.
- The `checks` object never contains a hostname, DSN, credential, or upstream error body — only a status, a latency, and a machine-readable code. An error payload echoing an upstream connection string into an unauthenticated endpoint is a common and avoidable leak (NFR-09/NFR-15).

`/health` and `/ready` are the **only** unauthenticated endpoints in the platform, and they return no operational data. This is the single documented exception to NFR-16, recorded here so AC-F#32's enumeration is unambiguous.

---

## 4. API design (BFF contract)

Per my overlay's API conventions and the repo owner's API rules: REST, plural nouns, `/api/v1/...`, consistent envelope, machine-readable codes, server-side pagination on every list.

### 4.1 Envelope

Success:
```json
{ "success": true, "data": { }, "meta": { "page": 1, "perPage": 50, "total": 4820, "hasNext": true } }
```
Error:
```json
{ "success": false, "errors": [ { "code": "VALIDATION_ERROR", "field": "severity", "message": "Must be one of: critical, warning, ok" } ], "meta": { "requestId": "req-abc-123" } }
```

`requestId` is the correlation ID (NFR-23), returned on every response and propagated as a header on every LibreNMS call.

### 4.2 Phase 1 route table (NFR-16 — every route declares auth explicitly)

| Method | Path | Auth | Roles | Requirement |
|---|---|---|---|---|
| GET | `/health` | **none** (documented exception) | — | NFR-21 |
| GET | `/ready` | **none** (documented exception) | — | NFR-21 |
| GET | `/auth/login` | none (initiates flow) | — | FR-11 |
| GET | `/auth/callback` | none (rate-limited, NFR-17) | — | FR-11, FR-16 |
| POST | `/auth/logout` | session | any | FR-18 |
| GET | `/api/v1/session` | session | any | FR-42 (role → UI affordances) |
| GET | `/api/v1/alarms` | session | all | FR-30, FR-31, FR-32 |
| GET | `/api/v1/alarms/:id` | session | all | FR-32 |
| POST | `/api/v1/alarms/:id/acknowledgement` | session | admin, engineer, operator — **readonly → 403** | FR-33, FR-34 |
| GET | `/api/v1/devices` | session | all | FR-37, FR-38 |
| GET | `/api/v1/devices/:id` | session | all | FR-39 |
| GET | `/api/v1/devices/:id/interfaces` | session | all | FR-39 (paginated) |
| GET | `/api/v1/admin-portal-url` | session | admin, engineer | FR-40, FR-41, FR-42 |

Notes on two choices that could be made differently:
- Acknowledgment is `POST .../acknowledgement` (creating an acknowledgment resource) rather than `PATCH` on the alarm, because it is an append-only audited event (NFR-18), not a general field update. It also keeps the authorization rule attached to one narrowly-scoped route.
- `GET /api/v1/session` exists so the UI can render role-appropriate affordances (FR-42) **without** ever treating that response as an authorization decision. Presentation only, per NFR-11.

### 4.3 Pagination (FR-38)

All list endpoints accept `page` (default 1) and `perPage` (default 50, **max 200, enforced server-side**) plus documented filters, and always return `meta`. A request for `perPage=100000` is a `VALIDATION_ERROR`, not a large response — FR-38 says no view fetches an unbounded set, and the only reliable way to guarantee that is to make the unbounded request impossible at the contract level rather than trusting the client.

---

## 5. BFF auth / authorization design (handoff item 4)

Full decision and alternatives in **ADR 0003**. The operative mechanics:

### 5.1 Login flow

1. Browser hits a protected UI route with no session → UI redirects to BFF `/auth/login`.
2. BFF generates `state` + PKCE `code_verifier` (`crypto.randomBytes`), stores them in a short-TTL Redis pre-session, and redirects to the IdP authorize endpoint with `response_type=code`, `code_challenge`, `code_challenge_method=S256`, `nonce` (satisfies **AC-A#1**).
3. User authenticates at the IdP; IdP redirects to BFF `/auth/callback?code&state`.
4. BFF: look up `state` (unknown/reused → reject); exchange `code` + `code_verifier` for tokens over a back-channel call using the client secret (never browser-visible); validate the ID token — **JWKS signature, `iss`, `aud`, `exp`, `nonce`** (NFR-14).
5. BFF maps IdP group claims → platform role via configured map (ADR 0003 table). **No mapped group → access denied, fail-closed.**
6. BFF ensures the LibreNMS user exists at the mapped level via the LibreNMS API / `sso` mechanism (FR-16; **AC-A#4, AC-A#5**).
7. BFF creates the Redis session, sets the `Secure; HttpOnly; SameSite=Lax` cookie (NFR-12), and redirects into the UI. **No token reaches the browser (AC-A#2).**

### 5.2 Per-request enforcement

Middleware order is itself a security property — authorization cannot precede identity, and logging must not precede redaction:

```
correlationId → securityHeaders → rateLimit → session lookup
  → token refresh if near expiry (FR-17) → authorize(route policy) → handler → errorHandler
```

- `authorize` reads the role from the **server-side session only**. A role, level, or user ID in the request body or headers is ignored entirely (NFR-11).
- Missing/invalid session → `401` with `AUTH_REQUIRED`, no data (**AC-A#6, AC-F#32**).
- Authenticated but insufficient role → `403` with `FORBIDDEN`, never `404` (per the repo's API rules; hiding existence is not the control here).
- Refresh failure → session destroyed, `401` `SESSION_EXPIRED`, UI redirects to login (FR-17).

### 5.3 The acknowledgment write path (FR-33..35) — server-side enforcement

This is the project's one Phase 1 write, and the requirement spec singles it out three times, so it gets an explicit end-to-end contract:

1. `POST /api/v1/alarms/:id/acknowledgement`, session required, rate-limited (NFR-17).
2. `authorize` rejects `readonly` with `403` **before any LibreNMS call**. **AC-A#8** crafts this request directly against the BFF, bypassing the UI; hiding the button is explicitly insufficient (FR-34).
3. Body validated by Zod in strict mode (unknown fields rejected).
4. BFF calls the LibreNMS API to persist the acknowledgment, so LibreNMS remains the single source of truth and the native UI reflects it (**FR-33, AC-D#22**).
5. **On LibreNMS failure the BFF returns a non-2xx with `UPSTREAM_UNAVAILABLE` or `UPSTREAM_ERROR` and the alarm is NOT reported acknowledged.** The UI reverts its optimistic state and surfaces the error (**FR-35, AC-D#23**). The BFF never writes a local "acknowledged" record as a fallback — a local success record after an upstream failure would make the two systems disagree, which is worse than the failure it papers over.
6. Audit log on both success and denial: actor (IdP subject + username), action, target alarm, outcome, timestamp, correlation ID (**NFR-18, AC-F#34**).

### 5.4 Security-relevant changes flagged explicitly

Per my hard rules, every security-relevant element of this design, in one place:

| Area | Design position | Requirement |
|---|---|---|
| Secrets | LibreNMS token, TSDB credential, IdP client secret: BFF only, from env/secret store, validated at startup, never logged, never in a response, never in `packages/web` or any `NEXT_PUBLIC_*` var | NFR-09, AC-F#31 |
| Token handling | No token in browser; opaque cookie; server-side Redis session | FR-12, AC-A#2 |
| Token validation | JWKS signature + `iss` + `aud` + `exp` + `nonce`, server-side | NFR-14, AC-A#6 |
| Authorization | Server-side on every request from session role; fail-closed on unmapped group | NFR-11, FR-34 |
| Input validation | Zod strict mode at the route boundary; unknown fields rejected; body size limit; `perPage` capped at 200 | repo API rules, FR-38 |
| Cookies | `Secure`, `HttpOnly`, `SameSite=Lax`, host-only | NFR-12, AC-F#33 |
| Security headers | CSP, HSTS (`max-age=31536000`), `X-Content-Type-Options: nosniff`, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy` | NFR-10, NFR-13, AC-F#33 |
| CSRF | `SameSite=Lax` + required custom header on state-changing routes | NFR-12 |
| Rate limiting | `/auth/callback` and all write routes | NFR-17 |
| Logging | Structured JSON; redaction at the logger layer for `authorization`, `cookie`, `set-cookie`, `token`, `password`, `community`, `secret`; no PII | NFR-15, AC-F#34 |
| Audit | State-changing actions logged with actor, target, outcome | NFR-18, AC-F#34 |
| CORS | Same-origin by default; no wildcard-with-credentials; explicit origin allowlist if the UI is ever split off-origin | NFR-19 |
| Prohibited | No `/api/v0/` browser-reachable proxy; no browser→TSDB; no global token anywhere | CON-6, FR-08, FR-46, ADR 0002 |

**[ASSUMPTION — confirm at G2, ASM-5]** the platform is not internet-exposed. If it is, the posture needs review (device-facing surfaces, stricter rate limits, WAF), and option (b) of the TR-069 decision would add an internet-reachable device endpoint — a further reason to prefer option (a) now.

---

## 6. API coverage matrix (handoff item 3) — verifying ASM-1

ASM-1 assumes the LibreNMS REST API exposes everything the custom UI needs. Verifying that per-requirement is a handoff deliverable. **Gaps are filled by TSDB reads, never by LibreNMS core changes (FR-07).**

**A necessary caveat on method, stated plainly:** this repository contains no LibreNMS instance, and none exists yet anywhere — the engine is installed by §12's work package, which had not run at design time, and no agent may run it (team-protocol §5). I therefore could not execute calls against a live API. The matrix below therefore records, per requirement, **the intended source and the concrete verification step that must be run during Phase 0 against the real instance.** Confidence is marked per row. Any row that fails Phase 0 verification is a design change, not an implementation detail, and comes back to me. Recording this as verified-by-inspection would be the ASM-1 failure mode the handoff asked me to prevent.

Legend — **Source:** `LNMS` = LibreNMS REST API · `TSDB` = time-series store · `BFF` = BFF-derived/computed · `IdP` = identity provider · `CFG` = configuration.
**Confidence:** `High` = documented, standard LibreNMS capability · `Med` = expected, must be confirmed in Phase 0 · `Gap` = known gap with a named fallback.

### Phase 1 requirements (must be verified in Phase 0 before Phase 1 build)

| FR | Need | Source | Confidence | Phase 0 verification step |
|---|---|---|---|---|
| FR-30 | Unified alarm feed across device types | LNMS alerts listing | High | List active alerts; confirm alarms from ≥2 simulated device types appear |
| FR-31 | Filter by device type / severity / ack state | LNMS + BFF | **Med** | Confirm which filters the API supports natively; **anything unsupported is filtered/paginated in the BFF over a bounded query, and the BFF must never fetch the unbounded set to filter in memory** |
| FR-32 | device, entity, severity, rule name, first-raised, duration, ack + acknowledger | LNMS alerts + rules + users | **Med** | Confirm every field is retrievable; `duration` is BFF-computed from first-raised; **acknowledger identity is the most likely gap** — if the API omits who acknowledged, the BFF's own audit log (NFR-18) supplies it for platform-originated acks |
| FR-33 | Persist acknowledgment via LibreNMS API | LNMS ack endpoint | High | Acknowledge via API; confirm the native UI shows it (AC-D#22) |
| FR-34 | readonly denied server-side | BFF | High | Not a LibreNMS concern — BFF authorize |
| FR-35 | Failure surfaced, not shown acknowledged | BFF | High | Stop LibreNMS; assert non-2xx and unacknowledged state |
| FR-37 | Inventory: hostname search, type/role, site/location, reachability filters | LNMS devices | **Med** | Confirm each filter is server-side supported; **location/site modelling and device-role taxonomy are the likely gaps** — if absent, they are derived from LibreNMS device groups or attributes, decided in Phase 0 with a follow-up ADR if non-trivial |
| FR-38 | Server-side pagination + metadata | LNMS + BFF | **Med** | Confirm the API's own limit/offset support. **If LibreNMS returns unbounded lists, the BFF still exposes a paginated contract and must bound upstream reads — with a documented cache (FR-48) — rather than loading 5,000 devices per request.** This row is the single most important one to verify, because NFR-08 and AC-E#26 depend on it |
| FR-39 | Device detail: identity, reachability, uptime, per-interface state + utilisation | LNMS device + ports | High | Fetch device and ports; compare against native UI |
| FR-40/41/42 | Admin-portal URL, deep link, role-gated | CFG + BFF | High | Construct native-UI URL from config; confirm no credential prompt (AC-A#3) |
| FR-43 | loading/error/empty states | BFF error contract + web | High | Induce each; assert explicit states |
| FR-46/47 | TSDB reads server-side; all access via BFF | BFF | High | Bundle + traffic inspection (AC-F#31) |
| FR-10..19 | SSO | IdP + LNMS `sso` | **Med** (OQ-2) | Blocked until an IdP exists; verify per AC-A |
| FR-16 | Auto-provision LibreNMS user at mapped level | LNMS users / `sso` | **Med** | Confirm creation + level update on claim change (AC-A#4/5) |
| NFR-21 | `/health`, `/ready` | BFF/web | High | curl both; stop LibreNMS and assert 503/200 split |

### Later-phase requirements (recorded now so gaps are known early, not verified in Phase 0)

| FR | Need | Source | Confidence | Note |
|---|---|---|---|---|
| FR-20..23 | P2P link matrix, SNR/RSSI/mod-rate, charts | LNMS (sensors/wireless) + TSDB | **Gap — blocked** | Link *pairing* has no LibreNMS source at all, so ADR 0007 rev 2 derives it from vendor peer-identity OIDs (`remoteMAC` / `remoteMACAddress` / `remoteUnitName`) for the two selected vendors. RF values come from wireless-sensor data and TSDB history; per-vendor OID coverage is ASM-2 |
| FR-24 | "not available" state | BFF | High | Requires the `unavailable` discriminator in shared types from Phase 1 (ADR 0005/0007) |
| FR-25 | Up / Down / **Flapping** | LNMS ports + TSDB/eventlog | **Gap** | Up/Down is directly available; **"flapping" is not a LibreNMS state** — it must be computed by the BFF from state-change history, and the definition is **OQ-12** (unresolved) |
| FR-26 | Top-N by 95th-percentile throughput | **TSDB** | Med | Not a LibreNMS API capability — this is the archetypal legitimate TSDB read. Method must be documented (FR-28) |
| FR-27 | CPU/memory heatmap | LNMS health + TSDB | Med | Current values from the API; historical from TSDB |
| FR-36/44/45/49 | Real-time push, freshness, reconnect | BFF (SSE) | Med | ADR 0006; derivation interval interacts with **OQ-14** |
| FR-06/09 | Distributed pollers, queue depth | LNMS + Redis | Med | Phase 3 |

**Conclusion on ASM-1:** it holds for **alarms and device/interface inventory** (the Phase 1 core), subject to the Phase 0 checks above — with two caveats that matter for pagination/filtering depth (FR-31, FR-37, FR-38). It **does not hold** for three later-phase needs, each with a legitimate non-core fallback: **link pairing** (no source; needs OQ-11), **flapping** (BFF-computed; needs OQ-12), and **95th-percentile aggregation** (TSDB). None requires a LibreNMS core change, so FR-07/G-6 remain intact.

---

## 7. Device simulation harness design (handoff item 6) — FR-50..53

A standalone package (`@nms/simulator`) that runs without the BFF or UI, because Phase 0 needs it before either exists.

### 7.1 Structure

- **Agent** — one simulated SNMP agent per device, each bound to its own address/port so LibreNMS discovers and polls it as an independent device. LibreNMS is configured with these as managed devices; **no LibreNMS modification is involved** (FR-07) — from its perspective these are ordinary SNMP devices.
- **Profiles** — declarative per-device-class OID maps: `router`, `switch`, `p2p-radio`. A profile declares system identity, interfaces (state + counters, FR-25/FR-26), CPU/memory (FR-27), and for radios SNR/RSSI/mod-rate (FR-20..23). Profiles are data, so adding a vendor shape later is a data change, not a code change — which matters because ASM-2's vendor list is now narrowed to **Cambium + Ubiquiti** (ADR 0007 rev 2) on LibreNMS-support grounds rather than on estate knowledge — so a third vendor arriving is a data change, not a redesign.
- **Control API** (`:9001`) — an HTTP interface the tester and automated tests drive:

| Method | Path | Purpose | Requirement |
|---|---|---|---|
| POST | `/control/devices` | Create N simulated devices from a profile | FR-50, FR-53 |
| PATCH | `/control/devices/:id/oids` | Set a metric value (e.g. degrade SNR) | FR-50, FR-51 |
| POST | `/control/devices/:id/interfaces/:idx/state` | Force up/down | FR-51 |
| POST | `/control/devices/:id/interfaces/:idx/flap` | Run a flap sequence: N transitions over a window | FR-51 |
| **POST** | **`/control/devices/:id/oids/withhold`** | **Withhold specific OIDs** | **FR-52** |
| DELETE | `/control/devices/:id/oids/withhold` | Restore withheld OIDs | FR-52 |
| POST | `/control/devices/:id/reachability` | Make the device stop answering entirely | NFR-22 |

The control API binds to localhost by default and is a **test-only component that must never be deployed alongside production** — it is, by design, an unauthenticated remote-control surface for device state. Stated explicitly so it is never mistaken for a platform service.

### 7.2 OID withholding (FR-52) — the mechanism, and why it is done this way

Memory records the trap: *a simulator that always answers cannot test the "metric unavailable" path.* FR-24 and AC-B#11 require the UI to show an explicit "not available" — not `0`, not healthy.

Withholding must therefore reproduce the **distinct ways a real device declines to answer**, because they surface differently to LibreNMS and a single mode would give false confidence:

| Mode | Agent behaviour | Real-world analogue |
|---|---|---|
| `noSuchObject` | Respond with `noSuchObject` for that OID | Device/firmware does not implement the OID at all |
| `noSuchInstance` | Respond with `noSuchInstance` | OID exists; this instance does not |
| `omit` | Omit the varbind from a GETNEXT/walk | OID absent from the subtree |
| `timeout` | Do not respond to that OID at all | Partial device failure / ACL blocking |

The verification chain FR-52 has to support end-to-end: withhold RSSI on a `p2p-radio` → LibreNMS records no value → the BFF returns the **`unavailable` discriminated state** rather than a `0` or a missing field → the UI renders an explicit "not available" indicator. The type-level `unavailable` state (ADR 0005) is the reason this chain cannot silently degrade into `0` somewhere in the middle: a numeric-only type would force every layer to invent a sentinel, and `0` is the sentinel people reach for.

`omit` and `noSuchObject` are the two modes Phase 0 must support to unblock FR-24 verification; `noSuchInstance` and `timeout` follow with the P2P work in Phase 2.

### 7.3 Scale (FR-53)

FR-53 targets ~5,000 simulated devices for NFR-01/02/04 verification (AC-F#35). Design position: agents are lightweight and event-driven, many per process, with device count as configuration. **However — I will not claim 5,000 devices from a single developer machine is achievable without measurement.** The honest plan: Phase 0 delivers the harness with a modest device set (order tens) sufficient for functional verification of Phase 1, and **scale verification is a Phase 3 activity** with its own capacity work. AC-F#35 already depends on OQ-15 and a representative environment, and the requirement doc itself flags that it may need re-scoping. That flag should be taken up rather than quietly assumed away.

### 7.4 TR-069 element

Present **only if the human approves option (a)** of ADR 0004: a minimal CWMP responder that presents as a TR-069-speaking, SNMP-silent device, verifying the platform tolerates and correctly ignores non-SNMP devices. No ACS, no ingestion. If option (b) is chosen, this becomes a separate work item with its own G1 (see ADR 0004).

---

## 8. Data model, rollout, and rollback

### 8.1 Data model impact

- **LibreNMS MariaDB:** read-mostly via the REST API. **No hand-altered schema, no direct DDL, ever** (my overlay; repo DB rules). Direct DB reads would require their own ADR with measurements.
- **Redis:** two logical namespaces — `sess:*` (sessions, TTL = absolute session lifetime) and `cache:*` (API cache, explicit documented TTLs per FR-48, ≤60 s for inventory per NFR-06). Ephemeral; no migrations.
- **TSDB:** written by LibreNMS (FR-04); read by the BFF from Phase 2 (ADR 0005). Schema is LibreNMS's.
- **Team-owned persistent store: NONE in Phase 1.** This is deliberate (ADR 0007): introducing one would force the versioned-migration-mechanism decision my overlay flags as undecided, and would do so as a side effect of an unrelated task. ADR 0007 rev 2's registry **override** does need persistence in Phase 2, and that decision gets its own ADR and the migration mechanism is chosen explicitly there — **never direct DDL or ad-hoc schema edits**.

### 8.2 Feature-flag needs

Phase 1 needs one flag: `AUTH_MODE`. **[ASSUMPTION — confirm at G2]** If OQ-2 delays IdP availability, a `dev-local` mode allows a fixed local identity **in development only**, and the config validator **refuses to start** if `AUTH_MODE=dev-local` while `NODE_ENV=production`. Fail-fast at startup, not a per-request check (NFR-29). This is a scaffold-progress unblocker, not a shipped auth path; if the human prefers no such mode at all, Phase 1 simply blocks on OQ-2 — which is the cleaner but slower option, and I would accept it.

### 8.3 Backward compatibility

Greenfield: nothing to preserve. The compatibility obligation runs the other way — the platform must not constrain LibreNMS upgrades (NFR-27/G-6). Concretely: no core patches, no schema coupling, and the LibreNMS client isolated in one module so an API change is a single-file fix.

### 8.4 Rollout / rollback

Phase 0 and Phase 1 land on `feature/<ticket-id>-nms-platform-foundation` (**OQ-20** — no ticket ID supplied; needed for CON-5 branch naming). Nothing is deployed to a shared environment during Phase 0/1; verification is local/dev against simulators.

Rollback is per-task: each plan task is independently revertable, and no task alters a shared datastore's schema. The one irreversible-by-nature action is IdP client registration, which is additive and removable at the IdP.

Deployment target (**OQ-18**) is unresolved and does not block Phase 0/1, since both are local. It must be resolved before a shared-environment deploy, because it shapes NFR-21 probe wiring.

---

## 9. Open questions — blocking status and my recommendations

Per my hard rules I have invented no answers. Each is listed with its actual effect on this design.

| OQ | Question | Blocks | My recommendation (human decides) |
|---|---|---|---|
| **OQ-21** | TR-069 support model | **Harness detail only** — not Phase 1's critical path | **Option (a): simulator tolerance only.** No FR needs TR-069 data; option (b) is a material scope increase needing its own G1. Full reasoning in ADR 0004 |
| **OQ-2** | Does an IdP exist? | **BLOCKS Phase 1 completion** (all of FR-10..19, AC-A) | Confirm the IdP and grant client-registration access as the **first** post-G2 action. If none exists, standing one up is a prerequisite project and Phase 1's estimate grows materially. **Now has a concrete resolution path: accept OQ-25 and co-host Keycloak** (ADR 0008 Decision 4). Note **two** OIDC clients are needed — `nms-custom-ui` for the BFF and one for the native UI's authenticating proxy (§12.4) |
| **OQ-22** | Where does LibreNMS run? | **RESOLVED 2026-08-09 — and it grew scope** | Remote human-provided server; **installing it is in scope** (FR-54..58). See §12 and ADR 0008. Superseded by OQ-23/24/25 below |
| **OQ-23** | Server access details: hostname/IP, OS + version, access method, **Docker permitted?**, CPU/RAM/disk, root/sudo, shared?, **lab/disposable or protected?** | **BLOCKS the whole §12 package** | **No recommendation possible — these are facts only the human has.** Every one is listed in §12.2 as a blocking input. The lab-vs-protected answer additionally decides whether any agent may *ever* connect (team-protocol §5); until it says lab/disposable, the human executes every step |
| **OQ-24** | Install method: official Docker Compose vs native | **Branches §12's steps** | **Compose, with every image pinned by us** (the official example uses `latest`, which we do not adopt). Conditional on OQ-23's Docker answer; the native branch is fully specified as §12.5b. Reasoning from the official docs in ADR 0008 Decision 1 |
| **OQ-25** | Co-host Keycloak on the same server? | **Would resolve OQ-2** | **Yes for the POC**, with the caveat recorded not just spoken: a POC-grade co-hosted IdP is **not** a production identity solution. Sizing in ADR 0008 Decision 4. **If the host is at the 4 vCPU / 8 GB floor, my recommendation flips** to hosting Keycloak elsewhere |
| **OQ-3** | **RESOLVED: TimescaleDB** (2026-08-09) | Phase 2 unblocked | The residual risk *moved* rather than vanished: the LibreNMS→Timescale write path is less travelled than the Influx one, so it is **verified at plan Task 0.6 Step 6** (recent-row count > 0), not assumed. The `MetricsReader` port stays (ADR 0005 rev 2) |
| **OQ-11** | **RESOLVED in part: "top 2 vendors" → Cambium + Ubiquiti**, selected by the Architect on verified LibreNMS RF support (ADR 0007 rev 2) | Phase 2 P2P work is unblocked *for planning* | Pairing is **vendor MIB inference** (both vendors expose `remoteMAC`/`remoteMACAddress`/`remoteUnitName`) with a narrow registry override. **Still missing: the actual estate inventory.** Obtain it before Phase 2 planning; a mismatch means revising ADR 0007, not improvising in code |
| **OQ-12** | Flapping definition | Blocks **FR-25/AC-C#14** (Phase 2) | The doc's own proposal (≥3 transitions in 5 min) is reasonable; it must be **configuration**, not a constant. Also note flapping is BFF-computed — LibreNMS has no such state (see §6) |
| **OQ-14** | Polling interval | Blocks **NFR-05 validation** (Phase 2) | Confirm the intended reading of NFR-05: ≤10 s from **LibreNMS recording** the change (achievable) vs ≤10 s from the change **occurring** (not achievable at a 5-min interval). See ADR 0006 |
| OQ-7 | Role/level mapping | Shapes FR-15/FR-42 now | Table proposed in ADR 0003; confirm whether `nms-engineer` gets native-UI access |
| OQ-5 | Logout semantics | Shapes FR-18/AC-A#7 | Terminate platform session + IdP RP-initiated logout + LibreNMS session; verify both UIs re-prompt |
| OQ-10 | Session timeouts | FR-19 | Proposed 30 min idle / 8 h absolute, both configurable |
| OQ-13 | Push transport | Phase 2 | **SSE** — decided in ADR 0006 with reasoning |
| OQ-4 | Keep RRD? | Phase 0 config | **Keep RRD** alongside the TSDB; removing it risks native-UI graph regression |
| OQ-20 | Ticket ID for branch naming | CON-5 compliance | Needed before branch creation |
| OQ-18 | Deployment target (**of the custom UI + BFF**) | Pre-shared-deploy, not Phase 0/1 | Defer; resolve before any shared-environment deploy. **Distinct from OQ-23**, which is the *engine's* host. Note FR-56 requires the BFF host to reach the LibreNMS API, so the two answers interact |
| OQ-7 (addendum) | Readonly role → LibreNMS level | Shapes FR-15 | The official docs' `sso` level map is `1 user`, `5 global-read`, `10 admin`, `11 demo`. **Level `5` (`global-read`) fits `readonly` better than `1`**, whose device/port permissions must be assigned per-user. Flagged, not silently changed (ADR 0008 Decision 3) |
| — | Artifact collection (tester evidence) | **G2.7** | Proposed: BFF/web JSON logs to stdout captured to `artifacts/<run>/logs/`, test reports to `artifacts/<run>/reports/`, coverage to `coverage/`. The Tester owns the final answer at G2.7 |

**Net effect on G2 (revised):** none of these blocks G2 *approval* of this design or the plan. But the balance has shifted — **OQ-23 now blocks the very first task in the plan**, not a mid-Phase-0 one. §12 is written so that everything not needing the server proceeds in parallel, which keeps OQ-23 off the developer's critical path; it does not remove the dependency. **OQ-2 (possibly via OQ-25) blocks Phase 1 completion.** OQ-21 and OQ-25 need decisions because they are scope/posture questions the human owns.

---

## 10. Test plan (design level)

The Tester owns the detailed plan at G2.7; this is the shape the design commits to, so the plan's verification steps are executable.

- **Unit** (~70%): role mapping including the fail-closed unmapped case; token-validation failures (bad signature, wrong `aud`, wrong `iss`, expired — the four AC-A#6 checks); envelope/error mapping; pagination bounds including `perPage` over the cap; log redaction; the `unavailable` discriminator.
- **Integration** (~20%): `supertest` against the assembled BFF app with LibreNMS mocked **at the HTTP boundary** (never by patching internal functions, per the repo test rules) — full login callback, alarm list + filters, acknowledgment success, acknowledgment `403` for readonly (AC-A#8), acknowledgment upstream-failure path (AC-D#23), `/ready` degradation when LibreNMS is down (AC-E#28).
- **E2E** (~10%): login → alarm console → acknowledge → inventory search → device detail → admin-portal jump → logout, with the simulators supplying devices.
- **Security**: bundle + traffic inspection for secrets (AC-F#31); unauthenticated request to every route in §4.2 (AC-F#32); header/cookie assertions (AC-F#33); log inspection after an acknowledgment (AC-F#34); secret scanning in CI.
- **Coverage**: ≥80% on new code (NFR-28), with authorization and error paths explicitly required rather than incidental.

---

## 11. Estimate (Phase 1, for the requirement doc's kickoff record)

A **rough** estimate, stated with its assumptions because an estimate without them is a guess presented as a commitment.

| Work | Estimate |
|---|---|
| Phase 0 — scaffold, workspaces, scripts, health endpoints, LibreNMS/MariaDB/Redis/TSDB up, API-coverage verification | **3–5 days** |
| Phase 0 — simulation harness (SNMP agents, profiles, control API, withholding) | **3–4 days** |
| Phase 1 — SSO end-to-end (OIDC flow, session, role mapping, LibreNMS provisioning, logout) | **5–7 days** |
| Phase 1 — alarm console (BFF endpoints + UI, acknowledgment with authz + audit + failure path) | **4–6 days** |
| Phase 1 — inventory + device detail (paginated endpoints + UI, loading/error/empty) | **4–5 days** |
| Phase 1 — security hardening, headers, redaction, test completion to ≥80% | **2–3 days** |
| **Phase 0 — LibreNMS engine deployment package (§12): documentation, runbook authoring, Compose/native manifests, TLS + authenticating proxy, RRDCached, SSO wiring, FR-58 verification** — *planning/authoring by the team; **execution by the human*** | **+4–6 days** (Compose branch) / **+7–10 days** (native branch, because FR-55's repeatability requires configuration management, not a runbook) |
| Phase 0 — **Keycloak co-host + two OIDC client registrations** (only if OQ-25 accepted; replaces the "+3–5 days if no IdP exists" risk below) | **+2–3 days** |
| **Total Phase 0 + Phase 1 (v1 figure)** | ~~≈21–30 working days~~ |
| **Total Phase 0 + Phase 1 — REVISED** | **≈27–39 working days (5.5–8 weeks) of one developer**, Compose branch with Keycloak co-hosted |

**Assumptions this estimate depends on — each one is a schedule risk if wrong:**
- **OQ-2:** an IdP exists and clients can be registered. If one must be stood up, **add 3–5 days** and it becomes the critical path — **or accept OQ-25 and co-host Keycloak** for the +2–3 days already carried in the table above, which is the cheaper path and the one I recommend.
- **FR-57's premise was wrong and this estimate reflects the correction.** LibreNMS has no OIDC auth module (§12.4); SSO into the native UI needs an authenticating reverse proxy. That is included in the deployment figure above, but it is *new work* v1 did not price because v1 believed it was pure `config.php` configuration.
- **OQ-22 → OQ-23 (the largest single risk in this estimate):** the revised figure assumes a **Docker-permitted, root/sudo-available, unshared, lab-designated** host on a documented-supported OS, provided promptly. Each of those being false costs time: no Docker → the native branch (+3–4 days over Compose); unsupported/old OS → third-party PHP repo work or a rebuild; **protected rather than lab** → every step is human-executed with a plan/execute/report round-trip per step, which realistically adds **2–4 days of elapsed calendar time** even though it adds little team effort; shared host → added caution and possibly a decision not to install at all.
- **Execution ownership:** the deployment days above are *team planning and authoring* days. **The human executes the steps on the server.** The estimate does not include the human's own time, and elapsed calendar time will exceed the effort figure by however long the plan→execute→report loop takes per step.
- **The 5,000-device target is not in this estimate and is not achievable on this host.** The official dispatcher documentation puts a single instance at "1,000+ devices" and directs you to distributed polling beyond that (ADR 0008 Decision 4). FR-53/AC-F#35 remain Phase 3 on sized hardware.
- **ASM-1** holds for alarms/inventory per §6. If FR-38's pagination or FR-31/FR-37's filtering are worse than expected in the LibreNMS API, add **2–4 days** for BFF-side bounded querying and caching.
- No TR-069 ingestion (ADR 0004 option (a)). **Option (b) is not in this estimate at all** — it is a separate work item of comparable size to Phase 1.
- Scale verification (FR-53 at ~5,000 devices, AC-F#35) is **excluded** — Phase 3.

**Confidence: moderate for Phase 0, lower for the SSO item**, which is the single most estimate-sensitive piece because it depends on an external system I have not seen (OQ-2) and on LibreNMS's `sso` behaviour, which must be verified rather than assumed (AC-A#3/#4/#7).

---

## 12. LibreNMS engine deployment work package (FR-54..58) — NEW in revision 2

Decision and alternatives in **ADR 0008** (revision 2). This section is the design; the ordered, **agent-executable** steps are plan **Tasks 0.1–0.6** (plan revision 3).

### 12.1 Who does what — REVISED 2026-08-09: the agent executes, under guardrails

**Superseded position (retained because it explains the shape of the runbook).** This section previously read: *"No agent executes any step in this package. Per team-protocol §5, any SSH connection or fact-gathering against a host we do not own disposably counts as reaching a target environment… Running every command on the server: the human."* That was the correct posture for an undesignated host, and it is why every step in Tasks 0.1–0.6 carries an explicit expected output.

**Current position.** The human authorized agent execution on 2026-08-09 — *"use the credentials to deploy the solution"* — for `10.121.77.206` **only** (requirement doc §5.8, team-config §8, ADR 0008 revision 2). team-protocol §5 is unchanged everywhere else.

| Activity | Owner |
|---|---|
| Install method decision, service topology, port list, SSO wiring, sizing, verification criteria | Technical Architect (this document + ADR 0008) |
| Runbook: ordered steps, exact commands, expected output and **stop condition** per step | Technical Architect (plan Tasks 0.1–0.6) |
| Compose manifest content, committed to this repo | Developer |
| **SSH fact-gathering, install, TLS/firewall/SSO wiring, and FR-58 verification on the server** | **Developer agent** (plan Tasks 0.1, 0.4a/0.4b, 0.5, 0.6) |
| **Pre-flight VM snapshot on the hypervisor/cloud console** | **The human — does NOT transfer.** An agent inside the guest cannot snapshot the machine it runs on, and on the native branch this is the only rollback (§12.8) |
| **Deciding any STOP** (shared host, destructive action, port conflict, Keycloak floor, missing Docker, TLS source) | **The human**, via Jarvis |
| Evidence capture, expected-vs-actual per step, redacted | Developer agent, under `.claude/team/artifacts/nms-platform-foundation/deployment/` |

**What actually carries the safety is the guardrail set, not the former prohibition.** Six guardrails, each written into the plan steps rather than stated once:

1. **Credential hygiene (Critical).** The SSH credential lives in the **gitignored repo-root `Credentials.md`**, is read **only** to establish the connection, and is **never** copied into any doc, config, log, artifact, commit, handoff, status file, or echoed command — path references only. Task 0.1 Step 6 installs a project SSH key precisely so the credential leaves the automation loop after one use. Secret *generation* happens server-side and is evidenced by a masked `KEY=<set:NN>` listing, so no generated value ever reaches a file we write.
2. **Evidence per step**, expected-vs-actual, secrets redacted, allow-list capture (record the lines you meant to; never whole scrollback).
3. **STOP before destruction** — disk/partition changes, OS changes, removing/reconfiguring/stopping any pre-existing service.
4. **STOP if the host is shared** with unrelated production services — before installing anything.
5. **Facts first** — Task 0.1's read-only SSH discovery precedes every install action and selects the branch.
6. **Keycloak floor check** — co-host only if discovered specs **exceed** 4 vCPU / 8 GB.

**The risk profile changed and it should be named.** Previously a mistaken command was caught by a human reading it before running it. That review layer is gone. Three consequences, all of which raise the value of choices already made:

- The **pre-flight snapshot** moves from good practice to the only rollback. Nothing installs without a recorded snapshot ID.
- **Compose's blast-radius containment becomes a safety control**, not a convenience: state confined to named volumes, services confined to containers, on a host whose shared-ness is unverified until Task 0.1 runs.
- The **§12.4 header-injection boundary** is unchanged in severity and now constructed unsupervised. Its negative test (plan Task 0.6 Step 9) is the check that must never be skipped or self-certified.

### 12.2 Host facts — REVISED: discovered by SSH, not requested from the human

Revision 2 listed twelve blocking inputs to request from the human. Six of them were never human-answerable, and the human has now authorized us to find out. **The table below is retained as the fact list, with the source of each fact updated.** Facts marked *discovered* are gathered by plan **Task 0.1 Step 3** (read-only SSH) and evaluated against four STOP conditions in Step 4. **None is guessed anywhere in this design or plan.**

| Fact | Source now |
|---|---|
| Hostname / IP | **Supplied: `10.121.77.206`** |
| Access method | **Supplied: SSH, credentials at the gitignored repo-root `Credentials.md`** (path reference only) |
| Install method | **Decided: Docker Compose** (OQ-24) |
| TSDB | **Decided: TimescaleDB, co-hosted** (OQ-3) |
| Keycloak co-host | **Decided: yes** (OQ-25) — **subject to the floor check** (>4 vCPU / >8 GB) |
| OS + version | **Discovered** (Task 0.1) |
| Docker + Compose v2 availability | **Discovered** — and it selects the branch. Docker absent → report, do not silently install a runtime or silently fall back |
| CPU / RAM / disk | **Discovered** — feeds the sizing and the Keycloak floor check |
| Root / sudo | **Discovered** — no usable sudo is a STOP |
| Pre-existing services + listening ports | **Discovered** — unrelated production services, or a conflict on 80/443/3306/5432/6379/162/514, is a STOP |
| TLS certificate source | **Still outstanding from the human.** Corporate CA, ACME (needs inbound 80 + public DNS), or a POC self-signed CA — and if self-signed, the BFF host must trust that CA, which is a real step and the commonest cause of a Task 6 failure that looks like a code bug |
| Simulator reachability over UDP 161 | **Discovered/decided at Task 0.6 Step 4** — still the most-likely-to-surprise item in the package. If the simulators run on a laptop behind NAT, FR-58 fails for network reasons, not software ones; running them on the server is the reliable option |

The revision-2 table below is preserved because it records *why* each fact blocks, which remains true whether the fact is supplied or discovered:

| # | Input | Why it blocks | What changes with the answer |
|---|---|---|---|
| 1 | **Hostname / IP** (and DNS name for TLS) | FR-56, FR-58, `LIBRENMS_BASE_URL`, the OIDC `redirect_uri` | A certificate needs a name; OIDC clients need exact redirect URIs. **Committed only if the human confirms it is acceptable in-repo** — otherwise it lives in runtime config only |
| 2 | **OS + version** | Decides whether the native branch is even available; decides PHP-repo need | Docs support Ubuntu 26.04/24.04, Debian 12/13, RHEL-family. Anything else → Compose is effectively mandatory |
| 3 | **Access method** (SSH key / jump host / VPN) | Determines how the human reaches it and whether an agent ever could | Shapes nothing in the design; blocks execution |
| 4 | **Docker + Compose permitted?** | **The install-method branch (OQ-24)** | Yes → §12.5a (recommended). No → §12.5b |
| 5 | **CPU / RAM / disk available** | Whether the topology + Keycloak fits | See ADR 0008 Decision 4 sizing. At the 4 vCPU/8 GB floor, Keycloak moves off-host |
| 6 | **Root / sudo available?** | Every step needs privilege | Without it the package cannot proceed at all |
| 7 | **Is the host shared?** | Risk posture; port conflicts (80/443/3306/6379/162/514) | Shared → native install is high-risk; Compose contains the blast radius; a shared host may warrant not installing here |
| 8 | **Lab/disposable or protected?** | **Decides whether any agent may connect (team-protocol §5)** | Protected → human executes everything, forever. Lab → a future decision *may* permit agent execution; not assumed here |
| 9 | TSDB choice + co-location (OQ-3) | Sizing, and whether the TSDB is a service in this topology | **RESOLVED: TimescaleDB, co-hosted here.** Counted in the ADR 0008 sizing table. RRD is kept alongside (OQ-4). Phase 1 still does no TSDB reads (ADR 0005), so no Phase 1 code changes |
| 10 | Keycloak co-host? (OQ-25) | Adds a service + sizing | Yes → +2 vCPU/+2 GB/+10 GB and two client registrations |
| 11 | TLS certificate source (DEP-6) | FR-56/FR-58 require HTTPS | Corporate CA, Let's Encrypt (needs inbound 80 + public DNS), or internal CA. **Self-signed is acceptable for the POC only** and then the BFF's trust store needs the CA — a real configuration step, not a footnote |
| 12 | SNMP reachability: can the host reach the simulators over UDP 161? | FR-58's "≥1 simulated device discovered and polled" | If the simulators run on the developer's machine behind NAT, the engine cannot poll them — the simulators must then run **on** the server or in a routable location. **This is the most-likely-to-surprise item in the package** |

### 12.3 Service topology (FR-54)

Every service FR-54 names, with its role and where it comes from:

| Service | Role | Compose branch | Native branch |
|---|---|---|---|
| **MariaDB** | LibreNMS relational store (schema owned by LibreNMS; never hand-altered — §8.1) | `db` service, pinned image, `innodb_file_per_table=1`, `lower_case_table_names=0`, `utf8mb4` | `apt install mariadb-server` + the same two `[mysqld]` settings the docs require |
| **Redis** | Poller queue + LibreNMS cache. *Separate logical use from the BFF's own Redis session store (§8.1) — do not share a database index* | `redis` service, pinned | `apt install redis` (docs install `python3-redis` for the dispatcher) |
| **Web server + PHP-FPM** | Native UI + REST API. **PHP ≥8.4 (8.5 recommended)** per the docs | Inside the official image — **PHP version problem solved** | Nginx + `php8.5-fpm` with a dedicated `librenms` pool; older distros need the `packages.sury.org` repo |
| **Dispatcher / poller** | Discovery, polling, alerting, services (replaces cron) | `dispatcher` service, `SIDECAR_DISPATCHER=1` | `misc/librenms.service` + `rm /etc/cron.d/librenms`; keep `librenms-scheduler.timer` |
| **RRDCached** | Absorbs RRD write I/O. **≥1.5.5 required** (below that a shared filesystem becomes mandatory); set `rrdtool_version` to the exact version | **Added by us — not in the official compose file** | `apt install rrdcached` + `/etc/default/rrdcached` per the docs |
| **snmptrapd** | UDP 162 trap receiver | `snmptrapd` sidecar | Manual install + LibreNMS trap config |
| **syslog-ng** | UDP/TCP 514 syslog receiver | `syslogng` sidecar | Manual install + LibreNMS syslog config |
| **snmpd + MIBs** | Lets LibreNMS monitor **itself** (the docs' recommended first device) | On the host, from `snmpd.conf.example`; community string is a **secret — runtime only** | Same |
| **TLS / authenticating reverse proxy** | HTTPS termination **and** the SSO bridge (§12.4) | **Added by us** — the official example publishes plain `8000/tcp` | **Added by us** — the docs explicitly do not cover HTTPS |
| **TimescaleDB** | Metric destination (FR-04); BFF reads from Phase 2. **OQ-3 resolved.** Internal network only — never published; no browser→TSDB path (ADR 0002). The LibreNMS→Timescale write path is **verified at Task 0.6 Step 6, not assumed** (ADR 0005 rev 2) | Pinned `timescaledb` service | `apt`/repo install, loopback bind |
| **Keycloak (+ DB)** | POC IdP. **OQ-25 resolved: co-hosted** — but only if discovered specs **exceed** 4 vCPU / 8 GB; at or below, STOP and flag to the human before installing it | Added service, reachable via the proxy over 443 only | Added service, loopback bind |

**Deviations from the official compose example, and why** (FR-55 requires a *repeatable* install, and these are what make it so):

1. **Every image pinned** to an explicit version/digest. The official example uses `librenms/librenms:latest` and `crazymax/msmtpd:latest`; `latest` means two `up -d` runs a month apart build different systems, which defeats FR-55 as surely as an undocumented manual install does. Also required by the repo's Docker rules.
2. **RRDCached added** (FR-54 names it; upstream omits it).
3. **TLS proxy added**; LibreNMS's own port is **not** published to the host.
4. `cap_add: NET_ADMIN, NET_RAW` **retained with justification** — required for fping/SNMP. No privileged mode, no Docker socket mount.
5. **No secrets in the committed manifest** — `.env` on the server only, git-ignored, `.env.example` carries placeholders (NFR-09).

### 12.4 SSO into the native UI (FR-57) — a corrected premise, flagged as security-relevant

**FR-57 as written cannot be satisfied literally, and this is the most important finding of the revision.** FR-57 asks for "`auth_mechanism` plus OIDC client parameters"; ADR 0003 assumed LibreNMS could be configured as an OIDC client via `config.php`. The official authentication documentation lists the available modules — `mysql`, `active_directory`, `ldap`, `radius`, `http-auth`, `sso` — and **there is no OIDC module**; only one may be enabled at a time. LibreNMS's `sso` mechanism is a **header / environment-variable** mechanism written for a relying party in front of it (the docs name Shibboleth, ADFS, mod_auth_mellon, oauth2-proxy).

**Design position (ADR 0008 Decision 3):** `auth_mechanism = sso`, with an **OIDC-authenticating reverse proxy** in front of the native UI. The proxy is the OIDC client — that is where ADR 0003's client parameters and the runtime-injected client secret actually live (FR-57, NFR-09). It authenticates against the IdP and passes identity to LibreNMS, which auto-provisions via `sso.create_users` / `sso.update_users` (FR-16, AC-A#4/#5).

Configuration shape (values are configuration, secrets are runtime-injected, nothing here is committed with a real value):

```
auth_mechanism            = sso
sso.mode                  = env            # or header, per proxy
sso.create_users          = true           # FR-16 / AC-A#4
sso.update_users          = true           # AC-A#5 — level re-evaluated per login
sso.group_strategy        = map
sso.group_attr            = <IdP groups claim>
sso.group_level_map       = {"nms-admin":10, "nms-engineer":10|1, "nms-operator":1, "nms-readonly":1|5}
sso.static_level          = 0              # NO match -> NO access. Leave at 0 (fail-closed)
sso.trusted_proxies       = ["<proxy address ONLY>"]
sso.auth_logout_handler   = <proxy sign-out URL>
sso.email_attr / realname_attr = <claims>
```

**Security-relevant, flagged explicitly per my hard rules — this is the highest-severity item in the deployment package:**

| Item | Requirement | Consequence if missed |
|---|---|---|
| **LibreNMS must be unreachable except through the proxy** | Bind to loopback/container network; **never** publish its port to the host or network | **Anyone who can reach LibreNMS directly can assert `admin` by setting one header.** Authentication bypass, Critical. The docs say it outright: "prevent end users from contacting LibreNMS directly" |
| `sso.trusted_proxies` = the proxy address only | Never `0.0.0.0/0`, never a broad range | Same bypass |
| The proxy **strips** inbound identity headers before setting its own | Explicit strip rule, not a default assumption | A user-supplied header reaches LibreNMS as identity |
| `sso.static_level = 0` | Fail-closed on unmapped groups | Any authenticated principal silently gets access — the architecture reference's `default_level = 1` mistake, which ADR 0003 already rejects |
| Client secret injected at runtime | FR-57, NFR-09 | Secret in the repo |
| Logout handler configured | The docs: "LibreNMS has no capability to log out a user authenticated via Single Sign-On" | **AC-A#7 silently fails** — the native UI never logs out. Interacts with OQ-5, which was right to stay open |

`./scripts/auth_test.php` (from the docs) is the verification tool for the mechanism itself.

### 12.5 Install branches (OQ-24)

**§12.5a — Compose. THE METHOD (OQ-24 resolved).** Vendor `github.com/librenms/docker` `examples/compose`, pin every image, add RRDCached + TLS/auth proxy (+ Keycloak if OQ-25), keep secrets in a server-side `.env`. Reproduction after host loss is one command. Full reasoning: ADR 0008 Decision 1.

**§12.5b — Native. FALLBACK for one discovered fact only** (Task 0.1 found Docker/Compose v2 unavailable, and the human chose native over installing Docker). Not dead, not the plan of record. The documented procedure: packages → `librenms` user → `git clone /opt/librenms` → permissions/ACLs → `composer_wrapper.php install --no-dev` → timezone → MariaDB → PHP-FPM pool → Nginx vhost → snmpd → dispatcher service → logrotate → `/install` web installer → `./validate.php`. **FR-55's "repeatable" is not satisfied by a runbook on this branch** — the procedure is a sequence of manual file edits, so honest compliance means wrapping it in configuration management (Ansible or equivalent), which is why this branch costs 3–4 days more. Saying a numbered list is "repeatable" would be self-deception.

### 12.6 Network access (FR-56) — nothing else exposed

Default-deny; only these:

| Direction | Port/Proto | Peer | Purpose | Notes |
|---|---|---|---|---|
| Inbound | **443/TCP** | Operators, BFF host | HTTPS: native UI + REST API | The **only** inbound TCP from users. TLS terminates at the proxy |
| Inbound | 80/TCP | — | **Only** if ACME/Let's Encrypt is used, and then it redirects to 443 | Otherwise **closed** |
| Inbound | **162/UDP** | Managed devices / simulators | SNMP traps | Restrict source to the device ranges |
| Inbound | **514/UDP** (and TCP if used) | Managed devices / simulators | Syslog | Restrict source |
| Inbound | 22/TCP | Human's admin origin / jump host | Administration | Source-restricted; the human's access path |
| **Outbound** | **161/UDP** | Managed devices / simulators | SNMP polling | The engine's primary job |
| Outbound | ICMP | Devices | Availability (fping) | |
| Outbound | 443/TCP | IdP, package/image registries | OIDC discovery/JWKS; updates | |
| Internal only | 3306, 6379, rrdcached socket, LibreNMS HTTP | — | **Never exposed off-host** | MariaDB/Redis/LibreNMS bound to loopback or the container network. Publishing 3306 or LibreNMS's own port defeats §12.4 |

**BFF host → LibreNMS API (FR-56):** over 443 to the same proxy, authenticated with the LibreNMS API token held **only** by the BFF (ADR 0002). This is a distinct concern from §12.4's user SSO: the API token path is machine-to-machine and must not traverse the interactive OIDC proxy flow — the proxy configuration must therefore exempt `/api/` from the interactive redirect while still requiring the token. Getting this wrong produces an API that redirects the BFF to a login page instead of answering.

**Still prohibited, unchanged (ADR 0002, CON-6):** no browser-reachable `/api/v0/` proxy with a global token; no browser→TSDB. Nothing in this package reintroduces either — the proxy added here is an *authenticating* front door for the native UI, not a credential-injecting data proxy for the browser, and it injects **no** LibreNMS API token.

### 12.7 Deployment verification (FR-58) — the Phase 0 gate

Every check has an expected observable result — originally because the human ran them and reported back, and now additionally because **expected-vs-actual is the evidence contract** for agent execution. Full command sequence: plan Task 0.6.

| # | Check | Expected result | Requirement |
|---|---|---|---|
| 1 | `./validate.php` (the docs' own tool) | No failures | FR-54/55 |
| 2 | All services up | Compose: all healthy. Native: `systemctl is-active` on each unit | FR-54 |
| 3 | HTTPS reachability | Native UI over **HTTPS**, valid chain (or the POC CA trusted) | FR-56, FR-58 |
| 4 | **No unintended exposure** | External port scan shows **only** 443 (+22, +162/514 UDP). **3306, 6379 and LibreNMS's own port MUST NOT answer** | FR-56 |
| 5 | REST API authenticated call | `GET /api/v0/system` with `X-Auth-Token` → JSON. **And: without the token → 401, not 200** | FR-58 |
| 6 | ≥1 simulated device discovered **and polled** | Device present, status up, **and a second poll cycle shows advancing counters** — presence alone does not prove polling | FR-58 |
| 7 | Metrics landing | RRD files updating **and** a recent-row count **> 0** in TimescaleDB. A count of 0 is a **FAIL**, not a warning — it means LibreNMS writes RRD only and every Phase 2 chart would query an empty store | FR-04, FR-58 |
| 8 | Traps + syslog received | Send a test trap/syslog message; it appears in LibreNMS | FR-56 |
| 9 | SSO end-to-end | Login at the native UI via the IdP with no second credential prompt; user auto-created at the mapped level; **`sso.static_level=0` rejects an unmapped user**; logout re-prompts | FR-57, AC-A#3/#4/#5/#7 |
| 10 | **Header-injection negative test** | A request to LibreNMS **bypassing the proxy** with a forged identity header **fails** | §12.4 — Critical if it passes |
| 11 | BFF host reaches the API | From the BFF host: authenticated API call succeeds; `/api/` is **not** redirected to a login page | FR-56 |
| 12 | `LIBRENMS_BASE_URL` recorded | Set in the developer's runtime config; **never committed with a real value** | FR-58, NFR-09 |

Checks 4, 5 (negative half), 9 (unmapped half) and **10** are negative tests. They exist because a deployment that passes only its positive checks has demonstrated that it works, not that it is safe.

### 12.8 Rollback

- **Compose branch:** `docker compose down`; volumes are the only persistent state. Rebuild from the pinned manifest. This is the branch with a real rollback story.
- **Native branch:** no clean uninstall — packages, users, and config are spread across the host. Rollback means a host snapshot **taken before starting** (step 1 of §12.5b) or a rebuild. **This asymmetry is itself an argument for Compose**, and a reason the shared-host answer to OQ-23 matters so much.
- **Reversible/irreversible:** IdP client registration is additive and removable. Data loss risk is confined to the MariaDB volume and RRD files, which hold only POC data.

---

## 13. Design self-review

- **Placeholders:** none. Every section states a concrete position or an explicitly-flagged open question with a recommendation.
- **Internal consistency:** the module layout (§2) matches ADR 0001; the auth design (§5) matches ADR 0003; the route table (§4.2) covers exactly the Phase 1 FRs claimed in §0 and no more; the deferred list in §0 matches the later-phase rows in §6.
- **Scope:** Phase 0 + Phase 1 only, as instructed. Phase 2/3 items appear only where a decision made now would otherwise foreclose them (ADR 0005 port, ADR 0006 transport, `unavailable` type).
- **Ambiguity:** the two places a reader could reasonably diverge are pinned — `/health` and `/ready` are the only unauthenticated endpoints (§3.3), and acknowledgment failure never produces a local success record (§5.3).
- **Requirements not designed:** all traced to a named open question in §9 rather than left silent.

### 13.1 Revision-2 self-review (the deployment package)

- **Placeholders:** none. Every unknown host fact is an explicitly-numbered blocking input in §12.2, not a guessed value or a "TBD".
- **Internal consistency:** §12 matches ADR 0008; the revised §3.2 no longer claims a local Docker LibreNMS; the §9 rows for OQ-22/23/24/25 match §12's positions; the §11 estimate carries the deployment line items §12 implies.
- **Preserved v1 decisions:** ADR 0001, 0002, 0004, 0005, 0006, 0007 are untouched. ADR 0002's prohibitions are re-affirmed in §12.6 — the proxy added here authenticates users and injects **no** API token, so it is not the rejected pattern returning under a new name. I checked this deliberately, because "add a reverse proxy in front of LibreNMS" is superficially close to the thing we rejected.
- **One forced change, stated rather than buried:** FR-57's premise (LibreNMS as an OIDC client) is contradicted by the official documentation. ADR 0003's auto-provisioning paragraph is amended by ADR 0008 Decision 3. This is the only v1 decision the revision alters, and it is a correction of fact, not a change of preference.
- **Scope:** the package is deployment design plus an **agent-executable runbook with an evidence contract** (revision 3; was: a human-runnable runbook). It does **not** silently absorb: distributed polling (Phase 3), TSDB vendor selection (OQ-3), production identity (explicitly out — OQ-25 is POC-grade), or 5,000-device capacity (contradicted by the docs' own 1,000+ single-instance guidance).
- **Ambiguity:** the two places a reader could diverge are pinned — the install method **branches** on OQ-23's Docker answer rather than being silently chosen, and "repeatable" (FR-55) is defined per branch, with the native branch's honest cost stated.

