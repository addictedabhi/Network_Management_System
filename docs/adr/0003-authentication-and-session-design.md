# 0003. Authentication and session design (BFF-mediated OIDC with server-side session)

- **Status:** Proposed (awaiting human approval at G2). **Contains an assumption requiring human confirmation — see OQ-2.** **AMENDED 2026-08-09 by ADR 0008 Decision 3 — see the note below.** **AMENDED 2026-08-09 (F-5) — SSO activation/cutover design added; see the F-5 amendment below.** **AMENDED 2026-08-09 (OQ-7 CLOSED) — role→level values finalized by the human; see the OQ-7 note below.**
- **Date:** 2026-08-09
- **Deciders:** Human (approver), Technical Architect (author)
- **Work item:** `nms-platform-foundation`
- **Relates to:** FR-10..19, FR-40, FR-42, NFR-11..14, NFR-17, AC-A#1..8, OQ-2, OQ-5, OQ-7, OQ-10

> ## OQ-7 CLOSED (human decision, 2026-08-09) — role→LibreNMS-level values are final
>
> The two cells the F-5 cutover left pending are now decided by the human:
>
> | Keycloak group / role | LibreNMS level (FINAL) |
> |---|---|
> | `nms-admin` / `admin` | **10** (administrator) |
> | `nms-engineer` / `engineer` | **10** (administrator) — engineers get full native-UI access |
> | `nms-operator` / `operator` | **1** (normal user) — per the role table |
> | `nms-readonly` / `readonly` | **5** (global-read) — read-only with full visibility |
> | group present but unmapped / native-mechanism default | **1** (group-mapping fallback) |
> | no matching SSO group at all | **0 / no access** (`sso.static_level = 0`, fail-closed) |
>
> So the operative `sso.group_level_map` is `['nms-admin'=>10,'nms-engineer'=>10,'nms-operator'=>1,'nms-readonly'=>5]`, group-mapping fallback = 1, SSO no-match = 0. **OQ-7 is CLOSED.** The "proposed" annotations in the Role-mapping table below (`engineer`→1, `readonly`→1) are SUPERSEDED by these values; the table is retained as the original proposal for history. Note the FR-42 "Open Admin Portal" / FR-33-34 acknowledge columns below are platform-UI authorization decisions, unchanged by the level values — the LibreNMS *level* governs native-UI access, the platform role governs custom-UI capability. Detail: `docs/design/nms-platform-foundation-deployment-findings.md` §F-5 (§3 mapping table).

> ## F-5 amendment (2026-08-09) — SSO is configured fail-closed but NOT activated; activation design + controlled cutover
>
> **Deployment state (measured):** `auth_mechanism` is still `mysql`. `~/nms/config/config.php` already carries `sso.static_level=0`, `sso.mode=header`, `sso.trusted_proxies=["10.89.0.52"]`, and a group→level map — but the mechanism was deliberately not switched and **no Keycloak realm/OIDC client was registered** (Keycloak is on the default `master` realm only). Flipping `auth_mechanism` blind would lock everyone out, including recovery paths. The nginx header-injection strip (FR-58 check 9b) passes **independently** of SSO state and is unchanged. Evidence: `task-0.2-0.6-deployment-evidence.md` (F-5).
>
> **This amendment does not change the auth *design* below — it specifies its *activation*.** The BFF flow, opaque Redis session, token validation, role map, and fail-closed rule all stand. What F-5 adds is the realm/client design and a controlled cutover with a break-glass fallback so a misconfiguration cannot lock out all access. Full detail: `docs/design/nms-platform-foundation-deployment-findings.md` §F-5.
>
> **1. Dedicated realm.** Create a **`nms` realm** (NOT `master` — `master` is Keycloak's own admin realm; app clients/groups there couple app identity to Keycloak administration). It holds the four groups and both OIDC clients. A later corporate-IdP swap stays a config change (issuer/client/group-claim), not a redesign — ADR 0003 is IdP-agnostic.
>
> **2. Two clients.** `nms-custom-ui` (confidential, the BFF, Auth-Code+PKCE, `redirect_uri` MUST carry `:8443` and match exactly — registered now, flow not exercised until Task 10). `nms-native` (confidential, the `oauth2-proxy` in front of the LibreNMS native UI — the actual OIDC client, secret runtime-injected, header-strip on, `/api/` exempt from interactive redirect).
>
> **3. Group→level map (OQ-7 CLOSED — see the OQ-7 note above):** `nms-admin`→10; `nms-engineer`→**10**; `nms-operator`→1; `nms-readonly`→**5**; group present but unmapped → **1** (mapping fallback); **no match → `static_level=0` → NO access** (fail-closed; never the arch-ref `default_level=1` mistake). `sso.create_users`/`update_users=true` (FR-16); level re-evaluated each login (AC-A#5). **No cells remain pending.**
>
> **4. Exact config.php cutover line** (the `sso.*` keys are NOT in `config_definitions.json`, so they live in `config.php`, not `lnms config:set`): flip `$config['auth_mechanism'] = 'sso';` (currently `'mysql'`) **LAST**, only after the sequence below passes. `oauth2-proxy` env (server-side `.env`, never committed): `OIDC_ISSUER_URL=https://10.121.77.206:8443/auth/realms/nms`, client `nms-native`, runtime secret.
>
> **5. Controlled cutover with break-glass:** (1) create a **local `mysql`-mechanism admin** (break-glass) BEFORE touching `auth_mechanism`; (2) register realm + clients + groups; (3) **verify isolation FIRST** (plan Task 0.5 Step 3 — datastores/LibreNMS have no direct host listener; `sso` on a directly-reachable LibreNMS is an auth bypass — the only boundary on 0.4c); (4) stand up the proxy as OIDC client; (5) **dry-run `auth_test.php` while still on `mysql`** to confirm each group resolves to its level (engineer→10, readonly→5, operator→1, admin→10) and unmapped→0; (6) **flip `auth_mechanism=sso`** last; (7) verify login/auto-provision/unmapped-denied/logout-re-prompt AND break-glass still works; (8) **rollback = revert to `mysql` and reload** — always available because of step 1, one reversible step (load-bearing on this snapshot-waived host). `sso.auth_logout_handler` → proxy sign-out URL is the only reason AC-A#7 can pass (LibreNMS cannot itself log out an SSO user).
>
> **No privileged operation is required** — all of this is `config.php` edits, `lnms`/`podman exec`, and Keycloak realm admin, within the rootless/no-sudo envelope.

## Context

FR-10..19 require one IdP session spanning the custom UI and the native LibreNMS UI, Authorization Code + PKCE (FR-11), tokens absent from `localStorage`/`sessionStorage` (FR-12), server-side token validation against JWKS including `iss`/`aud`/`exp` (NFR-14), IdP group claims mapped to platform roles and LibreNMS levels (FR-15), auto-provisioning in LibreNMS on first login (FR-16), silent refresh (FR-17), and RP-initiated logout (FR-18).

There are two independent OIDC clients here — the custom UI and LibreNMS — and this ADR covers only the platform's own client plus the mapping into LibreNMS. LibreNMS's own OIDC configuration is `config.php`/environment configuration, never a core patch (FR-13, FR-07).

## Considered options for where the OIDC flow lives

### Option A — OIDC in the browser via `oidc-client-ts` (as the architecture reference §4.2 shows)
The reference initialises a `UserManager` in client-side JavaScript and passes `Authorization: Bearer <token>` from the browser.

- **Rejected.** Even with PKCE, this places the access token in browser-reachable JavaScript, and the reference's own `automaticSilentRenew` requires a persistent token store — in practice `localStorage` or `sessionStorage`, which FR-12 forbids outright. In-memory-only token storage in a browser SPA also breaks on page reload, which pushes implementers straight back to web storage. The requirement's constraint and this approach are fundamentally in tension.

### Option B — BFF-mediated flow with an opaque server-side session (SELECTED)
The BFF performs the entire Authorization Code + PKCE exchange. The browser receives only an opaque session cookie. Tokens live server-side.

- **Pro:** satisfies FR-12 exactly and trivially — there is no token in the browser to store anywhere, so AC-A#2 passes by construction rather than by discipline.
- **Pro:** NFR-14's validation is inherently server-side, in one place.
- **Pro:** silent refresh (FR-17) happens server-side against the stored refresh token, with no browser-visible mechanism and no hidden-iframe fragility.
- **Pro:** logout (FR-18) can destroy the server-side session *and* redirect to the IdP's `end_session_endpoint`, so a stolen cookie stops working immediately rather than at token expiry.
- **Con:** the BFF becomes stateful. Addressed below.

### Option C — Encrypted-JWT session cookie (stateless)
Session state encrypted into the cookie itself.

- **Rejected for this design.** Tokens would then sit in the browser, merely encrypted — and a cookie cannot be revoked server-side, so logout could not reliably invalidate a session before expiry, weakening FR-18/AC-A#7. It also pushes the cookie toward the 4 KB limit once refresh tokens are included.

## Decision

**Option B.** The BFF is a confidential OIDC client performing Authorization Code flow with PKCE (`code_challenge_method=S256`, satisfying AC-A#1), with:

- **Session store:** Redis (already a project dependency, DEP-4), keyed by a high-entropy opaque session ID generated with Node's `crypto.randomBytes` — never `Math.random`. The session record holds the access token, refresh token, ID-token claims, resolved platform role, and the IdP `sid` for logout correlation.
- **Cookie:** `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only. `Lax` rather than `Strict` because the OIDC redirect returns via a cross-site top-level GET, which `Strict` would strip, breaking the callback. `Lax` still blocks cross-site POST, which is what matters for the acknowledgment write path; CSRF for state-changing routes is additionally covered by requiring a custom header that a cross-site form cannot set.
- **Token validation (NFR-14):** signature verified against the IdP's JWKS with cached keys and bounded refresh, plus explicit `iss`, `aud`, `exp` checks, and `nonce` binding for the ID token. Validation failure is a 401 with no data — the four separate checks AC-A#6 enumerates.
- **State/PKCE integrity:** `state` and the PKCE verifier are stored server-side against a short-lived pre-session record and compared on callback. A callback with an unknown or reused `state` is rejected. This closes the reference's omission (the reference's config sets no `state` handling at all).
- **Refresh (FR-17):** the BFF refreshes proactively when the access token is within a skew window of expiry, during request handling. On refresh failure the session is destroyed and the browser receives a 401 carrying a machine-readable `SESSION_EXPIRED` code, which the UI turns into a redirect to login rather than a broken view.
- **Logout (FR-18):** destroy the Redis session, clear the cookie, then redirect to the IdP `end_session_endpoint` with `id_token_hint` and `post_logout_redirect_uri`.
- **Rate limiting (NFR-17):** the `/auth/callback` route and all write routes are rate-limited per session and per source address.

### Role mapping (FR-15) — ORIGINAL PROPOSAL (OQ-7 now CLOSED — see the OQ-7 note at top; the level column here is SUPERSEDED)

The mapping is **configuration, not code** — a validated environment-supplied map, so changing it never requires a deployment of new logic:

| IdP group (proposed) | Platform role | Acknowledge alarms (FR-33/34) | "Open Admin Portal" shown (FR-42) | LibreNMS level (proposed → **FINAL**) |
|---|---|---|---|---|
| `nms-admin` | `admin` | yes | yes | 10 (administrator) → **10** |
| `nms-engineer` | `engineer` | yes | yes — **OQ-7 asked precisely this; CLOSED = yes** | 1 (normal user) → **10 (OQ-7 CLOSED)** |
| `nms-operator` | `operator` | yes | no | 1 (normal user) → **1** |
| `nms-readonly` | `readonly` | **no — 403 server-side** | no | 1 (normal user) → **5 (OQ-7 CLOSED)** |

A user whose claims match no mapped group is **denied access entirely** (fail-closed), not defaulted to `readonly`. Defaulting an unmapped identity to any level of access is how unintended access is granted quietly. Note this deliberately differs from the architecture reference's `$config['sso']['default_level'] = 1`, which auto-grants normal-user access to any SSO-authenticated principal. (The "group present but unmapped → 1" mapping fallback is distinct from the SSO no-match case, which stays at 0/no-access — see the F-5 §3 terminology note in the findings design doc.)

**LibreNMS auto-provisioning (FR-16)** uses LibreNMS's supported `sso` auth mechanism with `create_users`/`update_users` enabled, driven by the same claim-to-level map, configured via `config.php`/environment only (FR-13, FR-07). Level is re-evaluated on each login so an IdP group change is reflected (AC-A#5).

> **AMENDMENT (2026-08-09, ADR 0008 Decision 3) — a premise above was wrong.** The paragraph as originally written implies LibreNMS can be configured as an OIDC client through `config.php`. The official LibreNMS authentication documentation (retrieved 2026-08-09) lists the available modules as `mysql`, `active_directory`, `ldap`, `radius`, `http-auth`, and `sso` — **there is no OIDC module**, and only one may be enabled at a time. The `sso` mechanism is a **header / environment-variable** mechanism intended for a relying party sitting in front of LibreNMS.
>
> **The corrected design:** `auth_mechanism = sso` behind an **OIDC-authenticating reverse proxy**, which is the actual OIDC client and holds the runtime-injected client secret. Everything else in this ADR stands unchanged — the BFF's own flow, the opaque Redis session, token validation, the role map, and the fail-closed rule (which maps onto `sso.static_level = 0`). Two consequences worth carrying forward: (1) **two** OIDC clients are needed, not one — `nms-custom-ui` for the BFF plus one for the proxy; (2) the docs state LibreNMS "has no capability to log out a user authenticated via Single Sign-On", so `sso.auth_logout_handler` must point at the proxy's sign-out URL or **AC-A#7 silently fails**. See design §12.4 for the security controls this makes mandatory. OQ-7 should also reconsider level `5` (`global-read`) for the `readonly` role. **[F-5 amendment operationalises this; OQ-7 note at top CLOSES it: readonly=5, engineer=10.]**

## Assumptions requiring human confirmation at G2

- **OQ-2 (BLOCKING for implementation, not for this design):** this ADR assumes an OIDC-compliant IdP exists with admin access to register two clients (`nms-custom-ui` confidential, `nms-native` confidential) and to define the four groups above, and that it exposes standard discovery (`/.well-known/openid-configuration`), JWKS, and an `end_session_endpoint`. The design is IdP-agnostic and depends on no Keycloak-specific feature. **If no IdP exists, standing one up is a prerequisite task and Phase 1 cannot complete** — the estimate in the design doc flags this. **[F-5: Keycloak is deployed but on `master` only; the `nms` realm + clients are the outstanding activation work.]**
- **OQ-5:** assumed that RP-initiated logout at the IdP plus destruction of the platform session is sufficient, and that the LibreNMS PHP session is additionally terminated by hitting LibreNMS's own logout. AC-A#7 requires re-authentication at *both* UIs, so this must be verified rather than assumed correct.
- **OQ-7 — CLOSED (human, 2026-08-09):** the role/level table is finalized — `nms-engineer`→**10** (full native-UI access), `nms-readonly`→**5** (global-read), `nms-operator`→**1**, `nms-admin`→**10**, group-mapping fallback→**1**, SSO no-match→**0**. See the OQ-7 note at the top of this ADR. No cells remain pending.
- **OQ-10:** proposed 30-minute idle timeout and 8-hour absolute session lifetime (FR-19), both configuration values.

## Consequences

**Positive:** FR-12 and AC-A#2 hold by construction; sessions are revocable; one server-side validation point; role changes are configuration.

**Negative:** the BFF requires Redis to serve authenticated traffic — a Redis outage logs everyone out, and `/ready` must therefore report Redis health (NFR-21). Horizontal BFF scaling requires the shared Redis session store, which this design already assumes.

**Neutral:** the browser holds no token, so any future need for a browser-held token (e.g. a third-party API called directly from the client) would require revisiting this ADR rather than bolting on an exception.
