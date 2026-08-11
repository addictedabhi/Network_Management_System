# Design — deployment findings F-1, F-2, F-5 (nms-platform-foundation)

- **Status:** **DECISIONS FINALIZED (2026-08-09).** F-2 is decided by the human = **Option (b), InfluxDB v2** (recorded in ADR 0009 ACCEPTED, ADR 0005 rev 3-b). F-1 (source-IP topology split) and F-5 (SSO cutover with break-glass) are Architect-owned designs, accepted. **OQ-7 role→level is CLOSED:** `nms-engineer`=**10**, `nms-readonly`=**5**, `nms-operator`=**1**, `nms-admin`=**10**, unmapped/native-fallback=**1** for group-mapping and **0/no-access** as the SSO `static_level` fail-closed default (see the F-5 §3 clarification). Gate posture: amend-and-proceed under the existing G2; the FR-58 re-run is the quality gate. The procedures below are unchanged and empirically grounded — this status block records the decisions that resolve the previously-pending cells.
- **Date:** 2026-08-09
- **Author:** Technical Architect
- **Work item:** `nms-platform-foundation`
- **Inputs (measured facts, not inference):** `.claude/team/artifacts/nms-platform-foundation/deployment/task-0.2-0.6-deployment-evidence.md`; reconciliation queue items 15/16/17.
- **Relates to:** ADR 0005 (F-2, now rev 3-b), ADR 0003 (F-5), ADR 0008 (deployment topology), ADR 0002 (BFF-only data path), ADR 0009 (F-2 decision record, now ACCEPTED).
- **Doc-only.** Nothing here is executed. No manifest under `deploy/` is edited (maker's tree). No code under `packages/`/`scripts/` is touched (G3-clean, awaits G4).

> **Terminology on the two "fallback" values (they are different things, do not conflate them):**
> - **Group-mapping fallback = 1.** When an authenticated principal carries a group that is *present but not in* `group_level_map`, or the platform must assign a native-mechanism default level, that is **level 1** (normal user).
> - **SSO fail-closed default = 0 / no access.** When an SSO principal matches **no** mapped group at all, `sso.static_level = 0` denies access entirely. This is the fail-closed rule and is NOT the same as the level-1 mapping fallback. The dispatch's "unmapped/native-fallback = 1" refers to the group-mapping fallback; the SSO no-match case stays fail-closed at 0.

This is the brainstorming/design record required before the plan amendment. It states the problem for each finding, the options weighed, the honest trade-offs, and the decisions. F-2 was presented as a human decision with my recommendation; the human has now decided **Option (b)**.

---

## F-2 [HIGH] — no LibreNMS → TimescaleDB write path (contradicts ADR 0005 rev 2) — **DECIDED: Option (b), InfluxDB v2**

**DECISION (human, 2026-08-09):** switch the TSDB to **InfluxDB v2** (Option b below). TimescaleDB is dropped as the metrics store. Recorded in **ADR 0009 (ACCEPTED)** and **ADR 0005 (rev 3-b)**. The analysis that follows is retained as the decision record; the recommendation section notes which way the human went.

### The measured fact
LibreNMS 25.7.0 ships datastore drivers `Rrd, Graphite, InfluxDB, InfluxDBv2, Prometheus, OpenTSDB, Kafka` — and **no PostgreSQL/TimescaleDB driver**. The hypertable `nms_metrics`, its indexes, and the 14-day retention policy (job 1000, `drop_after 14 days`) are all correctly built and verified, but `SELECT count(*) FROM nms_metrics = 0`: nothing can write to them. TimescaleDB exposes no Influx or Graphite listener (`pg_extension` = `plpgsql, timescaledb`), so the two ends cannot speak.

This is the exact "less-travelled write path" ADR 0005 rev 2 Decision point 2 flagged as *verify-don't-assume*, now measured **absent**, not misconfigured. It invalidates the premise under which the human answered OQ-3 "TimescaleDB" at G2 — that LibreNMS could feed a SQL store the way it feeds Influx. The gap was invisible through G1/G2/G2.5/G3 because none of those stages touched a running LibreNMS.

### Why this is a human decision, not mine
OQ-3 was answered by the human at G2 and recorded in ADR 0005 rev 2 and team-config §8. Both options below either keep or change that answer. Changing it (Option b) reverses a human decision; keeping it (Option a) adds a deployable component and a new failure surface the human is accepting. Either way this returns to the human via Jarvis. I give a recommendation, not a resolution. **[The human decided Option (b).]**

### Option (a) — Graphite→TimescaleDB carbon bridge (keeps TimescaleDB) — NOT CHOSEN

LibreNMS's `Graphite` datastore emits plaintext carbon lines `metric value timestamp\n` over a TCP connection (`datastores.graphite.host`/`port`, default 2003). A small **carbon-protocol listener** — a new deployable container in the `~/nms` stack — accepts those lines, parses the LibreNMS metric-path convention, maps them onto the `nms_metrics` schema, and does batched `INSERT`s into TimescaleDB. LibreNMS is configured with `config:set datastores.graphite.enable true` (alongside RRD, which stays) pointed at the bridge's internal address.

- **Keeps the human's TimescaleDB choice** and, critically, keeps the SQL/PostgreSQL read surface that the design's `MetricsReader` port's future `TimescaleMetricsReader` adapter (Phase 2) targets. FR-26's 95th-percentile-in-SQL and FR-28's *reconcilable* argument (the reason SQL won at OQ-3) survive intact.
- **Cost — a new deployable component the Architect owns the failure modes of:**
  - **Schema mapping.** The carbon metric path (e.g. `librenms.<hostname>.<measurement>.<field>`) must be parsed into `nms_metrics`' columns (device/interface identity, metric name, value, ts). This mapping is a contract that has to be pinned and versioned; LibreNMS's Graphite path prefix/format is configurable (`datastores.graphite.prefix`) and must be fixed deliberately, not defaulted.
  - **Buffering & backpressure.** Carbon is fire-and-forget TCP. If the bridge or TimescaleDB is slow/down, the bridge must buffer bounded and drop-with-a-counter rather than grow unbounded (this is a shared-disk host — an unbounded buffer is exactly the co-tenancy hazard the retention precondition exists to prevent). It must never block LibreNMS's poller loop.
  - **Failure visibility.** A silently-dead bridge reproduces F-2 (count stays flat) while every port looks open — the same "looks healthy, isn't" trap as F-1. It needs a health signal the `MetricsReader.checkHealth()` / `/ready` path can see, and a row-arrival metric.
  - **New attack/ops surface.** One more container, one more pinned image, one more thing in the teardown list, one more component in the co-tenancy footprint.
- **Plan impact:** a new Task-0.2 manifest step (bridge container, internal-only, never published — ADR 0002 holds), a new Task-0.6 verification (row count > 0 **through the bridge**, plus a bridge-down buffering test), and a plan amendment. The bridge is a **new team-owned deployable** — it is code, so it needs its own G-cycle (design/plan/build/review/test) if built in this work item, or it is deferred with the write path explicitly marked unverified.

### Option (b) — switch TSDB to InfluxDB v2 (LibreNMS-native, no bridge) — **CHOSEN**

LibreNMS ships `InfluxDBv2` as a first-class datastore. Configure `config:set datastores.influxdbv2.*` (URL, org, bucket, token) and LibreNMS writes natively over the line protocol. Replace the `timescaledb` container with an `influxdb:2.x` container (pinned); drop the carbon bridge entirely.

- **No bridge, no bespoke schema-mapping/buffering component**, so none of Option (a)'s failure modes are the Architect's to own — they move into a mature upstream product LibreNMS is designed to feed. This is the trodden path ADR 0005's own option analysis called "the better-trodden LibreNMS path."
- **Cost — reverses a human decision and changes downstream code shape:**
  - **Revises OQ-3 and ADR 0005** (human decision). The reasons SQL was chosen — 95th-percentile in commodity SQL (FR-26), and an operator being able to re-run a reconcilable query by hand (FR-28) — are given up. In Flux/InfluxQL those become a less-familiar query surface. This is the substantive loss and the human weighed it and accepted it.
  - **Changes the `MetricsReader` adapter target** from SQL (`TimescaleMetricsReader`) to Flux/InfluxQL (`InfluxMetricsReader`) — a Phase 2 task. **The `MetricsReader` port itself does not change** (see below), so this is choosing which single adapter gets written, not a refactor. ADR 0005 rev 1 explicitly named both adapter classes for exactly this reason.
  - **Influx version hazard.** ADR 0005 rev 1 already flagged the 1.x/2.x/3.x split as "a genuine versioning hazard that must be pinned deliberately." `InfluxDBv2` (not `InfluxDB` v1, not v3) must be the pinned target on both the LibreNMS config side and the container side.
  - **Adds an InfluxDB container in place of TimescaleDB** and removes the hypertable + retention SQL. Influx has its own retention (bucket retention period) — the 14-day precondition must be re-expressed as a bucket retention policy, and it is still a **precondition of first start** on this shared-disk host.

### Which the design already anticipates
The design's `MetricsReader` port (ADR 0005, design §8) is **vendor-neutral by construction** — "no Influx line-protocol type, no Flux/InfluxQL string, and no SQL fragment appears in any signature or in any caller," and ADR 0005 rev 1 names **both** `InfluxMetricsReader` and `TimescaleMetricsReader` as the possible single adapter. So the port anticipates *either* option; the choice selects which adapter is written in Phase 2. **Neither option forces a redesign of the port**, and neither touches Phase 1 (which does zero TSDB reads — only `checkHealth()`). This is precisely the seam ADR 0005 built to make OQ-3 survivable, and it is doing its job: an unverified integration assumption changed, and the blast radius is one adapter class plus one deployment component, not the architecture.

### Does either invalidate other approved decisions?
- **ADR 0002 / CON-6 (BFF-only data path, no browser→TSDB):** holds under both. The bridge (a) and Influx (b) are both internal-only, never published; the BFF remains the sole reader.
- **ADR 0008 sizing:** (a) adds a small bridge container (~0.25 vCPU / 0.25 GB); (b) swaps TimescaleDB's row for an InfluxDB row of comparable footprint. Neither breaches the floor already cleared 8×.
- **OQ-4 (keep RRD alongside):** holds under both — RRD stays for native-UI graphs; the TSDB (either vendor) is the second sink.
- **Retention precondition (team-config §8 amended guardrail 4):** holds under both but must be re-expressed for (b) as a bucket retention policy. It remains a **precondition of first start**.

### Recommendation (mine — the human decided)
**Option (a), the carbon bridge, IF the write path is built and verified in this work item; otherwise Option (b).** Reasoning:

- OQ-3's answer was chosen *for* SQL's reconcilability (FR-28) and percentile ergonomics (FR-26). Those reasons are still valid; the only thing that broke is the *transport*, and Option (a) restores the transport without discarding the reason the choice was made. Reversing a human decision because of a transport gap, when a documented transport (Graphite/carbon) exists, is a larger change than the problem requires.
- **But** Option (a)'s cost is honest and non-trivial: it is a new team-owned deployable with real failure modes (buffering, backpressure, mapping) that the Architect then owns. If the human's appetite is to minimise new bespoke components on a shared POC host, **Option (b) is the lower-total-risk choice** — it moves the write path into a product built for it, at the price of the SQL query surface.
- **The deciding question for the human:** how much do FR-26/FR-28's SQL ergonomics matter for this platform's long-term dashboards? If they are load-bearing → (a). If they are nice-to-have and operational simplicity wins → (b).

**OUTCOME: the human chose Option (b), InfluxDB v2** — operational simplicity / minimising bespoke components on the shared POC host won over the SQL ergonomics. Recorded in ADR 0009 (ACCEPTED) and ADR 0005 (rev 3-b).

---

## F-1 [HIGH] — source-IP attribution broken (topology fix, Architect-owned)

### The measured fact
The named `nms` bridge network publishes ports via **netavark + `rootlessport`**, a userspace proxy that **masquerades the source IP** (observed `SRC=10.89.0.53`, a container-network address). LibreNMS attributes traps and syslog **by source IP**, so every trap/syslog line is currently filed against **no device**, while every port check looks correct. The plan's Task 0.4c Step 5 fix (`rootless_port_forwarder="pasta"` in `containers.conf`) was applied and **proven ineffective on this topology** — `RootlessNetworkCmd=pasta` governs only the *default* pasta netns, not a named bridge, where netavark/rootlessport still masquerade. The deploy agent **proved** the real IP is preserved only under `--network pasta` (observed `SEEN=172.16.10.22`). This is the "config-present ≠ config-effective" defect class recorded in memory.

The plan's Step 5 text is therefore **wrong** and must be corrected — the `containers.conf` append does nothing for the named-bridge receivers and should not be presented as the fix.

### Constraints this must respect (deployment guardrails, team-config §8)
Rootless, **no sudo**, **no privileged ports** (traps stay 1162/udp, syslog 1514/udp), co-tenancy (nothing that touches Kafka/ZooKeeper/8077/5000/Samba, no account-wide `prune`/`disable-linger`), storage under `$HOME` (`/opt/airlinq/aqaillm/nms`), SELinux Enforcing (`:z`/`:Z` per sharing topology, no policy change). The rest of the stack must stay on the named bridge for aardvark-dns inter-container name resolution (the nginx resolve-per-request fix, F-4.3, depends on it).

### The design decision — split the network topology of the trap/syslog receivers only

Move **only** the two receiver sidecars — `nms-snmptrapd` (1162/udp) and `nms-syslogng` (1514/udp) — off the named `nms` bridge and onto **pasta networking** (`Network=pasta` in their quadlet units), which the deploy agent empirically proved preserves the real source IP. The remaining ~9 containers stay on the named `nms` bridge, keeping aardvark-dns name resolution and the nginx resolve-per-request behaviour intact.

The receivers still need to reach **MariaDB** (LibreNMS's DB) to write attributed events. Under pasta, a container reaches host-mapped services differently than on the shared bridge. Two sub-options for the receiver→MariaDB path, in order of preference:

1. **Preferred — receivers write via the LibreNMS pipeline, not directly to MariaDB.** In the official LibreNMS Docker topology, `snmptrapd` and `syslog-ng` are sidecars that feed LibreNMS's trap/syslog processing (via the shared DB / the librenms container's handlers) rather than owning a bespoke DB connection. If the receivers can reach the `librenms`/`db` service over pasta using pasta's host-address mapping (`--map-gw` / the pasta gateway address, e.g. reaching the bridge-published internal endpoint through the host namespace), the source IP is preserved on ingress and the downstream write path is unchanged. **This must be proven empirically** (per the F-1 lesson: prove identity-carrying network properties end-to-end, per topology), not assumed — exactly the mistake that produced F-1 in the first place.
2. **Fallback — a pasta pod for the two receivers plus a thin DB reachability path.** If (1) cannot reach MariaDB cleanly under pasta, place the two receivers in a single pasta-networked pod and give that pod a reachability route to the DB via pasta's `-T`/`-U` port-forwarding to the host-mapped MariaDB endpoint. More moving parts; use only if (1) fails the empirical probe.

### Why this preserves the rest of the stack's properties
- **Isolation check 9a (no host-side datastore listener) is unaffected:** the receivers publish only 1162/1514 (unprivileged, already in the 4-port budget); they do not publish MariaDB. The datastore-not-published invariant, which is now the *entire* boundary on 0.4c (no firewall), is untouched.
- **Inter-container DNS is preserved** for the ~9 bridge containers; only the two receivers change network mode.
- **The `:z` shared-RRD label topology (F-4.2) is unaffected** — the receivers are not RRD consumers.

### Does it need a privileged operation?
**No.** `Network=pasta` is the *default* rootless forwarder and needs no sudo, no privileged port (we keep 1162/1514), no capability beyond what the receivers already have, and no host-firewall change. pasta runs in the user namespace. This is a **quadlet-unit topology change, fully within the rootless/no-sudo envelope** — so per the dispatch it does **not** require a human decision. (It *would* if the only fix were binding 162/514 or a sysctl `ip_unprivileged_port_start` change — both need root — but the source-IP fix does not; those remain the separately-tracked FR-56 real-device limitation, unchanged.)

### Manifest / plan changes this implies (maker executes; I only specify)
- `deploy/librenms-podman/nms-snmptrapd.container`: `Network=nms` → `Network=pasta` (or a pasta pod per fallback).
- `deploy/librenms-podman/nms-syslogng.container`: same.
- The receiver→MariaDB reachability config for whichever sub-option the empirical probe supports.
- **Delete or comment the ineffective `~/.config/containers/containers.conf` `[network] rootless_port_forwarder="pasta"` block** — the evidence marks it "ineffective, safe to delete." Leaving it implies a fix that isn't there.
- **Plan:** correct Task 0.4c Step 5 (the `containers.conf` append is NOT the fix for named-bridge receivers), add the receiver-network-split as the real fix, and strengthen Task 0.6 Step 7 to assert **attribution** (event filed against the correct device), not mere receipt — with the source-IP probe re-run **per topology on the actual receiver units**, not on a throwaway `--network pasta` probe container.

---

## F-5 — SSO configured fail-closed but NOT activated (Architect-owned design; controlled cutover)

### The state
`auth_mechanism` is still `mysql`. `~/nms/config/config.php` already carries `sso.static_level = 0`, `sso.mode = header`, `sso.trusted_proxies = ["10.89.0.52"]`, and a group→level map — but the mechanism was deliberately **not** switched, and **no Keycloak realm/OIDC client was registered** (Keycloak is on the default `master` realm only). Flipping `auth_mechanism` to `sso` while the proxy asserts no identity would lock **everyone** out, including recovery paths — LibreNMS "has no capability to log out a user authenticated via SSO," and with `static_level=0` an unheadered request maps to no access. The nginx header-injection strip (check 9b) passes **independently** of SSO state and stays as-is.

This is Task 0.5 Steps 4–6 work that was correctly not executed without the realm-design decisions (client IDs, group names, redirect URIs, break-glass). Those decisions are below.

### Design — dedicated realm, two clients, group→level map, controlled cutover with break-glass

#### 1. Keycloak realm
Create a **dedicated realm `nms`** (not `master`). `master` is Keycloak's own admin realm; putting application clients and groups there couples app identity to Keycloak administration and is a standing anti-pattern. The `nms` realm holds the application users, the four groups, and both OIDC clients. ADR 0003 is IdP-agnostic, so a later corporate-IdP swap is a config change (issuer/client/group-claim), not a redesign.

#### 2. OIDC clients (two, per ADR 0003 rev / ADR 0008 Decision 3)
- **`nms-custom-ui`** — confidential client for the **BFF** (Authorization Code + PKCE, S256). `redirect_uri` MUST carry `:8443` and match exactly (the commonest OIDC failure is a redirect_uri mismatch presenting as a login loop). Not activated in this finding's scope — the BFF/custom UI is Task 10, unbuilt — but registered now so the realm is complete.
- **`nms-native`** (the `oauth2-proxy` client) — confidential client for the **authenticating reverse proxy** in front of the LibreNMS native UI. The proxy is the actual OIDC client; the client secret is injected at runtime from the server-side `.env`, never committed, never in evidence (FR-57, NFR-09). The proxy authenticates the user, strips inbound identity headers, sets its own, and exempts `/api/` from the interactive redirect so the BFF's token calls are answered, not redirected.

#### 3. Group → LibreNMS-level mapping (reconciled with OQ-7 / ADR 0003 role table) — **OQ-7 CLOSED (human, 2026-08-09)**
LibreNMS `sso` uses **legacy levels** (`1 user`, `5 global-read`, `10 admin`, `11 demo`), via `sso.group_strategy = map` + `sso.group_level_map`. Reconciled with ADR 0003's table and the now-CLOSED OQ-7:

| Keycloak group (realm `nms`) | Platform role (ADR 0003) | LibreNMS level | Note |
|---|---|---|---|
| `nms-admin` | `admin` | **10** (administrator) | Final |
| `nms-engineer` | `engineer` | **10** (administrator) | **OQ-7 CLOSED: 10.** Engineers get full native-UI access |
| `nms-operator` | `operator` | **1** (normal user) | Final (per the role table) |
| `nms-readonly` | `readonly` | **5** (global-read) | **OQ-7 CLOSED: 5.** Read-only-with-full-visibility |
| *(group present but not in the map / native-mechanism default)* | — | **1** (normal user) | **Group-mapping fallback = 1** |
| *(no matching SSO group at all)* | — | **`static_level = 0` → NO access** | Fail-closed. Never a permissive default (rejects the arch-ref `default_level=1` mistake) |

`sso.create_users`/`sso.update_users = true` for auto-provisioning (FR-16), level re-evaluated each login (AC-A#5). **OQ-7 is CLOSED** — engineer=10, readonly=5, group-mapping fallback=1, SSO no-match=0. Nothing in this table is pending.

#### 4. Exact `config.php` / env changes
Applied via `podman exec --user librenms nms-librenms lnms config:set …` where the key is in `config_definitions.json`, and directly in `~/nms/config/config.php` for the `sso.*` keys (which the evidence confirms are NOT in `config_definitions.json`, so `lnms config:set` rejects them — this is why they live in `config.php`):

```php
// config.php — SSO block (values already present except auth_mechanism)
$config['sso']['mode']                = 'header';
$config['sso']['static_level']        = 0;                       // fail-closed (SSO no-match = no access)
$config['sso']['trusted_proxies']     = ['<proxy-container-addr>'];// the proxy ONLY, never a range
$config['sso']['group_strategy']      = 'map';
$config['sso']['group_level_map']     = ['nms-admin'=>10,'nms-engineer'=>10,'nms-operator'=>1,'nms-readonly'=>5]; // OQ-7 CLOSED
$config['sso']['create_users']        = true;
$config['sso']['update_users']        = true;
$config['sso']['auth_logout_handler'] = '<proxy sign-out URL, e.g. /oauth2/sign_out>';
// THE CUTOVER LINE — flipped LAST, only after every check below passes:
$config['auth_mechanism']             = 'sso';   // currently 'mysql'
```
The `oauth2-proxy` env (server-side `.env`, never committed): `OIDC_ISSUER_URL=https://10.121.77.206:8443/auth/realms/nms`, client id `nms-native`, client secret (runtime-injected), and the header-strip + `/api/` exemption config.

#### 5. Controlled cutover sequence with break-glass / local-admin fallback
Ordering is the whole safety story — the mechanism flips **last**, and a local admin survives it.

1. **Pre-cutover — establish break-glass BEFORE touching `auth_mechanism`.** Create/confirm a **local LibreNMS admin account in the `mysql` mechanism** (username + strong password, generated on host, never printed/committed) and record that it exists (not its secret). This account is the recovery path if SSO misconfigures. *Rationale:* once `auth_mechanism = sso`, the login form is the proxy's; a broken proxy or map must not mean zero admin access.
2. **Register realm + both clients** in the `nms` realm; create the four groups; assign the break-glass human's Keycloak user to `nms-admin`.
3. **Verify isolation FIRST (plan Task 0.5 Step 3 — the Critical check).** Prove LibreNMS and every datastore have **no direct host listener** (`3306/6379/8000` closed — note there is no longer a 5432 listener, since TimescaleDB is dropped; the InfluxDB v2 container is likewise never published). With `sso` enabled, a directly-reachable LibreNMS is an auth bypass — anyone who can reach it asserts `admin` with one header. **`sso` MUST NOT be enabled until this passes.** On 0.4c this is the *only* boundary (no firewall).
4. **Stand up the proxy as OIDC client** (client secret runtime-injected), header-strip on, `/api/` exempt. Confirm the proxy sets identity headers only after a successful IdP login.
5. **Dry-run the mapping WITHOUT flipping the mechanism** — `podman exec --user librenms nms-librenms ./scripts/auth_test.php -u <test-user>` resolves the user and mapped level while `auth_mechanism` is still `mysql`. Confirm each of the four groups resolves to its intended level (engineer→10, readonly→5, operator→1, admin→10) and an unmapped user resolves to level 0.
6. **Flip `auth_mechanism = sso`** — the single cutover line, last.
7. **Immediate post-cutover verification (FR-58 Step 8 / AC-A#3/#4/#5/#7):** login via IdP with no second prompt; user auto-created at mapped level; **unmapped user gets 0/denied**; **logout re-prompts** (proves `auth_logout_handler`); **break-glass path still works** if the proxy is bypassed via the documented recovery route.
8. **Rollback (must be one reversible step):** revert `auth_mechanism` to `mysql` in `config.php` and reload LibreNMS. Because the break-glass local admin was created in step 1, this is always available; there is no state to unwind. On this snapshot-waived host, "every change individually reversible" is load-bearing — this one is.

#### 6. What is NOT in scope of this finding
- The `nms-custom-ui`/BFF activation and the custom UI (Task 10, unbuilt) — the client is *registered* but its flow is not exercised here.
- The nginx header strip (check 9b) — already passing, unchanged.
- FR-56 real-device ports — unrelated, unchanged.

---

## Implications for the not-yet-built Tasks (4/5/6/10/12)

- **Task 6 (real-API / ASM-1 verification, gated on Task 0.6):** F-1 and F-5 keep FR-58 at 4/5, so Task 0.6 does not fully pass. Task 6 must not start against a half-verified engine (its own gate says so). F-1's fix unblocks trap/syslog attribution; F-5's cutover unblocks the SSO end-to-end check. F-2 does **not** block Task 6 (Task 6 reads the LibreNMS REST API + MariaDB, not the TSDB).
- **BFF `MetricsReader` (design §8, ADR 0005) — Tasks 4/6 skeleton, Phase 2 adapter:** directly affected by F-2. Phase 1 ships only the port + `checkHealth()`, unchanged. **The Phase-2 adapter class is now fixed by the decision: `InfluxMetricsReader` (Flux/InfluxQL against InfluxDB v2).** The port signature is vendor-neutral and does **not** change — this is the seam doing its job. `checkHealth()`'s probe target is now InfluxDB v2 (`/health` on the Influx container / a bucket read), not Postgres. FR-26 (95th percentile) and FR-28 (reconcilable method) are now implemented as documented Flux/InfluxQL, centralised behind the port.
- **Task 10 (custom UI + BFF deploy):** F-5's `nms-custom-ui` client is registered now so Task 10 does not have to create the realm; the redirect_uri `:8443` gotcha is pre-flagged.
- **Task 12 (simulator harness):** F-1's receiver-network split means the simulators must send traps/syslog to the receivers' pasta-facing address to exercise attribution end-to-end; the Task 0.6 attribution check depends on it. The "withhold-OID" requirement (FR-24/FR-52) is unrelated and unchanged.
- **The carbon bridge (Option a) is NOT built** — Option (b) was chosen, so there is no new team-owned deployable and no extra G-cycle. The vestigial TimescaleDB container (count=0) is removed with co-tenancy care; there is no data to migrate.

---

## Native-UI branding (config-only, FR-07-compliant) — "AIRNMS"

- **Status:** confirmation only; doc-only; no host contact, no core edit, no manifest change. Classed `quick`/low-risk. No ADR (config-only, no durable architectural contract changes).
- **Date:** 2026-08-10
- **Author:** Technical Architect
- **Distinct from FR-44a/FR-44b:** FR-44a brands the *custom Next.js UI* "AirNMS" (Task 10); FR-44b keeps the native UI *stock*. This finding covers a **separate, human-accepted request**: a config-level rebrand of the **native LibreNMS 25.7.0** UI to "AIRNMS". The human has accepted it as FR-07-compliant **because it uses only LibreNMS's own supported config keys** — no core file, no blade view, no template edit.

### Source of truth for the key names (grounded, not recalled)
Verified against the LibreNMS **`25.7.0` git tag** (not recall — LibreNMS renames config keys across versions):
- Schema: `resources/definitions/config_definitions.json` @ tag `25.7.0` — all keys below are present (`page_title_suffix` line 5698, `project_name` 6180, `project_id` 6172, `title_image` 6903, `favicon` 2280, `login_message` 5125).
- Consumers (the code that actually renders each surface), all @ `25.7.0`:
  - `app/Http/ViewComposers/LayoutComposer.php:49,51` — browser `<title>` = section + `' | ' . page_title_suffix`.
  - `app/ConfigRepository.php:423` — `setDefault('page_title_suffix', '%s', ['project_name'])` (confirms the docs' claim that `page_title_suffix` defaults to `project_name`).
  - `app/View/Components/Logo.php:22-23` + `resources/views/components/logo.blade.php` — navbar / login / 2FA logo (`image ??= title_image`, `text ??= project_name`).
  - `resources/views/auth/login-form.blade.php:8` — login-page message (`login_message`).
  - `resources/views/layouts/librenmsv1.blade.php:10-17` — favicon.
  - `resources/views/layouts/legacy_page.blade.php:18` + `resources/views/about/index.blade.php:183` — "Powered by" footer / About page (both `project_name`).

### Confirmed supported keys and exactly what each visible surface becomes

| Config key (exact, 25.7.0) | Default | Surface it controls | Before | After (set to "AIRNMS") |
|---|---|---|---|---|
| `$config['page_title_suffix']` | *(unset -> falls back to `project_name`)* | Browser tab **`<title>`** suffix | `Overview \| LibreNMS` | `Overview \| AIRNMS` |
| `$config['project_name']` | `LibreNMS` | (a) the `<title>` suffix *when `page_title_suffix` is unset*; (b) navbar/login/2FA logo **`alt`/accessible text**; (c) legacy "Powered by <name>" footer; (d) About page; (e) PDF / email / IRC / HTTP User-Agent metadata | `LibreNMS` everywhere above | `AIRNMS` everywhere above |
| `$config['title_image']` | *(empty)* | navbar + login + 2FA **logo image** (`<x-logo>`): renders `<img src="{{ asset(title_image) }}" alt="{{ project_name }}">`, or inline SVG `<use>` if the value ends in `.svg` | empty -> hardcoded embedded **LibreNMS SVG wordmark** | a served AIRNMS logo **only if** an AIRNMS image asset is staged under a LibreNMS-served path (e.g. `html/images/...`). See constraint below — NOT config-only. |
| `$config['favicon']` | *(empty -> built-in LibreNMS favicons)* | browser favicon | LibreNMS favicon | custom favicon **only if** a favicon asset is served — NOT config-only |
| `$config['login_message']` | *(legal-warning string)* | login-page message line | default warning text | any AIRNMS text |

**Recommended minimal, purely-additive set** (achieves the visible rename with no asset staging): set **`project_name = 'AIRNMS'`** and, for an explicit tab title, **`page_title_suffix = 'AIRNMS'`**. Optionally `login_message`. These are plain `text` keys — no file needs to be hosted.

### Surfaces that CANNOT change without a core/blade/template/asset edit — these STAY "LibreNMS" (FR-07)
The human has already accepted that a 100% scrub is out of scope. The following are hardcoded and are **not** reachable by supported config alone:
- **The navbar/login/2FA wordmark SVG when `title_image` is empty.** `logo.blade.php` embeds a literal LibreNMS logo SVG as the no-image fallback; `project_name` only changes the `alt` text, not the drawn glyph. This is overridable **only** by supplying a `title_image` asset — which requires **staging a static image file** into a LibreNMS-served path inside the image/volume. That is a content addition (and a per-upgrade maintenance item), not a config-only change. **Decision: out of scope for the config-only rebrand.** The drawn logo stays LibreNMS unless the human later approves staging a logo asset.
- **Install/setup screens** (`layouts/install.blade.php` hardcodes `alt="LibreNMS"` and the default logo path) — not on the operator path; unchanged.
- **In-product help / support / docs links and error pages** (`https://docs.librenms.org/...`, `librenms.log`) — literal strings in blades; core-only; unchanged.
- **Any blade/Vue component with a literal "LibreNMS" string** not fed by `project_name` — core-only; unchanged.

**Achievability conclusion:** a visible rename of the **browser `<title>`, the logo `alt`/accessible name, the "Powered by" footer, the About page, and the login message** IS achievable purely via supported config. The **drawn logo glyph and the deep help/install/docs strings are NOT** achievable without touching core assets/templates, so they remain "LibreNMS". For those surfaces the correct outcome is a **STOP-at-the-config-boundary**, not a core patch — exactly the FR-07 posture.

### Apply + verify mechanism (config-only; identical to the SSO/Influx override pattern)
Purely additive host config: no core file, no blade, no template, no privileged container, no sudo. The image already merges `~/nms/config/*.php` into the container's `/data/config/` via the sanctioned `glob("/data/config/*.php")` include (proven by the F-2 datastore override `/data/config/10-influxdbv2.php` and the F-5 SSO override `/data/config/20-sso.php` — see deploy-fix-evidence §F-2/§F-5). LibreNMS **caches config**, so a `config:clear` is mandatory (same as F-5).

Steps a maker will run (host side, inside `~/nms` = `/opt/airlinq/aqaillm/nms`):
1. **Write the include** — a new file `~/nms/config/30-branding.php` (append-only new file; touches no existing include):
   ```php
   <?php
   $config['project_name'] = 'AIRNMS';
   $config['page_title_suffix'] = 'AIRNMS';
   // Optional: $config['login_message'] = 'AIRNMS - authorised access only.';
   ```
2. **Land it in the container include dir** exactly as the SSO/Influx overrides were landed (into `/data/config/30-branding.php` on the `:z` shared `nms-librenms-data` volume — NOT a core path).
3. **Clear the config cache:** `php artisan config:clear` in the librenms container (the F-5-proven step; the include is otherwise cached and the change no-ops).
4. **Verify the `<title>`:** on an authenticated Overview response (`curl -sk https://10.121.77.206:8443/ ...`) observe the `<title>` change from `Overview | LibreNMS` to `Overview | AIRNMS`; spot-check the login-page message and the logo `alt` (`AIRNMS`).

### Rollback
Delete `30-branding.php` from the include dir (or set the values back to `'LibreNMS'`), copy in, `php artisan config:clear`. Single reversible step; no state to unwind — identical shape to the F-5 rollback.

### Guardrail confirmation
Config-only, additive, inside `$HOME`; **no core file, no blade/template, no privileged container, no `--pid=host`/host-namespace flag, no sudo, no new listener, no schema/DDL change.** Safe to apply under the current team-config §8 guardrails. Not an ADR-worthy change.
