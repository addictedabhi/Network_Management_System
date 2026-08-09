# 0008. LibreNMS engine deployment: official Docker Compose on a human-provided host, with an authenticating-proxy SSO bridge

- **Status:** **ACCEPTED (revision 2, 2026-08-09).** Approved by the human at G2. Every branch this ADR left open is now closed — see the Revision 2 section. **The "no agent executes" posture in the Context below is SUPERSEDED by Revision 2; it is retained verbatim because it records the reasoning that applied before the authorization, and an ADR records history.**
- **Date:** 2026-08-09
- **Deciders:** Human (approver), Technical Architect (author)
- **Work item:** `nms-platform-foundation`
- **Relates to:** FR-07, FR-13, FR-54..FR-58, NFR-09, DEP-10, OQ-2, OQ-23, OQ-24, OQ-25, AC-A#3..#5
- **Amended by:** the Revision 2 section below, which supersedes the execution-ownership position only. All five original Decisions stand.
- **Amends:** ADR 0003 (§"LibreNMS auto-provisioning") — see §6. **Does not change** ADR 0001, 0002, 0004, 0005, 0006, 0007.

## Context

OQ-22 resolved on 2026-08-09 in a way that enlarged scope: LibreNMS is no longer an assumed pre-existing environment. It is **installed by this project** on a remote server the human provides (DEP-10, FR-54..58), and it must run together with the custom UI.

Three things follow, and this ADR decides all three:

1. **Install method** (OQ-24) — official Docker Compose distribution vs the official native procedure.
2. **Where the deployment sits in the plan** — it gates the BFF's real-API verification.
3. **How SSO is actually wired into LibreNMS** (FR-13/FR-57). Consulting the official documentation rather than relying on recall surfaced a fact that invalidates a premise in ADR 0003, so it is corrected here rather than left to be discovered during implementation.

**No agent executes any of this.** Per team-protocol §5, any SSH connection or fact-gathering against a host we do not own disposably counts as reaching a target environment. Until the human designates that server lab/disposable (OQ-23), the deliverable is an ordered, human-runnable, individually-verifiable runbook. This ADR records a *design*, not an executed installation.


---

## Revision 2 (2026-08-09): what the human closed, and the one posture that is superseded

Every branch this ADR deliberately left to the human has been closed. Recorded here rather than by editing the Decisions below, so the original reasoning stays readable next to the answer it received.

| Left open by revision 1 | Closed as |
|---|---|
| **OQ-23** — host facts | Host is **`10.121.77.206`**. SSH credentials live in the **gitignored repo-root `Credentials.md`**. **OS, Docker availability, CPU/RAM/disk, sudo, and whether the host is shared remain UNKNOWN** — they are now *discovered* by SSH fact-gathering (plan Task 0.1), not supplied |
| **OQ-24** — install method | **Docker Compose** (Decision 1, Option A). Decision 1's conditional is discharged. **Option B (native) is retained as the documented fallback** for one specific discovered fact — Docker/Compose absent or unusable on the host — and is *not* deleted, because that fact is unverified until Task 0.1 runs |
| **OQ-25 / OQ-2** — Keycloak | **Co-hosted on `10.121.77.206`**, resolving OQ-2 — **conditional on the floor check** in Decision 4: co-host only if discovered specs **exceed** 4 vCPU / 8 GB. At or below the floor, **STOP and flag to the human** before installing Keycloak. This promotes Decision 4's own caveat ("if the human's server is at that floor, my recommendation flips") to a hard gate |
| **OQ-3** — TSDB, and whether co-hosted | **TimescaleDB**, co-hosted here (ADR 0005 revision 2). It is a service in the pinned manifest and its row in the Decision 4 sizing table is now live rather than "pending OQ-3" |
| **OQ-7** — readonly level `5` vs `1` | Role table accepted by the human at G2; the Decision 3 refinement note stands as a Phase-1 configuration detail |

### The superseded posture: execution ownership

**Revision 1 said, in the Context below:** *"No agent executes any of this. Per team-protocol §5, any SSH connection or fact-gathering against a host we do not own disposably counts as reaching a target environment. Until the human designates that server lab/disposable (OQ-23), the deliverable is an ordered, human-runnable, individually-verifiable runbook."*

**That is now superseded.** The human explicitly authorized agent execution on 2026-08-09: *"use the credentials to deploy the solution."* Agents may SSH to `10.121.77.206` and execute the deployment. The override is **scoped to this single host** and relaxes team-protocol §5 nowhere else.

**Why the original reasoning is retained rather than deleted:** it was not wrong. It was the correct posture for an undesignated host, and it is the reason the runbook was written to be individually verifiable with an expected output per step — a property that turns out to be exactly what agent execution requires, because evidence capture needs a stated expected result to compare against. The prohibition was replaced; the discipline it produced was not.

**What carries the safety now is the guardrail set, not the prohibition.** Recorded here because it is an architectural property of this deployment, not merely a process note:

1. **Credential hygiene (Critical).** `Credentials.md` is read **only** to establish the connection. Its contents never enter any doc, config, log, artifact, commit, handoff, status file, or echoed command. Path references only. A leak is a Critical finding.
2. **Evidence per step.** Expected-vs-actual output for every Task 0.x step, recorded under `.claude/team/artifacts/nms-platform-foundation/`, secrets redacted.
3. **Stop before destruction.** Disk wipes, OS changes, removing or reconfiguring pre-existing services -> STOP, confirm with the human.
4. **Stop if shared.** Host carrying unrelated production services -> STOP and report before installing anything.
5. **Facts first.** Task 0.1 is now an *executed* SSH fact-gathering step whose findings **gate** the install path and the Keycloak decision. Nothing is installed before it runs.
6. **Keycloak floor check** as above.

**The risk profile changed, and it should be said plainly rather than left implicit.** Under the old posture, a mistaken command was caught by a human reading it before running it — a human who knew the host. That review layer is gone. Three consequences follow, and they are why Decisions 1 and 2 matter more now than when they were written:

- **The pre-flight snapshot stops being good practice and becomes the only rollback.** Decision 1's Option-B con ("no clean uninstall") and design §12.8's rollback asymmetry are now the difference between a recoverable mistake and a rebuilt host. The snapshot must be taken by the **human on the hypervisor/cloud console** — an agent inside the guest cannot snapshot the machine it is running on, so this is one step the authorization does **not** transfer. Deployment should not begin without it.
- **Compose's blast-radius containment is now a safety control, not a convenience.** Revision 1 preferred Compose for reproducibility. Under agent execution on a host of unknown shared-ness, the fact that Compose confines persistent state to named volumes and services to containers is the stronger argument. That is a reason to hold Option A firmly, and to treat a fallback to Option B as a decision to re-escalate rather than shrug at.
- **The Decision 3 header-injection boundary is unchanged in severity and now unsupervised in construction.** It remains the single highest-severity item in the package, and its negative test (plan Task 0.6) is the check that must never be skipped or self-certified.

### Evidence base

All LibreNMS facts below are from the official documentation, retrieved 2026-08-09, not from recall:

- `https://docs.librenms.org/Installation/Install-LibreNMS/` — native procedure, package lists, supported OS tabs, PHP floor, the HTTPS warning, `validate.php`
- `https://docs.librenms.org/Installation/Docker/` — official image and compose distribution
- `https://github.com/librenms/docker` → `examples/compose/compose.yml` — the actual service topology
- `https://docs.librenms.org/Extensions/Dispatcher-Service/` — dispatcher, worker tuning, the 1,000+ device statement
- `https://docs.librenms.org/Extensions/RRDCached/` — RRDCached options and version/feature matrix
- `https://docs.librenms.org/Extensions/Authentication/` — available auth modules and the `sso` mechanism
- `https://docs.librenms.org/Support/Example-Hardware-Setup/` — user-reported sizing

Facts worth quoting because decisions rest on them:

- **PHP floor:** "the minimum supported PHP version is 8.4, the recommended version is 8.5". The native path on an older distro therefore requires a third-party PHP repository (`packages.sury.org`) — the docs say so explicitly in the Ubuntu 24.04 / Debian 12 tabs.
- **Supported OS is a closed list.** The native instructions are tabbed per OS (Ubuntu 26.04 / 24.04, Debian 12 / 13, and RHEL-family elsewhere). An unsupported OS is not a "follow it anyway" situation.
- **The native install is HTTP-only as documented.** Verbatim: "we have not covered HTTPS setup in this example, so your LibreNMS install is not secure by default. Please do not expose it to the public Internet unless you have configured HTTPS."
- **Poller capacity:** "A single instance can poll up to 1,000+ devices, depending on latency and device responsiveness. If performance limits are reached, use Distributed Polling."
- **Auth modules available:** `mysql`, `active_directory`, `ldap`, `radius`, `http-auth`, `sso`. **There is no OIDC/OpenID-Connect module.** Only one may be enabled at a time.
- **`sso` is a header/environment-variable mechanism**, documented against SAML relying parties (Shibboleth, ADFS, mod_auth_mellon, oauth2-proxy), with `sso.trusted_proxies` as its only built-in protection, and: "LibreNMS has no capability to log out a user authenticated via Single Sign-On".
- **`sso` uses legacy levels, not roles:** `1 user`, `5 global-read`, `10 admin`, `11 demo`.

---

## Decision 1 — Install method (OQ-24): the official Docker Compose distribution

> **Revision 2:** the conditional formerly in this heading ("if Docker is permitted") is discharged — the human selected **Compose**. Option B below is retained as the fallback for one discovered fact only (Docker unavailable on the host), not as an open branch.

### Considered options

**Option A — Official Docker Compose distribution (`github.com/librenms/docker`, `examples/compose`). SELECTED — unconditionally as of revision 2 (OQ-24 answered: Compose).**

The official compose file defines exactly the topology FR-54 enumerates: `db` (MariaDB), `redis`, `librenms` (web + PHP-FPM in the image), `dispatcher` (`SIDECAR_DISPATCHER=1`), `syslogng` (`SIDECAR_SYSLOGNG=1`, ports 514/tcp+udp), `snmptrapd` (`SIDECAR_SNMPTRAPD=1`, port 162), plus `msmtpd`.

- **Pro — FR-55's repeatability is structural, not aspirational.** The engine is described by a versioned file we hold in this repo. Rebuilding it after a host loss is `docker compose up -d`, not a re-run of a fifty-step manual procedure whose drift nobody recorded. FR-55 exists precisely because "an unreproducible engine cannot be recovered or upgraded".
- **Pro — the PHP-version problem disappears.** The image carries its own PHP. The native path on Ubuntu 24.04 or Debian 12 needs the `packages.sury.org` third-party repo to reach PHP 8.4/8.5 — a supply-chain dependency added to the host, and a permanent upgrade obligation.
- **Pro — the OS constraint softens.** Compose needs a Docker-capable Linux host; the native path needs one of a specific list of distributions at a specific version. Since the host's OS is unknown (OQ-23), the option with the wider envelope is the safer commitment.
- **Pro — the sidecars are pre-wired.** Trap and syslog receivers (FR-56's UDP 162/514) are first-class services in the official file. On the native path they are separate manual installs.
- **Pro — co-hosting Keycloak (Decision 4) is then a matter of adding a service, and process isolation between the engine and the IdP is the container boundary rather than one shared systemd host.
- **Con — RRDCached is not in the official compose file.** FR-54 names it explicitly. Addressed in Decision 2.
- **Con — the official example uses `librenms/librenms:latest`, `redis:7.2-alpine`, `mariadb:10`, `crazymax/msmtpd:latest`.** Two `latest` tags. The repo's Docker rules forbid `latest` and require pinned versions. **We therefore do not use the official file verbatim** — we vendor it and pin every image to a digest-or-explicit-version. This is a deviation from upstream and is recorded as such, because an unpinned engine cannot satisfy FR-55's repeatability claim either: `latest` means two `up -d` runs a month apart produce different systems.
- **Con — it inherits `cap_add: NET_ADMIN, NET_RAW`** (needed for fping/SNMP). Accepted with justification, not silently: these are required for ICMP/SNMP polling. We do not add privileged mode, we do not mount the Docker socket.

**Option B — Official native install per the documented procedure. The fallback if Docker is not permitted.**

- **Pro** — the more common production path; finer control over PHP-FPM pools, snmpd, and the web server; no container-networking complication for SNMP source addressing.
- **Con** — reproducibility must be *manufactured*, since the procedure is a sequence of manual edits (`vi /etc/php/8.5/fpm/php.ini`, `vi /etc/snmp/snmpd.conf`, MariaDB `GRANT` statements, an Nginx vhost). Meeting FR-55 honestly on this path means writing configuration management (Ansible or equivalent) around the documented steps — **that is a real, separate work package**, and pretending a numbered runbook satisfies "repeatable" would be self-deception.
- **Con** — hard dependency on the host being a documented-supported OS at a supported version, plus the third-party PHP repo on older distros.
- **Con** — installs MariaDB, Redis, PHP-FPM, Nginx, snmpd directly onto a host that OQ-23 has not yet confirmed is unshared. On a shared host this is the riskier option by a wide margin.

**Option C — Native install of LibreNMS with MariaDB/Redis in containers.** Rejected: it takes the reproducibility weakness of the native path and adds a second operational model. The worst of both.

### Decision

**Option A — official Docker Compose, images pinned by us. This is the method** (OQ-24, human decision 2026-08-09).

**Option B (native) is the documented fallback for a single discovered fact:** Task 0.1's SSH fact-gathering finds Docker and/or Compose v2 absent or unusable on `10.121.77.206`. It is deliberately **not deleted** from this ADR or from the plan, because "Docker Compose is the approved method" and "Docker is actually installed on that host" are different claims and only the first is established. If Task 0.1 finds Docker missing, the correct move is to **report to the human and ask whether to install Docker or fall back to 0.4b** — not to silently pick either, because installing a container runtime on a host of unknown shared-ness is itself a host change with its own blast radius.

Both branches remain written out as separate step sequences in the plan (Task 0.4a / Task 0.4b), so an unfavourable discovery costs a branch selection rather than a redesign.

**Recommendation, stated plainly: Compose.** For a POC whose engine must be reproducible (FR-55), stood up on a host whose OS we do not yet know, by a team that will rebuild it more than once, the container path is the lower-risk choice. The native path's advantages are production-tuning advantages, and this is not yet production.

---

## Decision 2 — RRDCached, and the two gaps in the official compose file

FR-54 names RRDCached; the official compose file omits it. Two positions:

**RRDCached is deployed, as an added service, on both branches.** Rationale, from the official RRDCached doc: it exists to absorb RRD write I/O, and the doc recommends monitoring "disk I/O usage delta" as the reason to run it. OQ-4's resolution keeps RRD alongside the TSDB (design §9), so the write load is real. Version matters and is not a free choice: the feature matrix shows `>=1.5.5` is required for **C**reate (not merely Graph/Update) without a shared filesystem, and `>=1.8.x` adds **T**une. We therefore require rrdcached **≥1.5.5** and set `rrdtool_version` to the exact running version, as the doc instructs (`lnms config:set rrdtool_version '<exact>'`). Below 1.5.5 a shared filesystem becomes mandatory — an infrastructure requirement nobody wants to discover later.

**TLS is ours to add, on both branches.** The docs' own HTTPS warning applies to the native path, and the compose example publishes plain `8000/tcp`. FR-56 requires inbound HTTPS and FR-58 requires "reachable over HTTPS", so a TLS-terminating reverse proxy (Nginx or Caddy) in front of LibreNMS is part of this work package, not an afterthought. This is also the component that carries the SSO bridge in Decision 3 — one proxy, two jobs, which is why they are decided together.

---

## Decision 3 — SSO into LibreNMS (FR-13/FR-57): an authenticating reverse proxy in front of the native UI

**This is the finding that most changes the picture, and it contradicts a premise of ADR 0003.**

ADR 0003 states that LibreNMS auto-provisioning "uses LibreNMS's supported `sso` auth mechanism … configured via `config.php`/environment only", and FR-13/FR-57 speak of "`auth_mechanism` plus **the OIDC client parameters**". The official auth documentation shows there are no OIDC client parameters to set: the module list is `mysql`, `active_directory`, `ldap`, `radius`, `http-auth`, `sso` — **no OIDC module** — and the `sso` module is a *header/environment-variable* mechanism designed for a relying party sitting in front of LibreNMS. LibreNMS is not itself an OIDC client under `sso`.

So FR-57 as written cannot be satisfied literally. Three ways to satisfy its *intent* (one IdP session across both UIs, AC-A#3/#4/#5):

**Option A — `auth_mechanism = sso` behind an OIDC-authenticating reverse proxy (e.g. `oauth2-proxy`). SELECTED.**
The proxy is the OIDC client — that is where "the OIDC client parameters from ADR 0003" actually live, and where the client secret is injected at runtime (FR-57/NFR-09). It authenticates the user against the IdP and passes identity to LibreNMS as environment/headers; LibreNMS's `sso` module consumes them and auto-provisions (`sso.create_users`/`update_users true`). The docs name `oauth2-proxy` explicitly in the logout-handler example, so this is a trodden path, not an invention.

- **Pro:** satisfies FR-13's intent, AC-A#3 (no second credential prompt), AC-A#4/#5 (create + level update) using only supported configuration. **No LibreNMS core modification** (FR-07).
- **Pro:** it answers the logout problem the docs flag — "LibreNMS has no capability to log out a user authenticated via Single Sign-On". `sso.auth_logout_handler` is pointed at the proxy's sign-out URL (the docs' own `oauth2-proxy` example is `/oauth2/sign_out`), which is what makes AC-A#7 achievable at all. Without this, logout at the native UI silently does nothing — exactly the kind of gap OQ-5 was right to keep open.
- **Con — and it must be stated as a security requirement, not a footnote:** a header-injection mechanism is only as strong as the guarantee that nobody can reach LibreNMS except through the proxy. The docs are blunt about this: prevent header injection between proxy and user, and "prevent end users from contacting LibreNMS directly". Therefore, **mandatory**: LibreNMS binds only to the proxy-reachable interface (loopback or the container network — never a host-published port), `sso.trusted_proxies` is set to the proxy's address only, and the proxy strips any inbound identity headers before setting its own. If any one of these is missing, anyone who can reach LibreNMS directly can assert `admin` by setting a header. This is the single highest-severity item in the whole deployment package.

**Option B — Socialite Providers.** The docs mention it as an alternative supporting OAuth/SAML methods. Rejected for this work item: it is a plugin/provider ecosystem rather than a documented first-class LibreNMS auth mechanism for our case, it would need per-provider validation we cannot do without the IdP (OQ-2/OQ-25), and it puts an unvetted dependency inside the engine we have committed never to modify. Worth revisiting if the proxy proves awkward, but not on unverified ground.

**Option C — `auth_mechanism = active_directory`/`ldap` against the IdP's directory.** Rejected: it abandons single sign-*on* (the user re-authenticates at the native UI, failing AC-A#3) and splits identity across two protocols.

**Consequence for role mapping.** ADR 0003's table maps to LibreNMS levels `10` and `1`, which is compatible with the `sso` module's documented legacy-level map (`1 user`, `5 global-read`, `10 admin`, `11 demo`) via `sso.group_strategy map` + `sso.group_level_map`. One refinement the docs make available and OQ-7 should consider: `5` (`global-read`) is a better fit for a read-only-with-full-visibility role than `1`, whose device/port permissions must be assigned individually. **Flagged for the human at OQ-7; not silently changed.** Also note `sso.static_level` defaults to `0` (no access) when no group matches — which happens to match ADR 0003's fail-closed requirement, and must be left at `0` rather than set to a permissive default the way the architecture reference's `default_level = 1` did.

---

## Decision 4 — Co-hosting Keycloak (OQ-25): yes for the POC, with a named expiry

**Recommendation: co-host Keycloak on the same server for the POC**, resolving OQ-2 — with the caveat stated in the record and not just in conversation: **a POC-grade, co-hosted IdP is not a production identity solution.** It shares a failure domain with the thing it authenticates, it will not have the corporate IdP's MFA/lifecycle/audit posture, and every hour spent on its configuration is thrown away when the corporate IdP arrives.

- **Pro:** unblocks OQ-2, which is the blocker on all of FR-10..19 and the whole of AC-A. ADR 0003 is deliberately IdP-agnostic and depends on no Keycloak-specific feature, so the corporate IdP later is a configuration change (issuer, client credentials, group-claim name), not a redesign. That property is what makes this safe to do.
- **Pro:** it makes the two OIDC clients ADR 0003 needs (`nms-custom-ui`, and now the `oauth2-proxy` client for the native UI) registerable by us, immediately.
- **Con:** one more service on a host whose capacity is unknown (OQ-23). Sized below.
- **Con:** it interacts with `AUTH_MODE=dev-local`. See §7.

**Explicit non-decisions:** the POC Keycloak realm is not a production realm; it is not exposed beyond what FR-56 allows; and no production credential or real user directory goes into it.

### Resource sizing implications (OQ-25) — LibreNMS + supporting services + Keycloak on one host

Grounded in the official docs where the docs speak, and labelled as extrapolation where they do not.

*What the docs support:* the dispatcher doc's "a single instance can poll up to 1,000+ devices" is the capacity anchor. The user-reported hardware table shows real deployments: **~1,028 devices / 26,745 ports** on a 2×14-core box; **390 devices / 16,167 ports** on 2×24 cores at load <14.5; **~179 devices / 14,495 ports** on 4 cores / 8 GB at load <2.5; **~41 devices / 317 ports** on 4 vCPU / 4 GB. Note the table's own framing: "information … direct from users, it's a place for people to share their setups" — it is anecdote, not a sizing formula, and I will not present it as one. Note also that port count, not device count, tracks load in that data.

*Recommendation for this POC's actual workload* — simulated devices in the order of tens (design §7.3), not 5,000:

| Component | vCPU | RAM | Disk | Basis |
|---|---|---|---|---|
| LibreNMS web + PHP-FPM | 1–2 | 1.5–2 GB | — | Extrapolated below the smallest doc'd setups |
| Dispatcher/poller (workers tuned down from the default 24) | 1–2 | 1–2 GB | — | Dispatcher doc: workers × interval budget |
| MariaDB | 1–2 | 2 GB | 20–40 GB | Doc'd setups use 2 GB at 20-device scale |
| Redis | 0.5 | 0.5 GB | — | Queue + cache only |
| RRDCached + RRD storage | 0.5 | 0.5 GB | 20 GB+ | Grows with ports × retention |
| snmptrapd + syslog-ng sidecars | 0.5 | 0.5 GB | 10 GB (logs, rotated) | Official compose sidecars |
| **TimescaleDB** (OQ-3 resolved — co-hosted here) | 1–2 | 2 GB | 20 GB+ | Postgres + hypertables; disk grows continuously |
| TLS/authenticating proxy | 0.5 | 0.25 GB | — | oauth2-proxy + Nginx are light |
| **Keycloak (+ its own DB)** | **1–2** | **1.5–2 GB** | **5–10 GB** | JVM service; POC-scale realm |
| **Recommended total** | **8 vCPU** | **16 GB** | **100 GB SSD** | Comfortable |
| **Practical floor** | **4 vCPU** | **8 GB** | **60 GB SSD** | Tight; expect tuning |

Three honest caveats:
- **These are extrapolations, not documented minimums.** LibreNMS publishes no minimum-spec table; it publishes other people's setups. Anyone presenting a precise figure here is inventing it.
- **Keycloak's marginal cost is roughly +2 vCPU / +2 GB / +10 GB**, and it is a JVM, so its RAM floor is less elastic than the PHP services'. On the 4 vCPU / 8 GB floor, adding Keycloak is the change most likely to make the host uncomfortable — if the human's server is at that floor, my recommendation flips to running Keycloak elsewhere (or accepting `AUTH_MODE=dev-local` longer).
- **Disk is the sleeper.** RRD + TSDB + syslog all grow continuously. 100 GB is comfortable for tens of devices and would not be for thousands.

**On FR-53 / 5,000 devices:** the docs put a single instance at "1,000+" and direct you to Distributed Polling beyond that. **A single host running LibreNMS + supporting services + Keycloak + a TSDB is not a 5,000-device platform**, and this ADR makes no such claim. FR-53's target belongs to Phase 3 distributed polling (FR-06/FR-09) on sized hardware, and AC-F#35 remains the re-scope candidate the requirement doc already flags.

---

## Decision 5 — Sequencing: this package is Phase 0's first gate

The deployment package precedes and **gates** the plan's real-API verification task (v1 Task 6, the ASM-1 confirmation), because that task's entire purpose is to replace assumption with measurement against a live API. `LIBRENMS_BASE_URL` points at this server once FR-58 passes.

Tasks that need no LibreNMS (workspace scaffold, shared types, BFF skeleton, simulator harness) proceed in parallel and are **not** blocked by it — that parallelism is what keeps the deployment's unknowns off the critical path for the developer.

## Consequences

**Positive:** FR-55's repeatability is a property of a versioned file rather than a promise; the SSO wiring is grounded in what LibreNMS actually supports instead of a plausible-sounding premise; the logout gap (AC-A#7) is identified before implementation; OQ-2 has a concrete resolution path.

**Negative:** we take on a TLS/authenticating proxy and a pinned fork of the upstream compose file as maintained artifacts. The header-injection trust boundary is now a permanent, high-severity security property of the deployment — it must be verified, not assumed, at every change.

**Neutral:** the native branch remains fully specified, so an unfavourable Docker answer costs a branch selection, not a redesign.

## Open questions — revision 1's list, and what is left

Revision 1's list is retained with its resolution, because which questions blocked and which did not is part of the record:

- **OQ-23** — *was* blocking on every host fact. **Partly closed:** host is `10.121.77.206`, access is SSH with credentials at the gitignored `Credentials.md`, and the host is authorized for agent execution. The remaining facts (OS + version, Docker availability, CPU/RAM/disk, sudo, shared-ness) were **not answerable by the human** and are now **discovered at runtime** by plan Task 0.1. That is a change of *mechanism*, not a downgrade: they still gate the install path.
- **OQ-24** — **closed: Docker Compose.**
- **OQ-25** — **closed: co-host Keycloak**, subject to the 4 vCPU / 8 GB floor check.
- **OQ-2** — **closed** by OQ-25's acceptance.
- **OQ-3** — **closed: TimescaleDB**, co-hosted here (ADR 0005 revision 2).
- **OQ-7** — role table accepted at G2; the level `5`/`global-read` refinement remains an implementation-time configuration detail.

### Still genuinely open after revision 2

- **Every fact in Task 0.1.** Until that step runs, Decision 1 rests on an *approved method* rather than a *verified capability*, and Decision 4's sizing rests on an assumed floor rather than measured specs. Both are honest gaps, and both are closed by one executed step.
- **TLS certificate source** (the former input #11). FR-56/FR-58 require HTTPS; whether that is a corporate CA, ACME, or a POC self-signed CA is undetermined, and if self-signed, the BFF host must be configured to trust it — the most common cause of a Task 6 failure that looks like a code bug.
- **Whether the host can reach the simulators over UDP 161** (the former input #12). Still the most-likely-to-surprise item in the package: if the simulators run on a developer laptop behind NAT, FR-58's "at least one device discovered and polled" fails for network reasons, not software ones.
