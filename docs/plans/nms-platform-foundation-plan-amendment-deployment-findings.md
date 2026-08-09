# Plan amendment — deployment findings F-1, F-2, F-5 (Revision 5)

- **Status:** For human approval at G2. Companion to `docs/plans/nms-platform-foundation-plan.md`. **Supersedes** the referenced plan sections; where it does, the pointer is explicit.
- **Date:** 2026-08-09
- **Author:** Technical Architect
- **Design:** `docs/design/nms-platform-foundation-deployment-findings.md` · **ADRs:** 0009 (new, F-2), 0005 rev-3 note (F-2), 0003 F-5 amendment
- **Doc-only.** This amendment specifies manifest/plan text changes; the **maker** edits `deploy/` and the **human** commits it. No code tree touched.

Why an amendment doc rather than in-place edits: the parent plan is ~3,800 lines and uses dated in-place revision notes; a focused, cross-referenced addendum is the reviewable unit for three surgical findings and keeps the superseded text readable next to its correction (the project's ADR/plan convention).

---

## A. F-1 — correct Task 0.4c Step 5 (the source-IP fix was wrong) and strengthen Task 0.6 Step 7

**Supersedes:** plan Task 0.4c **Step 5** ("Fix the source-IP problem … `rootless_port_forwarder=\"pasta\"` in `containers.conf`"). That fix is **proven ineffective** on a named bridge (F-1: `RootlessNetworkCmd=pasta` governs only the default pasta netns; netavark/rootlessport still masquerade — observed `SRC=10.89.0.53`). The `containers.conf` append must NOT be presented as the fix.

### Step 5 (REPLACED) — split the trap/syslog receivers onto pasta networking

- **Manifest changes (maker executes; specified here):**
  - `deploy/librenms-podman/nms-snmptrapd.container`: `Network=nms` → `Network=pasta`.
  - `deploy/librenms-podman/nms-syslogng.container`: `Network=nms` → `Network=pasta`.
  - Configure the receiver→MariaDB reachability path for whichever sub-option the empirical probe (below) supports — **preferred:** receivers feed the LibreNMS pipeline reaching `db` via pasta's host-address mapping; **fallback:** a two-receiver pasta pod with pasta `-T`/`-U` forwarding to the host-mapped DB endpoint (design §F-1).
  - **Delete or comment** the ineffective `~/.config/containers/containers.conf` `[network] rootless_port_forwarder="pasta"` block (evidence: "ineffective, safe to delete").
  - The other ~9 containers **stay on the named `nms` bridge** (aardvark-dns + the nginx resolve-per-request fix depend on it).
- **Rationale:** `--network pasta` was **empirically proven** to preserve the real source IP (`SEEN=172.16.10.22`). This is a rootless, no-sudo, no-privileged-port, no-firewall change — **no privileged operation required**, so no human decision needed for the fix itself.
- **Verification (this step's DoD):** re-run the source-IP probe **against the actual receiver units on pasta** (not a throwaway `--network pasta` probe container), from the developer machine's real IP:
  - **Expected:** the received UDP line carries the developer machine's **real source IP**, not a `10.89.x` / gateway address. A gateway IP = **STOP**, the split is not effective.
  - **Expected:** isolation check 9a still passes — only 8080/8443/1162/1514 published; `3306/5432/6379/8000` closed (the receivers must NOT publish MariaDB).
  - **Expected:** the ~9 bridge containers still resolve each other by name (nginx→librenms 200 after a librenms restart — the F-4.3 durability property).

### Task 0.6 Step 7 (STRENGTHENED) — assert attribution, not receipt
- Send a trap (1162/udp) and a syslog line (1514/udp) from a simulator with a **known device source IP**.
- **Expected:** both appear in LibreNMS **filed against the correct device** (Eventlog/Syslog show the device, not "no device"). Mere receipt is NOT a pass — attribution is the assertion, and it is exactly what F-1 broke.

---

## B. F-2 — Task 0.2 Step 5 write-path config is BLOCKED pending the human's ADR 0009 decision

**Supersedes:** plan Task 0.2 **Step 5** sentence "*Configure LibreNMS's metric output to write to it*" and Task 0.6 **Step 6** ("LibreNMS→TimescaleDB write path is verified"). F-2 proved there is **no TimescaleDB datastore driver** in LibreNMS 25.7.0 — the write path cannot be configured as the plan assumed. `count(*) = 0`.

**No plan step here is executable until the human decides ADR 0009** (carbon bridge vs InfluxDB v2). The two resulting plan shapes:

### If human chooses Option (a) — carbon bridge (keeps TimescaleDB)
- **New Task 0.2 sub-step:** add an internal-only `nms-carbon-bridge` container (pinned image; never published — ADR 0002). Configure LibreNMS `config:set datastores.graphite.enable true`, `datastores.graphite.host <bridge>`, `datastores.graphite.port <p>`, and pin `datastores.graphite.prefix` deliberately.
- **New scope flag:** the bridge is **team-owned code** → it needs its own design/plan/build/G2.5/test cycle, OR an explicit deferral marking the write path unverified. The human should see this cost when choosing (a).
- **Task 0.6 Step 6 (rewritten):** `count(*) > 0` in `nms_metrics` for a polled device **through the bridge**, PLUS a bridge-down test proving bounded buffering (no unbounded growth on the shared disk) and a visible health signal.

### If human chooses Option (b) — InfluxDB v2 (native)
- **Task 0.2 Step 5 (rewritten):** replace the `timescaledb` container with a pinned `influxdb:2.x`; drop the hypertable/retention SQL; set a **bucket retention policy = 14 days** as a **precondition of first start** (shared-disk guardrail). Configure LibreNMS `config:set datastores.influxdbv2.*` (URL/org/bucket/token, runtime-injected).
- **ADR:** ADR 0005 gets rev 3-b; OQ-3 re-answered; ADR 0009 records (b).
- **Task 0.6 Step 6 (rewritten):** `count > 0` in the Influx bucket for a polled device.

**Verification either way:** FR-58 check 6b stays **FAIL** until the chosen path lands a row for a polled device. Until then, no Phase-2 `MetricsReader` read adapter is built (its target is decision-dependent — §D).

---

## C. F-5 — realm/client/cutover into Task 0.5 Steps 4–6

**Amends (does not supersede):** plan Task 0.5 Steps 4–6 already describe the two-client + `sso` wiring. F-5 adds the **dedicated realm**, the **exact group→level map reconciled with OQ-7**, and the **break-glass cutover ordering** that was missing and is why activation was correctly deferred. Full design: `docs/design/nms-platform-foundation-deployment-findings.md` §F-5; ADR 0003 F-5 amendment.

### Task 0.5 Step 4 (AUGMENTED)
- **Create a dedicated `nms` realm** (NOT `master`). Register `nms-custom-ui` (BFF, `redirect_uri` carries `:8443`, exact match) and `nms-native` (oauth2-proxy). Create groups `nms-admin`/`nms-engineer`/`nms-operator`/`nms-readonly`; assign the break-glass human to `nms-admin`.
- **Verification:** `GET https://10.121.77.206:8443/auth/realms/nms/.well-known/openid-configuration` → 200 with `"issuer": ".../realms/nms"` (currently only `master` exists).

### Task 0.5 Step 5 (AUGMENTED) — cutover ordering with break-glass
DoD sequence (each independently verifiable):
1. **Break-glass first:** confirm a local `mysql`-mechanism admin exists (record existence, never the secret) BEFORE any `auth_mechanism` change.
2. Isolation check (Task 0.5 Step 3) **passes** — `3306/5432/6379/8000` closed. `sso` MUST NOT be enabled otherwise (auth bypass; only boundary on 0.4c).
3. Proxy stands up as OIDC client (secret runtime-injected), header-strip on, `/api/` exempt.
4. **Dry-run while still on `mysql`:** `podman exec --user librenms nms-librenms ./scripts/auth_test.php -u <test-user>` → each group resolves to its mapped level; unmapped → level 0. Record levels, no credentials.
5. **Flip `auth_mechanism = sso`** in `config.php` (last) with the map: `{"nms-admin":10,"nms-engineer":10,"nms-operator":1,"nms-readonly":5}` (the `engineer 10|1` and `readonly 5|1` cells are OQ-7 — **pending human**; use the shown defaults unless the human rules otherwise). `sso.static_level=0`, `sso.trusted_proxies=[<proxy only>]`, `sso.auth_logout_handler=<proxy sign-out>`.
6. **Rollback path:** revert to `mysql` + reload = one reversible step; always available via step 1.

### Task 0.6 Step 8 (SSO end-to-end) — now executable
- **Expected:** IdP login with no second prompt; auto-provision at mapped level; **unmapped user denied (level 0)**; **logout re-prompts** (proves `auth_logout_handler`); **break-glass admin still logs in** via the recovery route. Check 9b (header strip) is independent and already PASS.

**No privileged operation required** for F-5 — `config.php`, `lnms`/`podman exec`, Keycloak realm admin, all within the rootless/no-sudo envelope.

---

## D. Downstream task impacts (Tasks 4/5/6/10/12)

- **Task 6** (gated on Task 0.6): unblocked for FR-58 attribution once F-1 lands and for SSO once F-5 lands; **F-2 does not gate Task 6** (it reads the LibreNMS API + MariaDB, not the TSDB).
- **BFF `MetricsReader`** (design §8, ADR 0005): Phase-1 port + `checkHealth()` unchanged. **Phase-2 adapter class is decision-dependent** — `TimescaleMetricsReader` (Option a) vs `InfluxMetricsReader` (Option b). Port signature does not change. Do not build the adapter until ADR 0009 is decided.
- **Task 10** (custom UI/BFF): `nms-custom-ui` client pre-registered by F-5; the `:8443` redirect_uri gotcha pre-flagged.
- **Task 12** (simulators): must send traps/syslog to the receivers' pasta-facing address to exercise the Task 0.6 Step 7 attribution check.
