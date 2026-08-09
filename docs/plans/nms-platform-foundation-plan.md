# NMS Platform Foundation Implementation Plan (Phase 0 + Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Gate:** **G2 — APPROVED by the human on 2026-08-09.** Implementation is authorized. Next gate is G2.5 (Developer diff package).

**Goal:** Scaffold the Node/TypeScript monorepo and deliver SSO, a unified alarm console with working acknowledgment, and paginated device inventory — with LibreNMS as an unmodified collection engine behind a credential-holding BFF.

**Architecture:** npm workspaces monorepo (`shared`, `bff`, `web`, `simulator`). The BFF is the only component holding LibreNMS/TSDB/IdP credentials and the only path from browser to data; `web` never depends on `bff`. Authentication is BFF-mediated OIDC (Authorization Code + PKCE) with an opaque Redis-backed session, so no token ever reaches the browser.

**Tech Stack:** Node v24.16.0, npm 11.13.0 (both verified present), TypeScript (strict), Next.js (App Router) + React, Zod, Redis, Vitest + supertest, LibreNMS (PHP — external, unmodified), MariaDB, **TimescaleDB** (OQ-3 resolved), **Keycloak** (co-hosted, OQ-25 resolved).

**Design:** `docs/design/nms-platform-foundation.md` · **ADRs:** `docs/adr/0001`–`0008`

> **Revision 2 (2026-08-09) — task list changed.** OQ-22 resolved and grew scope: LibreNMS is **installed by this project** on a human-provided remote server (FR-54..58). **Six tasks inserted as `0.1`–`0.6`** (the deployment work package) between Task 0 and Task 1. **Tasks 1–13 keep their v1 numbers** — nothing renumbered, so all existing cross-references remain valid. **Task 0.6 GATES Task 6.** Tasks 1, 2, 3 and 12 need no LibreNMS and run in parallel with the deployment package.
>
> **Revision 3 (2026-08-09) — the execution posture is INVERTED, and it is the main change in this revision.** The human authorized agents to execute the deployment: *"use the credentials to deploy the solution."* Every step formerly marked `[HUMAN EXECUTES]` in Tasks 0.4a/0.4b/0.5/0.6 is now **`[DEVELOPER AGENT EXECUTES via SSH]`** against `10.121.77.206`, and Task 0.1 changed from "ask the human twelve questions" to "**SSH in and discover the answers**". Task 0.3's deliverable is no longer a human-runnable runbook but an **agent-executable runbook with an evidence contract**.
>
> Also folded in: **TimescaleDB** (OQ-3), **Keycloak co-hosted** (OQ-25, subject to a floor check), **Docker Compose** as the method (OQ-24) with the native branch demoted to a discovered-fact fallback, and **TR-069 simulator-tolerance-only** (OQ-21, ADR 0004 accepted).
>
> **Two things did NOT transfer to the agent, and both are load-bearing:**
> 1. **The pre-flight VM snapshot** — taken by the **human on the hypervisor/cloud console**. An agent inside the guest cannot snapshot the machine it is running on. **Deployment does not begin without a recorded snapshot ID.**
> 2. **Any destructive, irreversible, or pre-existing-service-affecting action** — STOP and confirm with the human.
>
> **Revision 4 (2026-08-09) — Task 0.1 EXECUTED, it raised three STOPs, and the human's resolution created a THIRD install branch.** Task 0.1's reconnaissance is complete (evidence: `.claude/team/artifacts/nms-platform-foundation/deployment/task-0.1-facts.md`) and returned **STOP**: the host is a **shared, domain-joined host with ~39 days uptime carrying a third party's Kafka/ZooKeeper estate plus two Python services owned by our own login account**; there is **no usable non-interactive sudo**; and **Docker and Compose are both absent** (Podman 5.6.0 is present).
>
> The human chose **option 3: proceed on this host with a minimal-footprint, rootless-Podman POC deployment, no sudo, with explicit consent to co-tenancy.** That fits **neither 0.4a (Docker Compose) nor 0.4b (native)**, so this revision adds **Task 0.4c** and makes it **the selected branch for this host**. 0.4a and 0.4b are **retained unchanged** as the documented paths for a future privileged or dedicated host — they are not dead, they are simply not selected here.
>
> **What this revision changes:** adds **Task 0.4c**; rewrites the **branch selector** (below); reconciles **Tasks 0.5 and 0.6** to unprivileged ports, `~/nms` paths, and SELinux labelling; adds a **POC limitations** section; and records a **requirement-level conflict on FR-56** that is routed to the human rather than silently resolved. **Tasks 0.2, 0.3 and 1–13 keep their numbers.** Task 0.2's Compose manifest becomes a **0.4a/0.4b-only artifact**; 0.4c's equivalent is authored inside Task 0.4c.

### Branch selection — DECIDED for `10.121.77.206` (revision 4)

| Branch | Method | Status for THIS host | Why |
|---|---|---|---|
| **0.4a** | Official Docker Compose | **NOT SELECTED — impossible here** | Docker absent, Compose v1 and v2 absent. Installing a container runtime is a system-wide change needing sudo we do not have, on a shared host. Retained for a future dedicated host |
| **0.4b** | Official native install | **NOT SELECTED — rejected here** | Needs sudo throughout (`useradd`, writes under `/opt`, package installs, PHP-FPM, MariaDB, snmpd, systemd *system* units). No usable sudo, and on this shared host it is the highest-blast-radius option available. Retained for a future dedicated host |
| **0.4c** | **Rootless Podman** | **SELECTED** | Podman **5.6.0 is already installed**, runs entirely unprivileged, confines all state to `~/nms`, and installs nothing system-wide. It is the only branch executable under the discovered facts |

**The decision is forced by discovered fact, not by preference.** ADR 0008 revision 2 still holds that Compose is the better *method* in the abstract; ADR 0008 **revision 3** records why it is unavailable here and what we give up. Anything in Tasks 0.2/0.3 that says "the selected branch is 0.4a" is superseded by this table.

### Credential hygiene — read this before Task 0.1 (Critical)

SSH credentials for `10.121.77.206` are in the **gitignored repo-root `Credentials.md`**. Rules, and they are absolute:

- **Read that file ONLY to establish the connection.** Nothing else.
- **NEVER** copy its contents — or any value from it — into any doc, config, log, artifact file, commit, handoff, status file, plan, or echoed command. **Reference the path only.**
- **NEVER `cat`, `type`, `echo`, `grep`, or otherwise print `Credentials.md` inside a command whose output is captured as evidence.** Evidence files are written from captured output; a credential printed once is a credential committed.
- Prefer `sshpass -f <path>` / `ssh` reading the file directly over interpolating a password into an argv that a shell history or a transcript will retain. **Never** write a password on a command line.
- After Task 0.1 Step 6 installs the project SSH key, **stop using password auth entirely** — key auth removes the credential from the loop.
- **A leak is a Critical finding.** Self-report immediately to Jarvis per team-protocol §6; do not attempt to quietly scrub it.
- Evidence redaction is **allow-list, not deny-list**: record the specific lines you intended to capture, not whole terminal scrollback.

## Global Constraints

- **Never modify LibreNMS core.** Integration via REST API, config, TSDB output, and standard SSO only (FR-07, G-6). A change needing a core patch stops and returns to the Technical Architect.
- **No LibreNMS API token, TSDB credential, IdP client secret, or SNMP community reaches a browser or the repository.** Runtime injection only (NFR-09).
- **`packages/web` MUST NOT depend on `@nms/bff`**; `packages/shared` MUST NOT import any other workspace (ADR 0001). Enforced by `npm run lint:deps`.
- **No browser-reachable `/api/v0/` LibreNMS proxy and no browser→TSDB connection** (CON-6, FR-08, FR-46, ADR 0002).
- **Every route declares its auth requirement explicitly.** `/health` and `/ready` are the only unauthenticated endpoints and return no operational data (NFR-16).
- **Authorization is server-side on every request**, from the server-side session only — never from a client-supplied role (NFR-11, FR-34).
- Toolchain versions are project facts: **Node v24.16.0, npm 11.13.0**. Do not propose upgrades. Dependencies are pinned in `package-lock.json`; a version change not called for by this plan is a defect (team-config §7).
- Commit policy is **manual**: never commit or push to `main`. Work on `feature/<ticket-id>-nms-platform-foundation` (ticket ID pending **OQ-20**). Task commits are local only; the human commits after G4.
- Coverage: **≥80% line coverage on new code**, with authorization and error paths explicitly tested (NFR-28).
- Logs are structured JSON with redaction at the logger layer; never log tokens, cookies, `Authorization` values, communities, or PII (NFR-15).
- **All previously-blocking open questions are RESOLVED as of G2 (2026-08-09):** OQ-2/OQ-25 Keycloak co-hosted (floor check applies); **OQ-3 TimescaleDB**; OQ-11 top-2 P2P vendors = **Cambium + Ubiquiti** (ADR 0007 revision 2, Phase 2 work — build nothing for it in Phase 0/1); OQ-12 flapping = **≥3 transitions in 5 min**, computed in the BFF; OQ-14 polling accepted; **OQ-21 TR-069 simulator-tolerance only** (ADR 0004 accepted — do NOT build an ACS); OQ-23 host `10.121.77.206`; **OQ-24 Docker Compose**. The only remaining unknowns are **runtime facts about the host**, discovered in Task 0.1 — they are not human-answerable and must not be guessed.
- **THE DEVELOPER AGENT EXECUTES THE DEPLOYMENT on `10.121.77.206` — and only there.** The human authorized this on 2026-08-09 (requirement doc §5.8, team-config §8, ADR 0008 revision 2). This overrides the general team-protocol §5 posture **for this one host**; it changes nothing about any other environment. Six guardrails are conditions of the authorization, not advice, and each is written into the steps that need it:
  1. **Credential hygiene (Critical)** — see the block above the Global Constraints. Path references only; never a credential in any file or echoed command.
  2. **Evidence per step** — every Task 0.x step records expected-vs-actual output under `.claude/team/artifacts/nms-platform-foundation/deployment/`, secrets redacted.
  3. **STOP before destruction** — disk/partition changes, OS upgrades or reinstalls, and removing/reconfiguring/stopping any pre-existing service: STOP, report, wait for the human.
  4. **STOP if the host is shared** — unrelated production services present: STOP and report **before installing anything**.
  5. **Facts first** — Task 0.1's SSH discovery runs before any install action and its findings select the install path.
  6. **Keycloak floor check** — co-host only if discovered specs **exceed** 4 vCPU / 8 GB; at or below, STOP and flag to the human.
- **The human still owns the pre-flight snapshot.** It is the only rollback for the native branch and the cheapest one for Compose. No install step runs before a snapshot ID is recorded.
- **Do not install a container runtime, change a kernel, add a third-party APT repository, or open a firewall port not in design §12.6 without reporting first.** Each is a host change, not a deployment detail.
- **Never modify LibreNMS core in the deployment either** (FR-07). Configuration is `lnms config:set`, `config.php`, and environment variables only — never an edit to a file under LibreNMS's source tree.
- **No `:latest` image tag anywhere**, and no secret in any committed file — including the deployment manifests (FR-55, NFR-09, repo Docker rules).

---

## Task 0: Preconditions (no code — verify before starting)

- [ ] **Step 1: Confirm G2 approval exists** — **satisfied**

G2 was approved by the human on 2026-08-09 (requirement doc revision history; handoff `g2-open-dispatch.md`). Implementation is authorized.

- [ ] **Step 2: Confirm the OQ-21 scope decision** — **satisfied: simulator-tolerance only**

OQ-21 is resolved as **option (a) in `docs/adr/0004-tr069-support-model.md` — simulator tolerance only** (ADR 0004 is now ACCEPTED). Task 12 builds a TR-069/CWMP-*tolerant* simulator so the platform is exercised against a device that speaks it; it does **NOT** build an ACS, and no TR-069 data path into LibreNMS is created. Real TR-069 monitoring is a **future separate work item with its own G1** and is out of scope here — treat any drift toward an ACS as scope creep and stop.

- [ ] **Step 3: Confirm the deployment preconditions**

**All human-answerable deployment questions are resolved** (OQ-23 host `10.121.77.206`, OQ-24 Docker Compose, OQ-25 Keycloak co-hosted with a floor check, OQ-3 TimescaleDB) and **agent execution is authorized** under the six guardrails in the Global Constraints. What remains is not a set of questions for the human but **runtime facts about the host**, discovered by **Task 0.1**.

Two hard preconditions before any step in Tasks 0.4–0.6:
1. **A pre-flight snapshot ID recorded by the human** on the hypervisor/cloud console (Task 0.1 Step 1). This does not transfer to the agent.
2. **No outstanding STOP** from Task 0.1 Step 4 (shared host, port conflict, no sudo, Keycloak floor).

`LIBRENMS_BASE_URL` is recorded at Task 0.6 Step 11, not here. **Task 6 is gated on Task 0.6.** Tasks 1, 2, 3 and 12 need no LibreNMS and proceed in parallel.

- [ ] **Step 4: Create the feature branch**

```bash
git checkout -b feature/<ticket-id>-nms-platform-foundation
```

Ticket ID is **OQ-20**; if unsupplied, ask Jarvis rather than inventing one.

---

## Phase 0 deployment package — Tasks 0.1–0.6 (FR-54..58) — **revision 3: executed by the Developer agent**

> **How the task list changed (revision 2, unchanged).** Six tasks are **inserted** as `0.1`–`0.6`, between Task 0 and Task 1. **Tasks 1–13 keep their v1 numbers** — nothing is renumbered, so every existing cross-reference in this plan, the design doc, and the ADRs stays valid.
>
> **Ordering:** `0.1 → 0.2 → 0.3 → 0.4a (0.4b only as a discovered-fact fallback) → 0.5 → 0.6`, and **Task 0.6 GATES Task 6** (the real-API/ASM-1 verification). Tasks 1, 2, 3, and 12 need no LibreNMS and **run in parallel** with the whole package.
>
> **WHO RUNS THESE — revision 3.** The **Developer agent** executes every step, including the server-touching ones, over SSH to `10.121.77.206`. The human's remaining responsibilities are exactly three: (1) take the **pre-flight snapshot**, (2) answer any **STOP** raised by a guardrail, (3) supply the **TLS certificate source** if it is not ACME. Everything else is the agent's.
>
> **Every step still states its expected output**, and now for a second reason: expected-vs-actual is the evidence contract. A step with no stated expectation cannot produce evidence, only transcript.

### Evidence contract — applies to every step in Tasks 0.1–0.6

- **Location:** `.claude/team/artifacts/nms-platform-foundation/deployment/`
- **One file per task:** `task-0.1-facts.md`, `task-0.4a-compose-install.md`, `task-0.5-tls-sso.md`, `task-0.6-verification.md`, and so on.
- **One row or block per step:** step ID, command **as run but with any secret replaced by `<REDACTED>`**, expected result, actual result (trimmed to the relevant lines), verdict PASS / FAIL / STOP.
- **Redaction is allow-list.** Capture the lines you intended; do not paste whole scrollback. Never capture the output of a command that reads `Credentials.md`, a `.env` file, an API token, an SNMP community, a client secret, or a database password.
- **Never** record the SSH password, the private key, or any `Credentials.md` content — not even redacted-looking fragments.
- A **STOP** verdict ends the task. Report to Jarvis and wait; do not work around a stop condition.

---

## Task 0.1: SSH fact-gathering — **[DEVELOPER AGENT EXECUTES via SSH]** — gates every later task

Revision 2 asked the human twelve questions. **Six of them were never human-answerable** (OS, Docker, CPU/RAM/disk, sudo, existing services, SNMP reachability), and the human has now authorized us to go and find out. This task is that discovery. **It is read-only: it installs nothing, changes nothing, starts nothing, and stops nothing.**

**Files:**
- Create: `.claude/team/artifacts/nms-platform-foundation/deployment/task-0.1-facts.md` (discovered facts + evidence; **no credentials, ever**)
- Create: `docs/design/librenms-deployment-inputs.md` (the durable fact sheet, distilled; **no credentials, no secrets**)

**Interfaces:**
- Consumes: the SSH endpoint `10.121.77.206` and credentials at the gitignored repo-root `Credentials.md` (**path reference only**).
- Produces: the facts that select the install branch (0.4a vs 0.4b), size the stack, and decide the Keycloak co-host. **Every later task in this package depends on this one.**

- [ ] **Step 1: Confirm the human has recorded a pre-flight snapshot ID — BLOCKING**

Ask Jarvis to confirm the human has taken a VM snapshot / image of `10.121.77.206` on the hypervisor or cloud console, and has recorded its identifier.

Expected: a snapshot identifier exists. **If not: STOP.** Do not proceed to any later task. Fact-gathering in Step 3 is read-only and may proceed while this is pending, but **no step in Tasks 0.4–0.6 runs without it.** This step does not transfer to the agent — an agent inside the guest cannot snapshot its own host.

- [ ] **Step 2: Establish SSH connectivity without leaking the credential**

Read `Credentials.md` **only** to obtain the username and password/key. Then connect:

```bash
# Password bootstrap. Note: the credential is read from the file by the tool,
# never placed on the command line, never echoed.
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 <user>@10.121.77.206 'true'
```

Expected: exit code 0, no output. A host-key line on first connect is normal; record the fingerprint (a fingerprint is not a secret).

**Do NOT** run any command that prints the credential. **Do NOT** paste the connection command with a password substituted into the evidence file — write `ssh <user>@10.121.77.206` and note "auth: password from `Credentials.md`".

If authentication fails: STOP and report. Do not retry more than twice — a lockout policy on an unknown host is a real risk, and repeated failures may themselves be the incident.

- [ ] **Step 3: Gather the facts — one read-only command block**

```bash
ssh <user>@10.121.77.206 'set -e
echo "== OS"; cat /etc/os-release 2>/dev/null | head -6; uname -srm
echo "== CPU"; nproc; grep -m1 "model name" /proc/cpuinfo || true
echo "== MEM"; free -h
echo "== DISK"; df -hT / /var /opt 2>/dev/null
echo "== VIRT"; systemd-detect-virt 2>/dev/null || echo unknown
echo "== DOCKER"; (docker --version 2>&1 || echo "docker: absent"); (docker compose version 2>&1 || echo "compose v2: absent"); (docker-compose --version 2>&1 || echo "compose v1: absent")
echo "== SUDO"; id; (sudo -n true 2>&1 && echo "sudo: passwordless" || echo "sudo: needs password or unavailable")
echo "== LISTENING"; (ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null) | head -40
echo "== SERVICES"; systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -40
echo "== SELINUX/FW"; (getenforce 2>/dev/null || echo "selinux: n/a"); (ufw status 2>/dev/null || firewall-cmd --state 2>/dev/null || echo "fw: unknown")
echo "== TIME"; timedatectl 2>/dev/null | head -5
'
```

Expected: every section prints. Record all of it (this output contains **no** credentials — but scan it before saving, because a process command line in `ss -tulpn` output occasionally carries one; redact if so).

- [ ] **Step 4: Evaluate the four STOP conditions — before anything else**

Read the Step 3 output against each condition. **Each is a hard stop, not a judgement call.**

| Condition | Test against Step 3 output | If true |
|---|---|---|
| **Host is shared with unrelated production services** | `SERVICES` / `LISTENING` shows services this project did not put there and does not need — a database serving something else, an app server, a web app on 80/443, a monitoring agent reporting elsewhere | **STOP.** Report the service list to Jarvis. **Install nothing.** Guardrail 4 |
| **Port conflict on a port we need** | Anything already bound to **80, 443, 3306, 6379, 162/udp, 514/udp**, or Keycloak's port | **STOP.** Report. Do **not** stop, move, or reconfigure the incumbent — that is guardrail 3 |
| **No usable sudo** | `sudo: needs password or unavailable` and no working escalation | **STOP.** The package cannot proceed; report |
| **Specs at or below the Keycloak floor** | `nproc` ≤ 4 **or** total RAM ≤ 8 GB (ADR 0008 floor: 4 vCPU / 8 GB — co-host only if specs **exceed** it) | **Continue LibreNMS, but STOP on Keycloak.** Flag to the human: co-hosting Keycloak on this host is not recommended; ask whether to proceed anyway, run Keycloak elsewhere, or stay on `AUTH_MODE=dev-local` longer. Guardrail 6 |

Also evaluate, and report rather than stop: disk below ~60 GB free on the LibreNMS/Docker filesystem (ADR 0008 floor), and an OS that is neither Docker-capable nor on the LibreNMS native-supported list.

- [ ] **Step 5: Select the install branch from the facts (do not assume)**

| Discovered | Branch |
|---|---|
| `docker --version` OK **and** `docker compose version` OK | **Task 0.4a (Compose)** — the approved method (OQ-24) |
| Docker present, **Compose v2 absent** (only `docker-compose` v1) | **Report, do not proceed.** The manifest targets Compose v2; ask whether to install the v2 plugin |
| **Docker absent** | **Report, do not proceed.** Docker Compose is the *approved method*, but installing a container runtime on this host is a **host change** (guardrail 3). Ask the human: install Docker, or fall back to **Task 0.4b (native)**. **Task 0.4b exists precisely for this branch and must not be treated as dead** — an approved method is not a verified capability |

- [ ] **Step 6: Install a project SSH key for non-interactive automation**

Every later task runs unattended, and password auth in an automated loop is both fragile and the main way a credential ends up in a transcript. So switch to keys, on the Windows 11 OpenSSH client:

```bash
# Local (developer machine). Passphrase-less because it drives automation;
# the key file itself is the secret and MUST be gitignored.
ssh-keygen -t ed25519 -f "$HOME/.ssh/nms_deploy_ed25519" -N "" -C "nms-platform-foundation-deploy"

# Install the public key (public keys are not secrets):
ssh <user>@10.121.77.206 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys" < "$HOME/.ssh/nms_deploy_ed25519.pub"

# Verify key auth works and password auth is no longer needed:
ssh -i "$HOME/.ssh/nms_deploy_ed25519" -o PasswordAuthentication=no -o BatchMode=yes <user>@10.121.77.206 'echo key-auth-ok'
```

Expected: `key-auth-ok`. All later steps use `-i ~/.ssh/nms_deploy_ed25519`.

**Constraints:** the **private key never enters the repository** — confirm `~/.ssh/` is outside the repo (it is) and never copy it in. The **public** key may appear in evidence; the private key never may. This step is *additive* to `authorized_keys` (`>>`, not `>`) — overwriting an existing `authorized_keys` would remove someone else's access, which is a guardrail-3 destructive action.

After this step, **stop using the password**. `Credentials.md` should not need to be read again.

- [ ] **Step 7: Confirm the remaining decisions that change the service list**

Already resolved and to be applied, not asked: **TimescaleDB** (OQ-3) is a service in the manifest; **Keycloak** is co-hosted (OQ-25) **subject to Step 4's floor check**; **RRD is kept alongside** (OQ-4). Record these as decided, with their source (team-config §8).

Still to obtain from the human, and it is genuinely outstanding: the **TLS certificate source** — corporate CA, ACME/Let's Encrypt (needs inbound 80 and public DNS, which the Step 3 firewall facts inform), or a POC self-signed CA. If self-signed, note that the BFF host must be configured to trust that CA — a real step, and the commonest cause of a Task 6 failure that looks like a code defect.

- [ ] **Step 8: Write the evidence file and the durable fact sheet**

`task-0.1-facts.md` gets the per-step expected-vs-actual record. `docs/design/librenms-deployment-inputs.md` gets the distilled durable facts: OS + version, vCPU, RAM, disk free, virtualisation, Docker/Compose versions, sudo mode, pre-existing services, listening ports, selected branch, Keycloak verdict, snapshot ID.

**Neither file contains a credential, a token, a community string, or a password.** The host IP is already in team-config and may appear.

- [ ] **Step 9: Report to Jarvis**

Selected branch, Keycloak verdict, any STOP raised, and the evidence path. **If any STOP was raised, this is where the package pauses.**

- [ ] **Step 10: Commit the fact sheet**

```bash
git add docs/design/librenms-deployment-inputs.md
git commit -m "docs: record discovered LibreNMS host facts and selected install branch"
```

---

## Task 0.2: Author the pinned Compose manifest (authoring only — nothing is executed)

Run this task when Task 0.1 Step 5 selected **0.4a**. Revision 3: the service list is now fixed rather than conditional — **TimescaleDB and Keycloak are both in** (Keycloak subject to Task 0.1 Step 4's floor verdict).

**Files:**
- Create: `deploy/librenms/compose.yml`, `deploy/librenms/.env.example`, `deploy/librenms/proxy/Caddyfile` (or `nginx.conf`), `deploy/librenms/README.md`
- Create: `.gitignore` entry for `deploy/librenms/.env`

**Interfaces:**
- Consumes: Task 0.1's discovered facts (OS, sizing, Docker version, Keycloak verdict).
- Produces: the manifest the agent applies in Task 0.4a. **This is a file in this repo — authoring it executes nothing.**

- [ ] **Step 1: Vendor the official example as the starting point**

Base it on `github.com/librenms/docker`, `examples/compose/compose.yml`. Keep its service shape: `db`, `redis`, `librenms`, `dispatcher` (`SIDECAR_DISPATCHER=1`), `syslogng` (`SIDECAR_SYSLOGNG=1`), `snmptrapd` (`SIDECAR_SNMPTRAPD=1`), `msmtpd`.

- [ ] **Step 2: Pin every image — no `latest` anywhere**

The upstream example uses `librenms/librenms:latest` and `crazymax/msmtpd:latest`. Replace every tag with an explicit version (digest preferred). Record the chosen versions in `deploy/librenms/README.md`.

Verify with a grep that must return nothing:

```bash
grep -n ":latest" deploy/librenms/compose.yml
```
Expected: **no output** (exit code 1). Any hit is a defect: `latest` breaks FR-55's repeatability and the repo's Docker rules.

- [ ] **Step 3: Do NOT publish LibreNMS's own port; add the TLS/authenticating proxy**

Remove the upstream `ports: 8000:8000` publication. LibreNMS is reachable only on the internal compose network. Add a `proxy` service publishing **443** (and 80 only if ACME is used) that terminates TLS and performs the OIDC authentication (design §12.4).

Verify:

```bash
grep -nE "^\s+-\s+target:\s+8000" -A2 deploy/librenms/compose.yml
```
Expected: **no published mapping for LibreNMS's HTTP port.** If LibreNMS is directly reachable, the header-injection protection in design §12.4 is void — this is the Critical item.

- [ ] **Step 4: Add RRDCached**

Not present upstream, required by FR-54. Pin a version providing **rrdcached ≥1.5.5** (below that a shared filesystem becomes mandatory, per the official RRDCached feature matrix). Mount the same RRD volume as `librenms` and `dispatcher`.

- [ ] **Step 5: Add TimescaleDB (OQ-3 resolved) — pinned**

Add a `timescaledb` service on a pinned TimescaleDB/Postgres image. **Not published to the host** — internal network only, same rule as MariaDB and Redis (design §12.6). Its credential lives in the server-side `.env`, and only the BFF and LibreNMS's writer read it. **No browser→TSDB path exists and none is added** (ADR 0002, CON-6).

Configure LibreNMS's metric output to write to it. Note in `README.md` that the LibreNMS→Timescale write path is **less travelled than the Influx one** and is **verified, not assumed**, at Task 0.6 (ADR 0005 revision 2, Decision point 2).

- [ ] **Step 6: Add Keycloak + its database — only if Task 0.1 Step 4's floor check PASSED**

Pinned images. Keycloak reachable **through the proxy over 443 only**; its own port is not published. Two OIDC clients get registered later (Task 0.5): `nms-custom-ui` for the BFF, and the `oauth2-proxy` client for the native UI.

**If the floor check flagged (≤4 vCPU or ≤8 GB): do not add these services.** Leave a commented, clearly-labelled block and record in `README.md` that Keycloak is pending a human decision. Adding it anyway is a guardrail-6 violation.

- [ ] **Step 7: Author `.env.example` with placeholders only**

Every variable the manifest needs — `MYSQL_PASSWORD`, `TIMESCALE_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `LIBRENMS_API_TOKEN` (created later, in Task 0.6), the OIDC client secret, the SNMP community — present as **placeholders**, never real values. Add `deploy/librenms/.env` to `.gitignore`.

Verify no secret is committed:

```bash
git check-ignore -v deploy/librenms/.env
grep -rnE "(password|secret|token|community)\s*=\s*[^<$[:space:]]" deploy/librenms/.env.example
```
Expected: the first command confirms the ignore rule matches; the second returns **no output** (every value is a placeholder).

- [ ] **Step 8: Commit**

```bash
git add deploy/librenms .gitignore
git commit -m "feat(deploy): add pinned LibreNMS compose manifest with TimescaleDB, Keycloak, and TLS/auth proxy"
```

---

## Task 0.3: Write the agent-executable runbook and the evidence scaffold

Revision 3 changes this task's deliverable. It is no longer "a document a human follows" — it is **the ordered command sequence the agent executes, plus the evidence file scaffold it fills in**. The reader is now also the runner, which removes one class of ambiguity and adds another: an agent will happily run a wrong command that a human would have paused at. So the runbook's job shifts from *explaining* to *constraining*.

**Files:**
- Create: `docs/design/librenms-deployment-runbook.md`
- Create: `.claude/team/artifacts/nms-platform-foundation/deployment/README.md` (evidence index + the redaction rules, restated where the evidence is written)

**Interfaces:**
- Consumes: Task 0.1's discovered facts; Task 0.2's manifest.
- Produces: the ordered, per-step, expected-output sequence the agent executes in Tasks 0.4–0.6, and the evidence scaffold it writes into.

- [ ] **Step 1: Write the runbook as numbered steps, each with expected output AND a stop condition**

One step = one command (or one file edit) = one observable expected result = one explicit "stop if". Include at the top: the branch selected and the fact that selected it, the recorded snapshot ID, the redaction rules, and the rollback procedure from design §12.8.

**Every step gets an explicit stop condition**, not just the ones that seem risky. A step with no stop condition reads to an executing agent as "continue regardless", which is exactly the failure mode the authorization introduces.

- [ ] **Step 2: Record the snapshot ID as step 1 of the runbook — human-owned**

```
# HUMAN, on the hypervisor / cloud console — NOT on the host, NOT the agent:
# take a VM snapshot / image of 10.121.77.206 and record its ID here: ____
```
Expected: a recorded snapshot identifier. **The runbook's step 2 refuses to start without it.** On the native branch this is the *only* real rollback (design §12.8). This is the one step the deployment authorization does not transfer, because an agent inside the guest cannot snapshot the machine it is running on.

- [ ] **Step 3: Write the redaction rules into the evidence scaffold, not just into this plan**

`deployment/README.md` states: allow-list capture; never record `Credentials.md` content, `.env` content, API tokens, community strings, client secrets, or DB passwords; every recorded command shows `<REDACTED>` in place of any secret; one file per task; PASS/FAIL/STOP per step.

The rules live next to the files they govern because that is where they will actually be read.

- [ ] **Step 4: Include both branches, clearly separated**

`0.4a` (Compose — the approved method) and `0.4b` (native — the fallback if Task 0.1 found Docker absent) as separate sections with the selector at the top: "Task 0.1 Step 5 selected: ____". Do not interleave them.

- [ ] **Step 5: Commit**

```bash
git add docs/design/librenms-deployment-runbook.md .claude/team/artifacts/nms-platform-foundation/deployment/README.md
git commit -m "docs: add agent-executable LibreNMS deployment runbook and evidence scaffold"
```

---

## Task 0.4a: Install via official Docker Compose — **[DEVELOPER AGENT EXECUTES via SSH]**

The approved method (OQ-24; ADR 0008 Decision 1). Selected when Task 0.1 Step 5 found Docker + Compose v2 present.

**Preconditions — all four, checked before Step 1:** snapshot ID recorded; no STOP outstanding from Task 0.1 Step 4; branch = 0.4a; key auth working.

**Files:** `.claude/team/artifacts/nms-platform-foundation/deployment/task-0.4a-compose-install.md` (evidence). Nothing else in this repo.

**Stop conditions for this whole task:** any command that would stop, remove, or reconfigure a pre-existing service; any `docker system prune`, volume removal, or `down -v`; any disk or partition operation; any package removal. **STOP and confirm with the human.** `docker compose up -d` on our own project directory is additive and is fine; anything that touches state we did not create is not.

- [ ] **Step 1: Re-confirm the snapshot ID and the absence of outstanding STOPs**

Expected: snapshot ID present in `docs/design/librenms-deployment-inputs.md`; no unresolved STOP. **If either is missing: STOP.** Do not proceed.

- [ ] **Step 2: Re-confirm Docker and Compose are usable as the deploying user**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'docker --version && docker compose version && docker info --format "{{.ServerVersion}} {{.Driver}}"'
```
Expected: versions print and `docker info` succeeds **without sudo**. If it needs sudo, use `sudo docker` consistently and record that; do **not** add the user to the `docker` group — that is a privilege change to the host, and it is a guardrail-3 report-first action.

- [ ] **Step 3: Copy the manifest and create the real `.env` — no secret in any captured output**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'mkdir -p ~/nms-deploy && chmod 700 ~/nms-deploy'
scp -i ~/.ssh/nms_deploy_ed25519 -r deploy/librenms/* <user>@10.121.77.206:~/nms-deploy/
```

Then generate the secrets **on the server**, so they never traverse a local shell history or an evidence file:

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
cd ~/nms-deploy
[ -f .env ] || cp .env.example .env
chmod 600 .env
# Generate strong values in place. Note: values are NEVER printed.
for k in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD TIMESCALE_PASSWORD KEYCLOAK_ADMIN_PASSWORD; do
  v=$(openssl rand -base64 30 | tr -d "=+/" | cut -c1-32)
  sed -i "s|^${k}=.*|${k}=${v}|" .env
done
# Prove the shape WITHOUT revealing values:
awk -F= "/^[A-Z_]+=/ {print \$1\"=<set:\"length(\$2)\">\"}" .env
'
```
Expected: every required key prints as `KEY=<set:NN>` with `NN` > 0. **The evidence file records exactly this masked listing and nothing more.** `.env` is mode `600` and is not inside any git repo on the server.

**Do not** `cat .env`. **Do not** pass a generated password back over the wire. If a value must be shared with the BFF later (the TimescaleDB credential, the API token), it is transferred by the human or read directly into runtime config — never into a doc.

- [ ] **Step 4: Bring up the stack**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cd ~/nms-deploy && docker compose up -d && sleep 45 && docker compose ps'
```
Expected: every service `running`; those with healthchecks report `healthy`. `db` may take a minute on first start while it initialises. Re-run `docker compose ps` rather than assuming.

**Stop if:** any service is in a crash loop after two checks, or a port bind fails (a bind failure means Task 0.1 Step 4's port-conflict check missed something — **STOP and report**, do not free the port).

- [ ] **Step 5: Run the LibreNMS validator (the docs' own tool)**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cd ~/nms-deploy && docker compose exec -T --user librenms librenms php validate.php'
```
Expected: no `[FAIL]` lines. Warnings about optional components are acceptable; record them. **Any FAIL stops the task** — report to Jarvis rather than continuing onto a broken base.

- [ ] **Step 6: Confirm RRDCached is being used**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cd ~/nms-deploy && docker compose exec -T rrdcached rrdcached -h 2>&1 | head -2; docker compose logs rrdcached --tail 20'
```
Expected: rrdcached version **≥1.5.5** and no permission errors. Then set `rrdtool_version` to the exact version, as the official RRDCached doc requires:

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cd ~/nms-deploy && docker compose exec -T --user librenms librenms lnms config:set rrdtool_version "<exact-version>"'
```
**Stop if** the version is below 1.5.5 — a shared filesystem then becomes mandatory, which is an infrastructure decision for the human, not a config tweak.

- [ ] **Step 7: Confirm the dispatcher is scheduling, not cron**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cd ~/nms-deploy && docker compose logs dispatcher --tail 30'
```
Expected: dispatcher startup and worker activity. Tune workers **down** from the upstream default of 24 to suit the **discovered** vCPU count from Task 0.1 (the official dispatcher doc warns too many workers overload the hardware):

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cd ~/nms-deploy && docker compose exec -T --user librenms librenms lnms config:set service_poller_workers <n> && docker compose restart dispatcher'
```
Settings are not applied until the service restarts — the doc is explicit. Justify `<n>` from the measured core count in the evidence file, not from a default.

- [ ] **Step 8: Confirm TimescaleDB is up and reachable from LibreNMS only**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cd ~/nms-deploy && docker compose exec -T timescaledb pg_isready; docker compose port timescaledb 5432 || echo "not published (correct)"'
```
Expected: `accepting connections`, and **`not published (correct)`** for the port check. A published 5432 is a defect — fix the manifest, do not accept it. Metric arrival is verified at Task 0.6, not here.

- [ ] **Step 9: Write evidence and report to Jarvis**

Per-step expected-vs-actual with the masked `.env` listing, plus PASS/FAIL/STOP. Do **not** proceed to Task 0.5 with any step failed.

---

## Task 0.4b: Install natively per the official procedure — **[DEVELOPER AGENT EXECUTES via SSH]** — FALLBACK ONLY

**This branch is NOT dead and is NOT the plan of record.** Docker Compose is the approved method (OQ-24). This branch runs **only** if Task 0.1 Step 5 discovered that Docker or Compose v2 is unavailable on `10.121.77.206` **and** the human, having been told, chose native over installing Docker. It is retained because "Compose is approved" and "Docker is installed on that host" are different claims, and only the first was established at G2.

**Its FR-55 compliance requires configuration management** (design §12.5b, ADR 0008 Decision 1), and under agent execution its rollback story is materially worse than Compose's — see the stop conditions.

**Stop conditions for this whole task — stricter than 0.4a, deliberately.** This branch installs packages, creates users, and edits system-wide configuration directly on the host. **STOP and confirm with the human before:** adding any third-party APT/YUM repository (including `packages.sury.org`); installing or reconfiguring MariaDB, Redis, Nginx/Apache, or PHP-FPM **if any of them already exists** on the host; removing any cron entry not created by us; changing any existing web-server vhost. If Task 0.1 found the host shared, **this branch should not run at all.**

- [ ] **Step 1: Re-confirm the snapshot ID — hard gate on this branch**

Expected: recorded snapshot ID. **There is no clean uninstall on this branch** (design §12.8). Without a snapshot, a failed install is repaired by rebuilding the host. **No snapshot → STOP.**

- [ ] **Step 2: Confirm the OS is on the officially supported list**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'cat /etc/os-release'
```
Expected: Ubuntu 26.04/24.04, Debian 12/13, or a supported RHEL-family release. **Anything else: STOP and report.** The official instructions are tabbed per OS; following the wrong tab produces a subtly broken install.

- [ ] **Step 3: Check the PHP situation before installing anything**

The docs require **PHP ≥8.4, 8.5 recommended**.

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'apt-cache policy php8.5-fpm 2>/dev/null | head -5 || true'
```
Expected: either a distro candidate ≥8.4, or the finding that `packages.sury.org` is needed. **Adding a third-party repository is a host change: STOP and get explicit confirmation.** It is a permanent supply-chain dependency and an upgrade obligation, and it is exactly the kind of thing that should not happen as a side effect of an automated step.

- [ ] **Step 4: Check for pre-existing MariaDB / Redis / web server BEFORE installing**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'for s in mariadb mysql redis-server nginx apache2 php-fpm; do printf "%s: " "$s"; systemctl is-active "$s" 2>/dev/null || echo absent; done'
```
Expected: all `absent` or `inactive`. **Any active: STOP.** Installing over or reconfiguring a running service someone else depends on is guardrail 3, and on this branch it is the single most likely way to break something unrelated.

- [ ] **Step 5: Follow the official install sequence, one step at a time, capturing each**

From `https://docs.librenms.org/Installation/Install-LibreNMS/`, using the tab for the exact OS from Step 2: required packages → `useradd librenms` → `git clone` into `/opt/librenms` → `chown`/`chmod 771`/`setfacl` → `composer_wrapper.php install --no-dev` → `date.timezone` in both `fpm` and `cli` `php.ini` + `timedatectl` → MariaDB (`innodb_file_per_table=1`, `lower_case_table_names=0`, database + user + grant) → PHP-FPM `librenms` pool → web-server vhost → `lnms` symlink + completion → `snmpd.conf` from the example with a **real community string generated on the host and never printed** → dispatcher service (`misc/librenms.service`) and `rm /etc/cron.d/librenms` → logrotate.

Expected after each: exit 0. Record each command and its result. **Never echo the MariaDB password or the SNMP community into captured output** — generate them on the host, write them straight into the config, and record only `<REDACTED>`.

- [ ] **Step 6: Install and configure RRDCached (FR-54)**

`apt install rrdcached`, then `/etc/default/rrdcached` per the official doc (`BASE_PATH=/opt/librenms/rrd/`, `DAEMON_USER/GROUP=librenms`, journal path, `WRITE_JITTER`/`WRITE_THREADS`/`WRITE_TIMEOUT`), fix journal ownership, restart.

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'rrdcached -h 2>&1 | head -2; systemctl is-active rrdcached'
```
Expected: version **≥1.5.5** and `active`. Then set `rrdtool_version` to the exact version.

- [ ] **Step 7: Install TimescaleDB (OQ-3) and, if the floor check passed, Keycloak**

Both are additional services on this branch and both are **reachable on loopback only**. **If Task 0.1 Step 4 flagged the Keycloak floor: install TimescaleDB, skip Keycloak, report.**

- [ ] **Step 8: Complete the web installer**

The installer is a browser flow. Drive it over the proxy once Task 0.5 Step 1 has TLS up, or complete it via `lnms` where possible. If `config.php` must be created manually:

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'sudo chown librenms:librenms /opt/librenms/config.php'
```
Expected: installer completes; login page reachable.

- [ ] **Step 9: Validate**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'sudo su - librenms -c "./validate.php"'
```
Expected: no `[FAIL]`.

- [ ] **Step 10: Note the FR-55 debt explicitly**

This branch is not yet "repeatable" in FR-55's sense. Record in `docs/design/librenms-deployment-runbook.md` that configuration management is outstanding, and report it to Jarvis as a known gap. **Do not mark FR-55 satisfied on this branch** on the strength of a runbook alone.

- [ ] **Step 11: Write evidence and report to Jarvis** — per-step expected-vs-actual, PASS/FAIL/STOP, secrets redacted.

---

## Task 0.4c: Install via rootless Podman — **[DEVELOPER AGENT EXECUTES via SSH]** — **THE SELECTED BRANCH for `10.121.77.206`**

**Why this branch exists.** Task 0.1 discovered Docker absent, Compose absent, no usable sudo, and a shared host running a third party's production Kafka/ZooKeeper estate. The human resolved the resulting STOP with **option 3**: proceed here anyway, rootless, minimal-footprint, no sudo, with explicit consent to co-tenancy. This task is that install. It is a **POC deployment on borrowed ground**, and every step below is written to make that literal rather than aspirational.

**Files:**
- Create: `.claude/team/artifacts/nms-platform-foundation/deployment/task-0.4c-podman-install.md` (evidence)
- Create: `deploy/librenms-podman/` in THIS repo — the quadlet unit set, `.env.example`, a `containers.conf` fragment, and `README.md`. Authoring these executes nothing; they are copied to the host in Step 6.

**Interfaces:**
- Consumes: Task 0.1's discovered facts (Podman 5.6.0, CentOS Stream 9, SELinux Enforcing, 35 GB free on `/`, occupied ports).
- Produces: a running LibreNMS stack owned entirely by the deploying account under `~/nms`, reachable on **8080/8443**, with traps on **1162/udp** and syslog on **1514/udp**.

### Non-negotiable ground rules for this whole task

These are not advisory. Each maps to a human-specified constraint, and violating any of them is an ABORT, not a judgement call.

| Rule | Concretely |
|---|---|
| **Nothing system-wide** | No `sudo`, no `dnf`, no writes under `/etc`, no system systemd unit, no SELinux policy change, no sysctl. Every artifact lives under `$HOME`. |
| **Storage only under `~/nms`** | **Never `/opt/airlinq`** — that is the third party's 149 GB application volume and it holds their Kafka data. Our tree is `~/nms/` and nothing else. |
| **Zero modification of anything pre-existing** | Do not edit, move, restart, or "tidy" any existing file, process, cron entry, or service. |
| **Off-limits entirely** | **Kafka (9092), ZooKeeper (2181), port 8077 (`cli/serve.py`), port 5000 (`local_rag`), Samba (139/445/137/138), CUPS (631), the JVM ephemerals (33793/46527).** Do not bind them, probe them destructively, or reconfigure them. |
| **Append-only for the two shared files we may touch** | `~/.ssh/authorized_keys` (Step 2) and, only if unavoidable, `~/.config/containers/containers.conf` (Step 5). Both **append-only, with a comment identifying the block as ours.** The existing `@reboot` crontab entry for `stc-cmp-wisdom` is **never touched** — see Step 9. |
| **Unprivileged ports only** | 8080/tcp, 8443/tcp, 1162/udp, 1514/udp. Rootless Podman **cannot** bind below 1024 — official `rootless.md`: *"Podman can not create containers that bind to ports < 1024"* — and every documented workaround (kernel firewall rule, `redir`, lowering `net.ipv4.ip_unprivileged_port_start`) requires root we do not have. |

### Standing aborts — check at EVERY step, and write the verdict into the evidence file

1. **Anything requires `sudo`** → **STOP**, report to Jarvis. Do not attempt it, and never pipe the SSH password into it.
2. **Any sign of interference with an existing workload** — a colliding port bind, a Kafka/ZooKeeper state change, a service restart we did not cause, an OOM event, load average climbing sharply → **ABORT immediately**, tear down what we started (Step 11), report.
3. **Disk on `/` above 80%** → **STOP**. Baseline is 29% used / 35 GB free. `df -h /` is checked before and after every image pull and before the stack starts.

- [ ] **Step 1: Re-confirm preconditions — four gates, all mandatory**

Expected, all four:
1. **Snapshot ID recorded** by the human for `10.121.77.206`. Task 0.1 Step 1 recorded this as **OUTSTANDING**. **If it is still outstanding: STOP.** On a shared host running someone else's production Kafka this is the only rollback covering a mistake we did not anticipate, and it matters *more* here than on the other branches, not less: "rootless" bounds our blast radius by design but does not eliminate it.
2. **The human's option-3 consent is recorded** (plan revision 4 + ADR 0008 revision 3).
3. **Key auth working** (Step 2 establishes it).
4. **The branch selector reads 0.4c.**

- [ ] **Step 2: Install the project SSH key — append-only, commented**

Task 0.1 Step 6 deliberately held this back pending consent. Consent is now given, so it proceeds — with the append-only discipline it was always specified to have.

```bash
# The public key is not a secret. The private key NEVER enters the repo.
# The comment line identifies the block as ours, so the account's owner can
# see what we added and remove it together with the key in one operation.
{ echo "# nms-platform-foundation deploy key (added 2026-08-09 by NMS project; safe to remove with this line)";
  cat "$HOME/.ssh/nms_deploy_ed25519.pub"; } \
  | ssh <user>@10.121.77.206 'umask 077; mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'
```

Expected: exit 0. Before running it, record the existing line count. Then verify **without** the password and confirm nothing was clobbered:

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 -o PasswordAuthentication=no -o BatchMode=yes <user>@10.121.77.206 \
  'echo key-auth-ok; wc -l < ~/.ssh/authorized_keys'
```

Expected: `key-auth-ok`, and a line count **exactly 2 greater** than the pre-existing count (our comment + our key). **If the count suggests anything was replaced: STOP** — that means `>>` was typed as `>` and another party's access may have been removed, which is the most damaging accident available in this task.

**After this step, stop using the password.** `Credentials.md` is not read again.

- [ ] **Step 3: Re-verify the host facts this branch depends on — cheap, and they may have drifted**

Task 0.1's facts are hours old on a host we do not control. Re-check, read-only, the ones that would invalidate the plan:

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
echo "== PODMAN"; podman version --format "{{.Client.Version}}"; podman info --format "{{.Host.Security.Rootless}} {{.Store.GraphDriverName}}"
echo "== DISK"; df -h / | tail -1
echo "== PORTS-WE-WANT"; ss -tulpn 2>/dev/null | grep -E ":(8080|8443|1162|1514)\b" || echo "all four free"
echo "== PORTS-OFFLIMITS-ALIVE"; ss -tulpn 2>/dev/null | grep -cE ":(9092|2181|8077|5000)\b"
echo "== SELINUX"; getenforce
echo "== SUBIDS"; grep "^$(id -un):" /etc/subuid /etc/subgid || echo "NO-SUBIDS"
'
```

Expected:
- `5.6.0`, rootless `true`, graph driver **`overlay`**.
- Disk **at or below 80%** used. Above → **STOP** (standing abort 3).
- **`all four free`** for 8080/8443/1162/1514. Any occupant → **STOP**; do not pick a different port unilaterally — an unexpected occupant means the host changed under us, and the human chose these ports.
- The off-limits count is **4** (all still running). Below 4 means something we were told not to touch has stopped → **ABORT and report**: we must neither be the plausible cause of a third-party outage nor proceed into an unstable host.
- `Enforcing`.
- **`/etc/subuid` and `/etc/subgid` contain a range for our user.** This is the one fact Task 0.1 did **not** capture, and rootless Podman **cannot function without it** — user namespaces need a sub-UID/GID allocation. `NO-SUBIDS` → **STOP**: populating those files needs root, so it is a sudo requirement in disguise. Podman 5.6.0 merely being installed is *not* evidence the range exists; verify, do not infer.

- [ ] **Step 4: Author the quadlet unit set in this repo — nothing executes**

Rootless quadlet files live in **`~/.config/containers/systemd/`**, a per-user path needing no privilege. Official `podman-systemd.unit(5)`: *"Quadlet files for non-root users can be placed in the following directories: `$XDG_RUNTIME_DIR/containers/systemd/`, `$XDG_CONFIG_HOME/containers/systemd/` or `~/.config/containers/systemd/`"*. We author them here, version-controlled, which satisfies FR-55's repeatability the same way the Compose file would have.

Create under `deploy/librenms-podman/`:

| File | Purpose |
|---|---|
| `nms.network` | One dedicated Podman network named `nms` → generates `nms-network.service`. Isolates our containers from everything else on the host |
| `nms-db.container` | MariaDB — **not published**, reachable only on the `nms` network |
| `nms-redis.container` | Redis — **not published** |
| `nms-rrdcached.container` | RRDCached ≥1.5.5 — **not published** |
| `nms-timescaledb.container` | TimescaleDB — **not published** |
| `nms-librenms.container` | LibreNMS web/PHP-FPM — **not published**; the proxy reaches it over the `nms` network |
| `nms-dispatcher.container` | `SIDECAR_DISPATCHER=1` |
| `nms-snmptrapd.container` | `SIDECAR_SNMPTRAPD=1`, `PublishPort=1162:162/udp` |
| `nms-syslogng.container` | `SIDECAR_SYSLOGNG=1`, `PublishPort=1514:514/udp` |
| `nms-proxy.container` | TLS + OIDC authenticating proxy. `PublishPort=8080:8080` and `PublishPort=8443:8443` — the only two published TCP ports |
| `nms-keycloak.container`, `nms-kcdb.container` | Per the Keycloak verdict — see Step 12 |
| `.env.example` | Placeholders only |
| `README.md` | Pinned versions, the port table, the retention policy, and the teardown procedure |

**Naming rule:** every container, network, volume, and unit is prefixed **`nms-`** / `nms`. Task 0.1 found no `nms*` anything on the host, so the prefix cannot collide with Kafka, ZooKeeper, `local_rag`, `stc-cmp-wisdom`, or Samba. Record that collision check in the evidence.

Four authoring rules that are correctness requirements, not style:

1. **Pin every image.** No `latest`, exactly as 0.4a required. Verify: `grep -rn "Image=.*:latest" deploy/librenms-podman/` → **no output**.
2. **Publish only 8080, 8443, 1162/udp, 1514/udp.** Verify: `grep -rn "^PublishPort=" deploy/librenms-podman/` returns **exactly four lines**, none naming a host-side port below 1024.
3. **SELinux labels — the `:z` vs `:Z` distinction is load-bearing and a literal reading of the constraint would break the stack.** Per `podman-run(1)`: `:Z` labels content with a **private unshared** label — *"Only the current container can use a private volume"* — while `:z` applies a **shared** label letting multiple containers read/write. The **RRD tree is mounted by `librenms`, `dispatcher`, AND `rrdcached`** — three containers. Labelling it `:Z` would break the stack, and it would present as confusing permission-denied errors rather than an obvious misconfiguration. Therefore:
   - **`:z` (shared)** on the RRD tree and any other bind mount with more than one consumer.
   - **`:Z` (private)** on single-consumer bind mounts (MariaDB data, TimescaleDB data, Keycloak DB data).
   - Record the label chosen per mount, **with its consumer count**, in `README.md`.
   - **No `chcon`, no `semanage`, no policy change.** `:z`/`:Z` relabelling is performed by Podman as our own user on our own files under `$HOME`, which needs no privilege.
   - *Alternative considered, not selected:* place every container in one `.pod`. The doc notes all containers in a pod share a single SELinux label, which makes `:Z` safe even for shared mounts. Rejected because a shared pod also shares one network namespace and therefore one port space, coupling the sidecars more tightly than this topology wants and making the "exactly four published ports" check harder to reason about. Revisit if per-mount labelling proves fiddly in practice.
   - **The amendment handoff says "`:Z` labels"; this step implements that intent correctly rather than literally.** The deviation is recorded here and in ADR 0008 revision 3.
4. **Ownership inside the container.** Rootless containers map our UID into a namespace, so a bind mount we create can appear as `nobody` to a container process running as a service user. Where an image needs a specific UID (MariaDB, Postgres), use `UserNS=keep-id:uid=<n>,gid=<n>` — the pattern the official `podman-run(1)` examples use for exactly this case (`--userns=keep-id:uid=999,gid=999 -v ~/data:/var/lib/mysql:Z`). **Do not** reach for `idmap`: the doc states it *"is only supported by Podman in rootful mode. The Linux kernel does not allow the use of idmapped file systems for unprivileged users."* Prefer **named Podman volumes** over bind mounts for database data — they live under `~/.local/share/containers/` and sidestep both the labelling and the ownership problem. Use bind mounts only where a human must read the files directly (config, RRD inspection).

- [ ] **Step 5: Fix the source-IP problem BEFORE starting anything — the step most likely to be skipped, and it would break FR-58 silently**

**The finding, from Podman's official networking documentation:** rootless bridge networks default to the `rootlessport` forwarder, which is *"a userspace proxy that **does not preserve client source IPs**"*. The same doc gives the fix: *"To preserve source IPs, set `rootless_port_forwarder="pasta"` in the `[network]` section of `containers.conf`."*

**Why this is not a detail.** LibreNMS attributes an incoming **trap** or **syslog** message to a device **by its source IP**. With the default forwarder every trap and syslog line arrives appearing to originate from the container network's gateway. The messages are received, the ports are open, `ss` looks perfectly correct — and LibreNMS files them against no device. Task 0.6's trap/syslog check would fail with nothing anywhere explaining why, and the natural (wrong) conclusion would be that the simulators or the network are at fault.

```bash
# APPEND-ONLY to a per-user file. If ~/.config/containers/containers.conf does not
# exist we create it (creating a file of ours is not modifying an existing one).
# If it DOES exist we append with our comment markers and NEVER rewrite an existing
# key -- a conflicting rootless_port_forwarder already present is a STOP.
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
f=~/.config/containers/containers.conf
mkdir -p ~/.config/containers
if [ -f "$f" ] && grep -q "rootless_port_forwarder" "$f"; then
  echo "PRE-EXISTING KEY - STOP"; grep -n "rootless_port_forwarder" "$f"; exit 3
fi
printf "\n# --- added by NMS platform-foundation POC 2026-08-09; remove this block to revert ---\n[network]\nrootless_port_forwarder=\"pasta\"\n# --- end NMS block ---\n" >> "$f"
podman info --format "{{.Host.RootlessNetworkCmd}}"
'
```

Expected: exit 0, and the `[network]` block appended between our comment markers. `PRE-EXISTING KEY - STOP` (exit 3) → **STOP and report**: overwriting an existing container setting on a shared account is precisely the modification we promised not to make.

**Verify this empirically in Step 10 — do not trust the config alone.** A configuration key that is set but ineffective is the same defect class as a no-op lint script: it reports success while proving nothing.

- [ ] **Step 6: Create the tree and copy the units — `~/nms` only**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
umask 077
mkdir -p ~/nms/config ~/nms/rrd ~/nms/logs ~/nms/backup ~/.config/containers/systemd
chmod 700 ~/nms
df -h / | tail -1'
scp -i ~/.ssh/nms_deploy_ed25519 -r deploy/librenms-podman/* <user>@10.121.77.206:~/nms/
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 \
  'cp ~/nms/*.container ~/nms/*.network ~/.config/containers/systemd/ && ls -1 ~/.config/containers/systemd/'
```

Expected: `~/nms` exists at mode `700`; the unit files are listed; disk still ≤80%. **Nothing is written outside `$HOME`.** Confirm explicitly in evidence with `find ~/nms -maxdepth 1` and an assertion that no path under `/opt/airlinq` was written.

- [ ] **Step 7: Create the real `.env` on the server — secrets generated there, never printed**

Identical discipline to 0.4a Step 3: generate in place, prove only the shape.

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
cd ~/nms; [ -f .env ] || cp .env.example .env; chmod 600 .env
for k in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD TIMESCALE_PASSWORD KEYCLOAK_ADMIN_PASSWORD SNMP_COMMUNITY; do
  v=$(openssl rand -base64 30 | tr -d "=+/" | cut -c1-32)
  sed -i "s|^${k}=.*|${k}=${v}|" .env
done
awk -F= "/^[A-Z_]+=/ {print \$1\"=<set:\"length(\$2)\">\"}" .env'
```

Expected: every key prints as `KEY=<set:NN>` with `NN` > 0. Evidence records **only** that masked listing. Never `cat .env`.

- [ ] **Step 8: Pull the pinned images — with a disk check on both sides**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
df -h / | tail -1
grep -h "^Image=" ~/.config/containers/systemd/*.container | cut -d= -f2 | sort -u | while read -r i; do
  echo "== $i"; podman pull "$i"; done
df -h / | tail -1
podman images --format "{{.Repository}}:{{.Tag}} {{.Size}}"
podman system df'
```

Expected: every image pulls; disk **still ≤80%** afterwards. Images land in `~/.local/share/containers/storage` — inside our home, on `/`, which is exactly why the before/after `df` matters. **Stop if** the post-pull figure crosses 80%: the LibreNMS + MariaDB + TimescaleDB + Keycloak image set is several GB and 35 GB is a budget, not a comfort.

- [ ] **Step 9: Enable lingering and start the stack — the startup-method decision, with its evidence**

**Decision: systemd `--user` + quadlet, with lingering enabled for our own account.** This is the human's preferred option and it **is** available without privilege. The evidence, from the upstream systemd polkit policy (`src/login/org.freedesktop.login1.policy`):

- `org.freedesktop.login1.`**`set-self-linger`** → `allow_any=yes`, `allow_active=yes`, `allow_inactive=yes` — **no authentication required to enable lingering for your own user.**
- `org.freedesktop.login1.set-user-linger` (lingering for *another* user) → `auth_admin_keep`. We never invoke that form.

`loginctl enable-linger` **with no username argument** takes the self path. Task 0.1's evidence corroborates that a user manager already exists for our UID (`user@2002` is a running unit), consistent with `--user` units being usable here. Lingering is what makes them survive **logout** and start at **boot** — `loginctl(1)`: *"a user manager is spawned for the user at boot and kept around after logouts. This allows users who are not logged in to run long-running services."*

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
loginctl enable-linger                       # SELF form only - never "enable-linger <user>"
loginctl show-user "$(id -un)" --property=Linger
systemctl --user daemon-reload
systemctl --user start nms-db nms-redis nms-rrdcached nms-timescaledb
sleep 30
systemctl --user start nms-librenms nms-dispatcher nms-snmptrapd nms-syslogng nms-proxy
sleep 20
systemctl --user list-units "nms-*" --no-pager
podman ps --format "{{.Names}} {{.Status}} {{.Ports}}"'
```

Expected: `Linger=yes`; every `nms-*` unit **active**; `podman ps` shows all containers `Up`, with the **only** published ports being `8080`, `8443`, `1162/udp`, `1514/udp`.

**Stop conditions — the sharp edge of this step:**
- `enable-linger` **fails or prompts for authentication** → the host's polkit has been locally overridden away from the upstream default. **STOP.** Do **not** use `sudo`. Use Step 9-ALT only with Jarvis's confirmation, because it changes the persistence guarantee.
- Any unit in a restart loop after two checks → **STOP**.
- A port bind failure → **STOP** (standing abort 2): something now occupies a port Step 3 found free.

**Step 9-ALT — the documented fallback, if and only if lingering is unavailable.** Do **not** add a `@reboot` crontab line. The account's crontab already contains the third party's `@reboot /opt/airlinq/aqaillm/stc-cmp-wisdom/scripts/start_server.sh`, and `crontab` offers no atomic append — the only idiom is read-modify-write of the *entire* table, which puts someone else's boot-critical line one truncated write away from loss. The human's constraint is explicit that existing crontab entries are never modified, and the cheapest way to honour that absolutely is **not to write the crontab at all**. Instead: run the stack under the user manager **without** lingering, accepting that it **does not survive logout or reboot**, and restart it manually via a documented one-liner (`systemctl --user start nms-db nms-redis ...`) after any reboot. **Record this as an explicit POC limitation** and report it — a POC that needs a human to restart it after a reboot is acceptable only if everyone knows that is the arrangement.

- [ ] **Step 10: Verify what actually matters, not merely that containers are up**

Four checks. The third is the one that would otherwise fail invisibly in Task 0.6.

```bash
# (1) LibreNMS's own validator
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 \
  'podman exec --user librenms nms-librenms php validate.php'
```
Expected: **no `[FAIL]`** lines. Warnings about optional components are acceptable and are recorded. Any FAIL → **STOP**; do not build on a broken base.

```bash
# (2) RRDCached >=1.5.5, then pin rrdtool_version exactly as the official doc requires
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 \
  'podman exec nms-rrdcached rrdcached -h 2>&1 | head -2
   podman exec --user librenms nms-librenms lnms config:set rrdtool_version "<exact-version>"'
```
Expected: version **≥1.5.5**, no permission errors. A permission error here is usually the `:z`/`:Z` mistake from Step 4 rule 3 — check the RRD mount's label before anything else. Below 1.5.5 → **STOP** (a shared filesystem then becomes mandatory, which is an infrastructure decision, not a config tweak).

```bash
# (3) SOURCE-IP PRESERVATION -- the Step 5 fix, PROVEN rather than assumed.
# Send a syslog line from a DIFFERENT host on the network, then read what arrived.
logger -n 10.121.77.206 -P 1514 -d "nms-srcip-probe-$(date +%s)"
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 \
  'podman logs --tail 40 nms-syslogng | grep nms-srcip-probe'
```
Expected: the received line carries the **real source IP of the sending machine**, not a container gateway address (typically `10.88.0.1` or a `10.0.2.x` pasta address). **If a gateway IP appears, the `pasta` forwarder is not in effect — STOP** and fix it before Task 0.6, because every trap and syslog attribution downstream depends on this one property.

```bash
# (4) Nothing of ours leaked onto a port we do not own; the off-limits set is untouched
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 \
  'ss -tulpn | grep -E ":(8080|8443|1162|1514|3306|5432|6379|8000)\b"
   ss -tulpn | grep -cE ":(9092|2181|8077|5000)\b"'
```
Expected: **only** 8080/8443/1162/1514 bound by us; **3306, 5432, 6379 and 8000 NOT bound** on any host interface (internal network only — a published database port is a defect: fix the unit, do not accept it); off-limits count still **4**.

- [ ] **Step 11: Prove teardown works — before we depend on the stack, not after**

The VM snapshot is the human's rollback. **Ours** must be verified while it is still cheap to fix:

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'set -e
systemctl --user stop nms-proxy nms-syslogng nms-snmptrapd nms-dispatcher nms-librenms
podman ps --format "{{.Names}}" | grep -c "^nms-" || echo 0
systemctl --user start nms-librenms nms-dispatcher nms-snmptrapd nms-syslogng nms-proxy'
```

Expected: our containers stop and restart cleanly, and the off-limits count stays **4** throughout.

Record in `README.md` the **complete removal** procedure: stop the units → `rm ~/.config/containers/systemd/nms-*` → `systemctl --user daemon-reload` → remove our containers, volumes and network → remove our images → `rm -rf ~/nms` → delete our commented block from `containers.conf` → delete our two lines from `authorized_keys` → `loginctl disable-linger`. **That list is the co-tenancy promise made concrete:** an operator must be able to return this account to its prior state without guessing which artifacts were ours. Everything carries the `nms-` prefix precisely so that list is enumerable rather than archaeological.

- [ ] **Step 12: Keycloak — the floor check passes, but read the co-tenancy note**

ADR 0008 Decision 4's floor is **4 vCPU / 8 GB**. Discovered: **32 vCPU / 62 GiB total, 48 GiB available**. The floor is **cleared by roughly 8× on both axes** — verdict recorded in ADR 0008 revision 3. Proceed with the `nms-keycloak` and `nms-kcdb` units.

**The binding constraint here is disk and neighbours, not CPU or RAM.** Keycloak's marginal cost is roughly +2 vCPU / +2 GB / +5–10 GB disk. CPU and RAM are abundant; **disk is the scarce resource (35 GB)**, and we share a machine its owners did not size for us. Bring Keycloak up **after** Step 10 passes, re-run `df -h /`, and **stop if it crosses 80%**.

- [ ] **Step 13: Write evidence and report to Jarvis**

Per-step expected-vs-actual, PASS/FAIL/STOP, the masked `.env` listing, the source-IP probe result verbatim, the before/after `df` figures, the off-limits-count check at each step, and **the startup method actually achieved** (lingering vs Step 9-ALT). **Do not proceed to Task 0.5 with any step failed.**

---

## Task 0.5: TLS, firewall, and SSO wiring — **[DEVELOPER AGENT EXECUTES via SSH]**

> ### Revision 4 reconciliation — READ THIS BEFORE ANY STEP BELOW (branch 0.4c)
>
> This task was written for branches 0.4a/0.4b, where we held root and could bind privileged ports. **On the selected 0.4c branch the following substitutions apply to every step in this task**, and where a step becomes impossible it is marked so explicitly rather than left to be discovered mid-run.
>
> | Written as | On 0.4c becomes | Why |
> |---|---|---|
> | `https://10.121.77.206/` (443) | **`https://10.121.77.206:8443/`** | Rootless cannot bind <1024 |
> | HTTP on 80 | **8080** | Same. ACME HTTP-01 is therefore **not possible** — it requires inbound 80 |
> | Traps on **162/udp** | **1162/udp** | Same |
> | Syslog on **514/udp** | **1514/udp** | Same |
> | `~/nms-deploy` | **`~/nms`** | Human-specified path |
> | `docker compose exec -T <svc>` | **`podman exec nms-<svc>`** | No Compose on this host |
> | `docker compose logs <svc>` | **`podman logs nms-<svc>`** | Same |
> | `sudo ufw` / `firewall-cmd` | **NOT AVAILABLE — see Step 2 below** | No sudo; `firewalld` is inactive and we must not enable it |
> | `LIBRENMS_BASE_URL=https://10.121.77.206` | **`LIBRENMS_BASE_URL=https://10.121.77.206:8443`** | The port is now part of the URL, and **every** consumer must carry it |
>
> **`LIBRENMS_BASE_URL` — the change that reaches furthest.** It is no longer a bare host URL. Every place it appears (the BFF's `.env`, `.env.example`, design §2/§12, the OIDC `redirect_uri` registered at Keycloak, the proxy's own external URL, and any curl example in this plan) must carry **`:8443`**. A mismatch between the registered `redirect_uri` and the actual URL is the single most common OIDC failure, and it presents as a login loop rather than as a configuration error.

Applies to both branches. This task contains the deployment's **highest-severity security property** (design §12.4) — and under revision 3 it is constructed without a human reading each command first, which raises the stakes on Step 3's negative test rather than lowering them.

**Stop conditions for this whole task:** any firewall change that would drop the **SSH session you are working through** (lock-out risk — see Step 2); any change to a firewall rule that pre-existed our work; any modification to an existing web-server vhost; enabling `sso` before Step 3's isolation check passes.

- [ ] **Step 1: Terminate TLS on 8443 and confirm HTTPS**

Install the certificate from the source recorded at Task 0.1 Step 7 and configure the proxy. **On 0.4c the listener is 8443, not 443.**

```bash
curl -skI https://10.121.77.206:8443/ | head -3
openssl s_client -connect 10.121.77.206:8443 -servername <host> </dev/null 2>/dev/null | openssl x509 -noout -dates -subject
```
Expected: `HTTP/… 200` (or a 302 to the IdP once Step 4 is done), and a certificate whose subject matches the host name with current dates. The official install docs explicitly do **not** cover HTTPS and warn the install is "not secure by default" — this step is where that is fixed.

**Stop if** no certificate source has been supplied and a self-signed CA has not been explicitly approved. Do not silently generate a self-signed cert and call FR-58 satisfied — that shifts a trust decision onto the BFF host without anyone deciding it.

**0.4c note — ACME is off the table.** Let's Encrypt HTTP-01 needs inbound **port 80**, which we cannot bind. Combined with Task 0.1's finding that this is an RFC1918 address on a corporate network with no public DNS, the realistic options are a **corporate CA** or a **POC self-signed CA**. If self-signed, the BFF host must be configured to trust it — a real step, and the commonest cause of a Task 6 failure that presents as a code bug. **This is a human decision and it is still outstanding.**

- [ ] **Step 2: Firewall — NOT APPLICABLE on 0.4c. Read this step; do not execute it.**

**This step cannot be performed and must not be attempted.** Every form of it needs root: `ufw`/`firewall-cmd` require sudo, and Task 0.1 found **`firewalld` inactive** on the host. Enabling or configuring a host firewall would (a) need sudo — **standing abort 1**, and (b) risk cutting network paths belonging to Kafka, ZooKeeper, Samba, and two Python services — **standing abort 2**. Enabling a default-deny firewall on a shared host whose other tenants' required ports we do not know is one of the most reliable ways to cause someone else's outage.

**What replaces it, and it is weaker — say so plainly:**

| Control | 0.4a/0.4b (with root) | 0.4c (rootless) |
|---|---|---|
| Restrict who can reach the UI | Host firewall, source-restricted | **None.** 8443 is reachable from anywhere that can route to the host |
| Restrict trap/syslog sources | Host firewall, source-restricted | **None** at the network layer; LibreNMS-side device filtering only |
| Keep MariaDB / Redis / TimescaleDB / LibreNMS unreachable | Firewall **plus** not publishing the port | **Not publishing the port** — the container network is the only boundary |

**The single control that still works is the one that matters most, and it is now load-bearing on its own:** internal services are **never published**, so they have no host-side listener at all. Verify that by observation, not by assumption, in Step 3. Design §12.6's firewall table is **not satisfiable on this branch** — record it as a POC limitation, and note the compensating control is "no published port", which is a real boundary but a single one. **Defence in depth is reduced from two layers to one here**; that is a genuine security consequence of the human's option-3 choice and it belongs in the record rather than in a footnote.

- [ ] **Step 3: Prove LibreNMS and every datastore are NOT directly reachable — the Critical check**

**From the developer machine, not the server** — what matters is what an outsider can reach:

```bash
nmap -Pn -p 80,443,3306,5432,6379,8000,8080,8443 10.121.77.206
nmap -Pn -sU -p 162,514,1162,1514 10.121.77.206
```
Expected on 0.4c:
- **`8443` open** (the proxy), **`8080` open** (HTTP, redirecting to 8443).
- **`3306`, `5432`, `6379`, `8000` closed or filtered** — no datastore and no direct LibreNMS listener.
- **`1162/udp`, `1514/udp`** reachable; `162/udp`, `514/udp` **not** (we cannot bind them).
- `80`, `443` closed.

If any datastore port answers, **STOP**. With `auth_mechanism = sso`, a directly reachable LibreNMS means anyone who can reach it can assert `admin` with one header — an authentication bypass (design §12.4). **On 0.4c this check carries more weight than on either other branch**, because Step 2's firewall layer does not exist: "not published" is now the *only* thing standing between the network and LibreNMS. **`sso` must not be enabled until this check passes.**

- [ ] **Step 4: Register the OIDC clients at Keycloak and configure the proxy as the OIDC client**

Two clients: `nms-custom-ui` (for the BFF, ADR 0003) and the `oauth2-proxy` client (for the native UI). Register them in the POC realm, then configure the proxy with issuer, client ID, and the client secret **injected at runtime from the server-side `.env`** — never in a committed file, never in evidence (FR-57, NFR-09).

Configure the proxy to **strip any inbound identity headers** before setting its own, and to **exempt `/api/`** from the interactive redirect (design §12.6) so the BFF's token-authenticated calls are answered rather than redirected to a login page.

**If Keycloak was not installed** (floor check flagged): stop here and report. The remaining steps of this task depend on an IdP; `AUTH_MODE=dev-local` covers Phase 1 development in the meantime, but FR-57/AC-A cannot be verified without one.

- [ ] **Step 5: Configure LibreNMS's `sso` mechanism**

Using `lnms config:set` — **on 0.4c: `podman exec --user librenms nms-librenms lnms …`** (0.4a used `docker compose exec -T --user librenms librenms lnms …`) — apply design §12.4's configuration. The three values that are security controls rather than preferences:

```bash
lnms config:set sso.static_level 0                       # unmapped -> NO access (fail-closed)
lnms config:set sso.trusted_proxies '["<proxy-addr>"]'   # the proxy ONLY, never a broad range
lnms config:set sso.auth_logout_handler '<proxy sign-out URL>'
```
Expected: each returns success. `static_level 0` is what makes ADR 0003's fail-closed rule real; the logout handler is the only reason AC-A#7 can pass, since the docs state LibreNMS itself cannot log out an SSO user.

**Stop if** Step 3 did not pass. Enabling `sso` on a directly-reachable LibreNMS creates the authentication bypass rather than risking it.

- [ ] **Step 6: Test the auth mechanism with the docs' own tool**

```bash
# 0.4c form (0.4a used: cd ~/nms-deploy && docker compose exec -T --user librenms librenms ...)
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'podman exec --user librenms nms-librenms ./scripts/auth_test.php -u <test-user>'
```
Expected: the mechanism resolves the user and the mapped level. Record the resolved level; **do not record any credential the tool prompts for.**

- [ ] **Step 7: Write evidence and report to Jarvis**, including the Step 3 scan output verbatim (it contains no secrets and it is the single most important line of evidence in the package).

---

## Task 0.6: FR-58 deployment verification — **[DEVELOPER AGENT EXECUTES via SSH]** — GATES Task 6

> ### Revision 4 reconciliation — branch 0.4c (read before any step)
>
> Substitutions for every step below: **`https://10.121.77.206:8443`** for `https://10.121.77.206`; **`podman exec nms-<svc>`** for `docker compose exec -T <svc>`; **`~/nms`** for `~/nms-deploy`; **traps to `1162/udp`**, **syslog to `1514/udp`**.
>
> **Two FR-58 checks change in substance, not just in port number:**
>
> 1. **Step 7 (traps + syslog) now verifies the high ports, which is a partial verification of FR-56.** FR-56 as approved names 161/162/514. This deployment receives traps on **1162** and syslog on **1514** because rootless Podman cannot bind below 1024 and no redirect can be installed without root. Our **simulators can be pointed at the high ports, so the end-to-end path is genuinely exercised** — but **real network devices cannot**, since a device's trap destination port is usually not configurable and its syslog port rarely is. **FR-58 is therefore satisfied for the simulator-fed POC and NOT for real devices.** Record it exactly that way; do not tick FR-56 as met. The wording question is routed to the human — see the POC limitations section.
> 2. **Step 9 (header-injection bypass) must be re-aimed.** The original probes `http://10.121.77.206:8000/`, which is LibreNMS's published port under the Compose example. On 0.4c LibreNMS is **not published at all**, so 8000 was never the exposure. The equivalent test is to confirm **no host-side listener exists for LibreNMS or any datastore**, and that a forged identity header presented to the *proxy* is stripped rather than honoured. Both forms are specified below. **This remains the Critical check of the entire package**, and on 0.4c it is the *only* barrier, because Task 0.5 Step 2's firewall layer does not exist.

No dependent work starts until every check passes. This is the Phase 0 gate.

**Files:**
- Create: `.claude/team/artifacts/nms-platform-foundation/deployment/task-0.6-verification.md` (evidence)
- Create: `docs/design/librenms-deployment-verification.md` (durable results record, **no secrets**)

**Stop conditions:** a failure in Step 3, Step 8(3), or Step 9 is a **security finding**, not a configuration nit — STOP and report at severity floor High per team-protocol §6, regardless of what else passed.

- [ ] **Step 1: Create the LibreNMS API token for the BFF — never printed into evidence**

Create a token scoped to a service account (native UI or `lnms`). Write it **directly** into the server-side `.env` and, separately, into the developer's local gitignored `.env`. **Never into the repo, never into an evidence file, never into a handoff** (NFR-09, AC-F#31).

Expected: the token exists and is usable in Step 2. Evidence records `LIBRENMS_API_TOKEN=<set:NN>` shape only.

- [ ] **Step 2: Authenticated API call succeeds**

```bash
# Token is read from the environment; it is NOT written into the command text.
curl -sk -H "X-Auth-Token: $LIBRENMS_API_TOKEN" https://10.121.77.206:8443/api/v0/system | head -c 400
```
Expected: a JSON system payload including the LibreNMS version. **Record the payload with any token echo removed.**

- [ ] **Step 3: Unauthenticated API call is refused — negative check**

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://10.121.77.206:8443/api/v0/system
```
Expected: **`401`** (or 403). **Not 200, and not a 302 to the IdP login page** — a redirect here means Task 0.5 Step 4 exempted `/api/` incorrectly and the BFF will break in Task 6. A `200` is a Critical finding.

- [ ] **Step 4: Add a simulated device and confirm discovery**

Start the simulator harness (Task 12) somewhere the server can reach over UDP 161. **If the simulators sit behind NAT on a developer laptop, this step fails for network reasons, not software ones** — this remains the most-likely-to-surprise item in the package. Task 0.1's discovered network facts inform where to run them; running them **on** the server is the reliable option.

```bash
lnms device:add <simulator-ip> --v2c --community <community-from-env>
lnms device:poll <simulator-ip>
```
Expected: device added, discovery finds interfaces, poll completes without error. **The community string is read from the environment and recorded as `<REDACTED>`.**

- [ ] **Step 5: Confirm it is actually being POLLED, not merely present — the check that matters**

Wait for two poll cycles, then:

```bash
curl -sk -H "X-Auth-Token: $LIBRENMS_API_TOKEN" "https://10.121.77.206:8443/api/v0/devices/<id>/ports" | head -c 600
```
Expected: interface counters that have **advanced** between the two observations. A device row with a timestamp proves it was added; only moving counters prove polling. Presence alone would let a broken poller pass this gate.

- [ ] **Step 6: Confirm metrics are landing — in RRD AND in TimescaleDB**

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'podman exec nms-librenms ls -la --time-style=+%H:%M:%S /opt/librenms/rrd/<device-hostname>/ | head'
```
Expected: `.rrd` files with mtimes inside the last poll interval.

Then the check that OQ-3's resolution makes mandatory — **the LibreNMS→TimescaleDB write path is verified, not assumed** (ADR 0005 revision 2):

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 'podman exec nms-timescaledb psql -U <user> -d <db> -c "\dt" -c "SELECT count(*) FROM <metrics_table> WHERE time > now() - interval \"10 minutes\";"'
```
Expected: the metrics table exists **and** the recent-row count is **> 0**. **A count of 0 is a FAIL, not a warning** — it means LibreNMS is writing to RRD only and every Phase 2 chart would query an empty store. Report it as a Phase 0 finding; do not compensate in the BFF.

- [ ] **Step 7: Confirm traps and syslog are received — on the HIGH ports, and read the FR-56 caveat**

```bash
# 1162/udp and 1514/udp, NOT 162/514 -- rootless cannot bind below 1024.
snmptrap -v2c -c <community-from-env> 10.121.77.206:1162 '' 1.3.6.1.6.3.1.1.5.1
logger -n 10.121.77.206 -P 1514 -d "nms-deployment-test"
```
Expected: both appear in LibreNMS (Eventlog / Syslog), **attributed to the correct source device** — not merely present. Attribution is the real assertion here, and it is what the Task 0.4c Step 5 `pasta` port-forwarder fix exists to make possible: with the default rootless forwarder both messages arrive from the container gateway and LibreNMS files them against nothing while every port check still looks correct.

**If messages arrive but are unattributed or attributed to a gateway address: STOP** and revisit Task 0.4c Step 5. Do not compensate for it in the BFF.

**FR-56 caveat, recorded not resolved.** This verifies the trap/syslog path **for senders that can be told to use a non-standard port** — our simulators can; **real devices generally cannot**. FR-56 as approved names 162 and 514. **Do not mark FR-56 satisfied on this evidence.** Record it as a POC limitation and leave the requirement wording to the human.

- [ ] **Step 8: SSO end-to-end, including the fail-closed case**

1. Browse to `https://10.121.77.206:8443/` as a user in a **mapped** group → reaches the native UI with **no second credential prompt** (AC-A#3); user exists at the mapped level (AC-A#4).
2. Change that user's group to a different mapped group, log in again → level updated (AC-A#5).
3. As a user in **no** mapped group → **access denied** (this is `sso.static_level 0` working; **if this user gets in, the fail-closed control is broken — Critical**).
4. Log out → revisiting requires re-authentication (AC-A#7).

Test-user passwords are created in Keycloak and **never recorded**.

- [ ] **Step 9: Header-injection negative test — Critical, and re-aimed for 0.4c**

On 0.4c LibreNMS has **no published host port at all**, so the original `:8000` probe would pass trivially and prove nothing. Three probes replace it, and all three must pass.

**9a — no host-side listener for LibreNMS or any datastore.** From the developer machine:

```bash
nmap -Pn -p 3306,5432,6379,8000,8080,8443 10.121.77.206
```
Expected: `8080`/`8443` open; **`3306`, `5432`, `6379`, `8000` closed or filtered.** Any datastore or direct-LibreNMS listener answering is a **Critical** finding: with `sso` enabled, direct reachability is an authentication bypass. **On this branch there is no firewall behind this check** — "not published" is the whole boundary.

**9b — the proxy strips forged identity headers.** The attack that remains available once 9a holds is presenting the header *through* the proxy:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' -H 'X-Remote-User: admin' https://10.121.77.206:8443/
curl -sk -H 'X-Remote-User: admin' https://10.121.77.206:8443/ | grep -ci "admin" || true
```
Expected: the request is treated as **unauthenticated** — a 302 to the IdP or a 401, **never a 200 authenticated as `admin`**. If the forged header authenticates, the proxy is forwarding client-supplied identity headers instead of replacing them, and that is a **Critical** authentication bypass (design §12.4). Stop and report immediately per team-protocol §6.

**9c — from the host itself, confirm LibreNMS only trusts the proxy.** `sso.trusted_proxies` must name the proxy's container address only:

```bash
ssh -i ~/.ssh/nms_deploy_ed25519 <user>@10.121.77.206 \
  'podman exec --user librenms nms-librenms lnms config:get sso.trusted_proxies
   podman exec --user librenms nms-librenms lnms config:get sso.static_level'
```
Expected: `trusted_proxies` contains **only** the proxy's address on the `nms` network (never a broad range, never `0.0.0.0/0`), and `static_level` is **`0`**. A permissive `trusted_proxies` re-opens 9b from anywhere on the container network; a non-zero `static_level` breaks ADR 0003's fail-closed rule.

- [ ] **Step 10: BFF host reaches the API**

From the machine that will run the BFF:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' -H "X-Auth-Token: $LIBRENMS_API_TOKEN" https://10.121.77.206:8443/api/v0/system
```
Expected: `200`. If TLS uses a private/self-signed CA, the BFF host must trust that CA — a real configuration step, and the commonest cause of a Task 6 failure that looks like a code bug.

- [ ] **Step 11: Record results and set `LIBRENMS_BASE_URL`**

Write both the evidence file and `docs/design/librenms-deployment-verification.md` with one row per check: command, expected, actual, verdict. **No tokens, no passwords, no community strings, no `Credentials.md` content** — redacted. Then set `LIBRENMS_BASE_URL=https://10.121.77.206:8443` in the developer's local `.env` (git-ignored).

- [ ] **Step 12: Report the gate result to Jarvis**

All checks pass → **Task 6 is unblocked.** Any failure → report. Steps 3, 6 (Timescale count), 8(3), and 9 are the ones that must never be waved through.

- [ ] **Step 13: Commit the verification record**

```bash
git add docs/design/librenms-deployment-verification.md
git commit -m "docs: record FR-58 LibreNMS deployment verification results"
```

---

## POC limitations of the 0.4c rootless-Podman deployment — what this deployment does NOT demonstrate

Added in revision 4. This section exists so that nobody later reads a green FR-58 verification as evidence of something it never tested. Each row is a consequence of the human's option-3 constraints, not a defect to be fixed by the Developer.

| # | What is NOT demonstrated | Why | Consequence if ignored |
|---|---|---|---|
| **L-1** | **Trap and syslog receipt from real network devices** | Rootless Podman cannot bind ports <1024 (official `rootless.md`); traps land on **1162/udp**, syslog on **1514/udp**. Real devices send to **162/514** and generally cannot be reconfigured. No redirect (iptables, `redir`, `ip_unprivileged_port_start`) can be installed without root | **FR-56 is NOT met** for real devices. A "traps working" result here is a simulator result only. **This is the most consequential limitation in the list** |
| **L-2** | **A host-level firewall / network-layer source restriction** | `ufw`/`firewall-cmd` need sudo; `firewalld` is inactive and enabling it risks other tenants' traffic | Design §12.6's firewall table is **unsatisfiable here**. The only boundary protecting MariaDB/Redis/TimescaleDB/LibreNMS is "the port is not published" — **one layer instead of two.** 8443 is reachable from anywhere that can route to the host |
| **L-3** | **Production scale** | POC scale is **tens of devices** by explicit constraint; 35 GB disk on a shared volume; no swap | Says nothing about **NFR-01 / FR-53 (>5,000 devices)**. ADR 0008 already puts a single LibreNMS instance at "1,000+" and directs you to distributed polling beyond that. Do not extrapolate from this deployment |
| **L-4** | **High availability, failover, or backup/restore** | Single host, single instance of every service, no replication, no off-host backup | A host loss loses the deployment. The human's VM snapshot is the only recovery, and it is **outstanding** |
| **L-5** | **Survival of a host reboot — CONDITIONAL** | Depends on `loginctl enable-linger` succeeding (Task 0.4c Step 9). Upstream systemd policy makes self-lingering unprivileged, so this is *expected* to work, but it is verified at runtime, not guaranteed | If lingering is unavailable (Step 9-ALT), the stack **does not restart after a reboot or logout** and needs a manual `systemctl --user start`. Must be stated loudly if it lands that way |
| **L-6** | **Isolation from co-tenants' resource use** | Shared host with Kafka, ZooKeeper, two Python services, Samba, and a GNOME desktop. No cgroup reservation is possible without root | Our latency measurements are **not reproducible** — NFR timings measured here are contaminated by neighbours. Conversely, our load could degrade theirs |
| **L-7** | **A production-grade identity solution** | Co-hosted POC Keycloak realm, shares a failure domain with what it authenticates, no MFA/lifecycle/audit posture (ADR 0008 Decision 4) | Already recorded; unchanged by this revision |
| **L-8** | **TLS with a publicly-trusted certificate** | ACME HTTP-01 needs inbound port 80 (unbindable) and public DNS (RFC1918 address). Corporate CA or POC self-signed only | The BFF host must be configured to trust a private CA. **Still an outstanding human decision** |
| **L-9** | **Privileged-port SNMP polling source behaviour** | Outbound SNMP to **161/udp** is unaffected (outbound needs no privilege), but the host is **dual-homed** (`10.121.77.206` / `10.121.78.206`) and rootless networking adds a NAT layer | Source-address selection for outbound polls is **not verified** by this package. If a device ACLs by source IP, this needs discovery before it bites |
| **L-10** | **That the deployment is invisible to co-tenants** | We add ~several GB of images plus growing RRD/TSDB data to a **35 GB shared** filesystem, and CPU/RAM load to a shared host | Disk is the realistic shared-resource risk. Retention limits (below) are a co-tenancy obligation, not housekeeping |

### Retention and cleanup — a co-tenancy obligation, not housekeeping

35 GB free on `/` is the entire budget, and it is shared with whatever the other tenants write. Three stores grow continuously and **all three must be bounded before the stack runs unattended**:

| Store | Growth driver | Bound to configure |
|---|---|---|
| **RRD** (`~/nms/rrd`) | ports × retention; fixed-size files, so growth is per-port-added rather than unbounded over time | Fixed after device count settles. Record actual size after Task 0.6 and re-check weekly |
| **TimescaleDB** | every metric write, continuously | Set a **retention policy / `drop_chunks`** window (POC: 14–30 days). **Unbounded by default — this is the most likely cause of a slow disk-exhaustion incident** |
| **Container logs + images** | `podman logs` growth; image layers on every pull | Cap per-container logging (`LogDriver`/`--log-opt max-size`); `podman image prune` **only for `nms-`-prefixed images we pulled** — never a blanket `podman system prune`, which on a shared account could remove another user's images |
| **LibreNMS syslog/eventlog tables (MariaDB)** | syslog volume | Enable LibreNMS's own syslog purge (`syslog_purge`) and eventlog purge |

**Add a disk check to the operating routine, not just the install:** `df -h /` at 80% is the standing abort. A monitoring platform that fills a shared production host's root filesystem would be an unusually poor advertisement for itself.

### FR-56: the requirement conflict — ROUTED TO THE HUMAN, not resolved here

**FR-56 as approved reads:** *"Required network access SHALL be documented and configured: inbound HTTP/HTTPS for the native UI and API, **SNMP/UDP 161** outbound to managed devices, **UDP 162** inbound for traps, **UDP 514** inbound for syslog, and access from the BFF host to the LibreNMS API. Ports not required SHALL NOT be exposed."*

**What this deployment can actually do:**

| FR-56 clause | 0.4c reality | Verdict |
|---|---|---|
| Inbound HTTP/HTTPS | **8080 / 8443** instead of 80/443 | Intent met; port numbers differ |
| **SNMP/UDP 161 outbound** | Unaffected — outbound needs no privilege | **Met** |
| **UDP 162 inbound (traps)** | **1162/udp**. Real devices cannot be redirected | **NOT met** for real devices; met for simulators |
| **UDP 514 inbound (syslog)** | **1514/udp**. Same | **NOT met** for real devices; met for simulators |
| BFF → LibreNMS API | Met, via `https://10.121.77.206:8443` | **Met** |
| Ports not required SHALL NOT be exposed | **Better than the approved design** — only 4 ports published, datastores have no host listener at all | **Met** |

**I am not rewriting FR-56.** It is a human-approved requirement and the conflict is substantive, not editorial: changing 162→1162 in the requirement would quietly convert "this platform can receive traps from the estate" into "this platform can receive traps from things we configure specially", which is a different product claim.

**Recommended wording for the human** (Jarvis to route; the Architect does not apply it unilaterally). Keep FR-56 exactly as approved as the **production** requirement, and add a scoped deployment note:

> **FR-56a (POC deployment exception, host `10.121.77.206`, added 2026-08-09).** On the rootless-Podman POC deployment, trap and syslog receivers bind **1162/udp** and **1514/udp** respectively, because rootless containers cannot bind ports below 1024 and no privileged redirect may be installed on that host. FR-56's 162/514 requirement is therefore **verified against project-controlled simulators only** and is **NOT satisfied for real network devices**. Meeting FR-56 as written requires either (a) root on the deployment host to install a port redirect, (b) a privileged/dedicated host running branch 0.4a or 0.4b, or (c) a device-side change to non-standard destination ports, which is generally not available. **Production deployment MUST satisfy FR-56 as originally worded.**

**The decision the human is actually being asked to make** is not about wording. It is: *is a POC that cannot receive traps from a real device sufficient for this phase's purpose?* If the POC's goal is to prove the UI/BFF/SSO architecture against a working collection engine, the answer is plausibly yes. If it is to prove the platform can ingest from the real estate, the answer is no and a privileged host is needed. **That is a scope question, and it belongs to the human.**

---

## Task 1: Workspace root scaffold and the exact script names

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `scripts/check-workspace-deps.mjs`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: root scripts `build`, `test`, `test:unit`, `test:integration`, `test:coverage`, `lint`, `lint:deps`, `typecheck`, `dev`, `dev:bff`, `dev:web`, `sim`. The workspace names `@nms/shared`, `@nms/bff`, `@nms/web`, `@nms/simulator`. These names are fixed by the design and every later task depends on them.

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "nms-platform",
  "private": true,
  "workspaces": ["packages/*"],
  "engines": { "node": ">=24.16.0" },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "test:unit": "npm run test:unit --workspaces --if-present",
    "test:integration": "npm run test:integration --workspace @nms/bff",
    "test:coverage": "npm run test:coverage --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present && npm run lint:deps",
    "lint:deps": "node scripts/check-workspace-deps.mjs",
    "typecheck": "tsc -b --noEmit",
    "dev": "concurrently -n bff,web \"npm:dev:bff\" \"npm:dev:web\"",
    "dev:bff": "npm run dev --workspace @nms/bff",
    "dev:web": "npm run dev --workspace @nms/web",
    "sim": "npm run start --workspace @nms/simulator"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json` with strict settings**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "composite": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.next/
coverage/
.env
.env.*
!.env.example
*.log
artifacts/
```

`.env` must be ignored before any secret-bearing file could be created (NFR-09).

- [ ] **Step 4: Write the failing dependency-rule test**

Create `scripts/check-workspace-deps.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findViolations } from './check-workspace-deps.mjs';

test('flags web depending on bff', () => {
  const violations = findViolations({
    manifests: { '@nms/web': { dependencies: { '@nms/bff': '*' } } },
    imports: {}
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /@nms\/web must not depend on @nms\/bff/);
});

test('flags a web source file importing bff', () => {
  const violations = findViolations({
    manifests: { '@nms/web': { dependencies: {} } },
    imports: { 'packages/web/src/lib/x.ts': ['@nms/bff'] }
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /packages\/web\/src\/lib\/x\.ts/);
});

test('flags shared importing another workspace', () => {
  const violations = findViolations({
    manifests: { '@nms/shared': { dependencies: {} } },
    imports: { 'packages/shared/src/a.ts': ['@nms/bff'] }
  });
  assert.equal(violations.length, 1);
});

test('passes a clean graph', () => {
  const violations = findViolations({
    manifests: { '@nms/web': { dependencies: { '@nms/shared': '*' } } },
    imports: { 'packages/web/src/lib/x.ts': ['@nms/shared', 'react'] }
  });
  assert.deepEqual(violations, []);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `node --test scripts/check-workspace-deps.test.mjs`
Expected: FAIL — cannot resolve `./check-workspace-deps.mjs`.

- [ ] **Step 6: Implement `scripts/check-workspace-deps.mjs`**

```javascript
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FORBIDDEN_DEPS = { '@nms/web': ['@nms/bff', '@nms/simulator'] };
const IMPORT_RE = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

export function findViolations({ manifests, imports }) {
  const violations = [];
  for (const [name, manifest] of Object.entries(manifests)) {
    for (const forbidden of FORBIDDEN_DEPS[name] ?? []) {
      if (manifest.dependencies?.[forbidden] || manifest.devDependencies?.[forbidden]) {
        violations.push(`${name} must not depend on ${forbidden} (ADR 0001)`);
      }
    }
  }
  for (const [file, specifiers] of Object.entries(imports)) {
    for (const spec of specifiers) {
      if (file.startsWith('packages/web/') && /(^@nms\/(bff|simulator)|\.\.\/bff)/.test(spec)) {
        violations.push(`${file} must not import ${spec} (ADR 0001)`);
      }
      if (file.startsWith('packages/shared/') && /^@nms\/(bff|web|simulator)/.test(spec)) {
        violations.push(`${file} must not import ${spec} (ADR 0001)`);
      }
    }
  }
  return violations;
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function collect() {
  const manifests = {};
  const imports = {};
  for (const pkg of readdirSync('packages')) {
    const manifestPath = join('packages', pkg, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifests[manifest.name] = manifest;
    } catch { continue; }
    for (const file of walk(join('packages', pkg, 'src'))) {
      const source = readFileSync(file, 'utf8');
      const specs = [];
      for (const match of source.matchAll(IMPORT_RE)) specs.push(match[1] ?? match[2]);
      imports[relative('.', file).split('\\').join('/')] = specs;
    }
  }
  return { manifests, imports };
}

if (process.argv[1]?.endsWith('check-workspace-deps.mjs')) {
  const violations = findViolations(collect());
  if (violations.length) {
    console.error('Workspace dependency rule violations (ADR 0001):');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('Workspace dependency rule: OK');
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test scripts/check-workspace-deps.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 8: Create the `@nms/shared` package skeleton**

`packages/shared/package.json`:
```json
{
  "name": "@nms/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/shared/src/index.ts`:
```typescript
export const SHARED_PACKAGE_VERSION = '0.1.0';
```

- [ ] **Step 9: Install and verify the commands run**

Run: `npm install` (creates `package-lock.json`), then `npm run lint:deps` and `npm run build`.
Expected: `Workspace dependency rule: OK`; build succeeds.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore scripts packages/shared
git commit -m "build: scaffold npm workspaces root with dependency-rule enforcement"
```

---

## Task 2: Shared types, error codes, and the `unavailable` discriminator

**Files:**
- Create: `packages/shared/src/errors/codes.ts`, `packages/shared/src/types/envelope.ts`, `packages/shared/src/types/metric.ts`, `packages/shared/src/types/alarm.ts`, `packages/shared/src/types/device.ts`, `packages/shared/src/types/session.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/metric.test.ts`

**Interfaces:**
- Consumes: Task 1's `@nms/shared` package.
- Produces: `ErrorCode`, `ApiSuccess<T>`, `ApiFailure`, `PageMeta`, `Paged<T>`, `MetricValue<T>` with `available(value)`/`unavailable(reason)` constructors and `isAvailable()` guard, `Alarm`, `Device`, `DeviceInterface`, `PlatformRole`, `SessionInfo`. Every later task uses these exact names.

- [ ] **Step 1: Write the failing test for the metric discriminator**

`packages/shared/tests/metric.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { available, unavailable, isAvailable } from '../src/types/metric.js';

describe('MetricValue', () => {
  it('marks a present value available', () => {
    const m = available(42);
    expect(isAvailable(m)).toBe(true);
    if (isAvailable(m)) expect(m.value).toBe(42);
  });

  it('marks an absent value unavailable with a reason', () => {
    const m = unavailable('OID_NOT_SUPPORTED');
    expect(isAvailable(m)).toBe(false);
    expect(m).not.toHaveProperty('value');
  });

  it('never represents an unavailable metric as zero', () => {
    const m = unavailable('NO_DATA');
    expect(JSON.stringify(m)).not.toContain('"value"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace @nms/shared`
Expected: FAIL — cannot resolve `../src/types/metric.js`.

- [ ] **Step 3: Implement the metric type**

`packages/shared/src/types/metric.ts`:
```typescript
export type UnavailableReason =
  | 'OID_NOT_SUPPORTED'
  | 'NO_DATA'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NOT_COLLECTED';

export type MetricValue<T = number> =
  | { readonly status: 'available'; readonly value: T; readonly timestamp: string }
  | { readonly status: 'unavailable'; readonly reason: UnavailableReason };

export function available<T>(value: T, timestamp: string = new Date().toISOString()): MetricValue<T> {
  return { status: 'available', value, timestamp };
}

export function unavailable<T = number>(reason: UnavailableReason): MetricValue<T> {
  return { status: 'unavailable', reason };
}

export function isAvailable<T>(
  m: MetricValue<T>
): m is { status: 'available'; value: T; timestamp: string } {
  return m.status === 'available';
}
```

This type is why FR-24 cannot silently degrade: there is no numeric slot to put `0` into when a value is missing.

- [ ] **Step 4: Implement error codes**

`packages/shared/src/errors/codes.ts`:
```typescript
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_ERROR',
  'INTERNAL_ERROR'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
```

- [ ] **Step 5: Implement the envelope, domain, and session types**

`packages/shared/src/types/envelope.ts`:
```typescript
import type { ErrorCode } from '../errors/codes.js';

export interface PageMeta {
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly hasNext: boolean;
}

export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: PageMeta & { readonly requestId?: string };
}

export interface ApiErrorDetail {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field?: string;
}

export interface ApiFailure {
  readonly success: false;
  readonly errors: readonly ApiErrorDetail[];
  readonly meta: { readonly requestId: string };
}

export type Paged<T> = ApiSuccess<readonly T[]> & { readonly meta: PageMeta };
```

`packages/shared/src/types/alarm.ts`:
```typescript
export type AlarmSeverity = 'critical' | 'warning' | 'ok';
export type DeviceKind = 'router' | 'switch' | 'p2p' | 'other';

export interface Alarm {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceHostname: string;
  readonly deviceKind: DeviceKind;
  readonly entity: string | null;
  readonly severity: AlarmSeverity;
  readonly ruleName: string;
  readonly firstRaisedAt: string;
  readonly durationSeconds: number;
  readonly acknowledged: boolean;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: string | null;
}
```

`packages/shared/src/types/device.ts`:
```typescript
import type { DeviceKind } from './alarm.js';
import type { MetricValue } from './metric.js';

export type Reachability = 'up' | 'down' | 'unknown';

export interface Device {
  readonly id: string;
  readonly hostname: string;
  readonly displayName: string;
  readonly kind: DeviceKind;
  readonly location: string | null;
  readonly reachability: Reachability;
  readonly uptimeSeconds: MetricValue<number>;
}

export interface DeviceInterface {
  readonly id: string;
  readonly deviceId: string;
  readonly name: string;
  readonly adminState: 'up' | 'down';
  readonly operState: 'up' | 'down' | 'unknown';
  readonly inOctetsRate: MetricValue<number>;
  readonly outOctetsRate: MetricValue<number>;
}
```

`packages/shared/src/types/session.ts`:
```typescript
export type PlatformRole = 'admin' | 'engineer' | 'operator' | 'readonly';

export interface SessionInfo {
  readonly username: string;
  readonly displayName: string;
  readonly role: PlatformRole;
  readonly canAcknowledge: boolean;
  readonly canOpenAdminPortal: boolean;
}
```

`canAcknowledge`/`canOpenAdminPortal` are **presentation hints only** (FR-42). The BFF re-derives authorization from the session on every request (NFR-11) and never trusts these.

- [ ] **Step 6: Re-export everything from `index.ts`**

```typescript
export * from './errors/codes.js';
export * from './types/envelope.js';
export * from './types/metric.js';
export * from './types/alarm.js';
export * from './types/device.js';
export * from './types/session.js';
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm run test --workspace @nms/shared && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add domain types, error codes, and unavailable metric discriminator"
```

---

## Task 3: BFF skeleton — fail-fast config, structured logging with redaction, health endpoints

**Files:**
- Create: `packages/bff/package.json`, `packages/bff/tsconfig.json`, `packages/bff/src/index.ts`, `packages/bff/src/config/env.ts`, `packages/bff/src/observability/logger.ts`, `packages/bff/src/http/app.ts`, `packages/bff/src/http/middleware/correlationId.ts`, `packages/bff/src/http/middleware/securityHeaders.ts`, `packages/bff/src/http/middleware/errorHandler.ts`, `packages/bff/src/http/routes/health.ts`
- Modify: `.env.example`
- Test: `packages/bff/tests/unit/config.test.ts`, `packages/bff/tests/unit/logger.test.ts`, `packages/bff/tests/integration/health.test.ts`

**Interfaces:**
- Consumes: `@nms/shared` (`ApiFailure`, `ErrorCode`).
- Produces: `loadConfig(env): Config` (throws on invalid), `createLogger(config)` with `redact()`, `createApp(deps): Express`, `DependencyHealth = { status: 'ok'|'error', latencyMs?: number, error?: ErrorCode }`, and a `HealthChecks` interface `{ redis(): Promise<DependencyHealth>; librenms(): Promise<DependencyHealth>; idp(): Promise<DependencyHealth>; tsdb(): Promise<DependencyHealth> }`.

- [ ] **Step 1: Write the failing config test**

`packages/bff/tests/unit/config.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  REDIS_URL: 'redis://localhost:6379',
  LIBRENMS_BASE_URL: 'http://localhost:8000',
  LIBRENMS_API_TOKEN: 'test-token',
  OIDC_ISSUER_URL: 'https://idp.example.com/realms/nms',
  OIDC_CLIENT_ID: 'nms-custom-ui',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: 'http://localhost:4000/auth/callback',
  SESSION_COOKIE_NAME: 'nms_session',
  ROLE_MAP: '{"nms-admin":"admin","nms-readonly":"readonly"}',
  AUTH_MODE: 'oidc'
};

describe('loadConfig', () => {
  it('accepts a complete valid environment', () => {
    expect(loadConfig(valid).port).toBe(4000);
  });

  it('throws when a required secret is missing', () => {
    const { LIBRENMS_API_TOKEN, ...missing } = valid;
    expect(() => loadConfig(missing)).toThrow(/LIBRENMS_API_TOKEN/);
  });

  it('refuses AUTH_MODE=dev-local in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', AUTH_MODE: 'dev-local' }))
      .toThrow(/dev-local/);
  });

  it('never includes secret values in the thrown message', () => {
    try {
      loadConfig({ ...valid, PORT: 'not-a-number' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain('secret');
      expect((err as Error).message).not.toContain('test-token');
    }
  });
});
```

The last test matters: a validation error that echoes the whole environment is a secret leak into logs (NFR-15).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit --workspace @nms/bff`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/bff/src/config/env.ts`**

```typescript
import { z } from 'zod';

const SECRET_KEYS = ['LIBRENMS_API_TOKEN', 'OIDC_CLIENT_SECRET', 'TSDB_TOKEN', 'TSDB_PASSWORD'];

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive(),
  REDIS_URL: z.string().url(),
  LIBRENMS_BASE_URL: z.string().url(),
  LIBRENMS_API_TOKEN: z.string().min(1),
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1),
  SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
  SESSION_ABSOLUTE_LIFETIME_SECONDS: z.coerce.number().int().positive().default(28800),
  ROLE_MAP: z.string().min(1),
  AUTH_MODE: z.enum(['oidc', 'dev-local']).default('oidc'),
  LIBRENMS_UI_BASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
}).strict();

export interface Config {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly redisUrl: string;
  readonly librenms: { baseUrl: string; apiToken: string; uiBaseUrl: string | undefined };
  readonly oidc: { issuerUrl: string; clientId: string; clientSecret: string; redirectUri: string };
  readonly session: { cookieName: string; idleTimeoutSeconds: number; absoluteLifetimeSeconds: number };
  readonly roleMap: Readonly<Record<string, string>>;
  readonly authMode: 'oidc' | 'dev-local';
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const relevant = Object.fromEntries(
    Object.entries(env).filter(([k]) => k in schema.shape)
  );
  const parsed = schema.safeParse(relevant);
  if (!parsed.success) {
    // Report only the offending KEYS and messages — never the values (NFR-15).
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const value = parsed.data;

  if (value.NODE_ENV === 'production' && value.AUTH_MODE === 'dev-local') {
    throw new Error('Invalid configuration: AUTH_MODE=dev-local is forbidden when NODE_ENV=production');
  }
  for (const key of SECRET_KEYS) {
    const v = env[key];
    if (v !== undefined && v.trim() === '') {
      throw new Error(`Invalid configuration: ${key} must not be empty`);
    }
  }

  let roleMap: Record<string, string>;
  try {
    roleMap = JSON.parse(value.ROLE_MAP) as Record<string, string>;
  } catch {
    throw new Error('Invalid configuration: ROLE_MAP must be valid JSON');
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    redisUrl: value.REDIS_URL,
    librenms: {
      baseUrl: value.LIBRENMS_BASE_URL,
      apiToken: value.LIBRENMS_API_TOKEN,
      uiBaseUrl: value.LIBRENMS_UI_BASE_URL
    },
    oidc: {
      issuerUrl: value.OIDC_ISSUER_URL,
      clientId: value.OIDC_CLIENT_ID,
      clientSecret: value.OIDC_CLIENT_SECRET,
      redirectUri: value.OIDC_REDIRECT_URI
    },
    session: {
      cookieName: value.SESSION_COOKIE_NAME,
      idleTimeoutSeconds: value.SESSION_IDLE_TIMEOUT_SECONDS,
      absoluteLifetimeSeconds: value.SESSION_ABSOLUTE_LIFETIME_SECONDS
    },
    roleMap,
    authMode: value.AUTH_MODE,
    logLevel: value.LOG_LEVEL
  };
}
```

- [ ] **Step 4: Write the failing logger-redaction test**

`packages/bff/tests/unit/logger.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { redact } from '../../src/observability/logger.js';

describe('redact', () => {
  it('redacts authorization headers', () => {
    expect(redact({ headers: { authorization: 'Bearer abc' } }))
      .toEqual({ headers: { authorization: '[REDACTED]' } });
  });

  it('redacts cookies, tokens, secrets, and communities', () => {
    const out = redact({
      cookie: 'nms_session=xyz',
      access_token: 'a',
      client_secret: 'b',
      snmpCommunity: 'public',
      password: 'p'
    }) as Record<string, unknown>;
    for (const key of ['cookie', 'access_token', 'client_secret', 'snmpCommunity', 'password']) {
      expect(out[key]).toBe('[REDACTED]');
    }
  });

  it('redacts nested values and preserves safe fields', () => {
    expect(redact({ ctx: { userId: 'u1', refreshToken: 'r' } }))
      .toEqual({ ctx: { userId: 'u1', refreshToken: '[REDACTED]' } });
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm run test:unit --workspace @nms/bff`
Expected: FAIL — `redact` not found.

- [ ] **Step 6: Implement `packages/bff/src/observability/logger.ts`**

```typescript
import type { Config } from '../config/env.js';

const REDACT_PATTERN =
  /^(authorization|cookie|set-cookie|password|.*token.*|.*secret.*|.*community.*|.*apikey.*|.*api_key.*)$/i;

export const REDACTED = '[REDACTED]';

export function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input === null || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = REDACT_PATTERN.test(key) ? REDACTED : redact(value);
  }
  return out;
}

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
  audit(entry: { actor: string; action: string; target: string; outcome: 'success' | 'denied' | 'failure'; correlationId: string }): void;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export function createLogger(config: Pick<Config, 'logLevel'>, service = 'bff'): Logger {
  const threshold = LEVELS[config.logLevel];
  const emit = (level: keyof typeof LEVELS, message: string, context?: unknown) => {
    if (LEVELS[level] < threshold) return;
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        service,
        message,
        context: context === undefined ? undefined : redact(context)
      }) + '\n'
    );
  };
  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    audit: (entry) =>
      process.stdout.write(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'INFO',
          service,
          message: 'audit',
          audit: redact(entry)
        }) + '\n'
      )
  };
}
```

Redaction lives at the logger layer, so no call site can forget it (NFR-15).

- [ ] **Step 7: Write the failing health integration test**

`packages/bff/tests/integration/health.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/observability/logger.js';

const ok = async () => ({ status: 'ok' as const, latencyMs: 1 });
const logger = createLogger({ logLevel: 'error' });

function appWith(checks: Record<string, () => Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }>>) {
  return createApp({
    logger,
    healthChecks: checks as never,
    version: '0.1.0',
    routers: []
  });
}

describe('health endpoints', () => {
  it('GET /health returns 200 and calls no dependency', async () => {
    let called = false;
    const res = await request(
      appWith({ redis: async () => { called = true; return { status: 'ok' }; }, librenms: ok, idp: ok, tsdb: ok })
    ).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('bff');
    expect(called).toBe(false);
  });

  it('GET /ready returns 200 when all dependencies are healthy', async () => {
    const res = await request(appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok })).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.librenms.status).toBe('ok');
  });

  it('GET /ready returns 503 when LibreNMS is down while /health stays 200 (AC-E#28)', async () => {
    const checks = {
      redis: ok, idp: ok, tsdb: ok,
      librenms: async () => ({ status: 'error' as const, error: 'UPSTREAM_UNAVAILABLE' })
    };
    const ready = await request(appWith(checks)).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('not_ready');
    const live = await request(appWith(checks)).get('/health');
    expect(live.status).toBe(200);
  });

  it('never leaks a hostname, DSN, or credential in /ready output', async () => {
    const checks = {
      redis: ok, idp: ok, tsdb: ok,
      librenms: async () => ({ status: 'error' as const, error: 'UPSTREAM_UNAVAILABLE' })
    };
    const res = await request(appWith(checks)).get('/ready');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/redis:\/\/|http:\/\/|https:\/\/|token|secret/i);
  });

  it('sets security headers on responses (AC-F#33)', async () => {
    const res = await request(appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok })).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('returns a correlation id on every response (NFR-23)', async () => {
    const res = await request(appWith({ redis: ok, librenms: ok, idp: ok, tsdb: ok })).get('/health');
    expect(res.headers['x-correlation-id']).toBeTruthy();
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npm run test:integration --workspace @nms/bff`
Expected: FAIL — `createApp` not found.

- [ ] **Step 9: Implement the middleware and app**

`packages/bff/src/http/middleware/correlationId.ts`:
```typescript
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

export const correlationId: RequestHandler = (req, res, next) => {
  const incoming = req.header(CORRELATION_HEADER);
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.locals.correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  next();
};
```

The inbound value is validated before reuse — an unvalidated header echoed into logs and responses is a log-injection vector.

`packages/bff/src/http/middleware/securityHeaders.ts`:
```typescript
import type { RequestHandler } from 'express';

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
};
```

CSP here is the API's own (it serves JSON, so `default-src 'none'` is correct). The UI's CSP is set in Task 8 — they are different documents with different needs.

`packages/bff/src/http/middleware/errorHandler.ts`:
```typescript
import type { ErrorRequestHandler } from 'express';
import type { ApiFailure, ErrorCode } from '@nms/shared';
import type { Logger } from '../../observability/logger.js';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly field?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundHandler: ErrorRequestHandler = (_err, _req, _res, next) => next();

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const requestId = String(res.locals.correlationId ?? 'unknown');
    if (err instanceof AppError) {
      const body: ApiFailure = {
        success: false,
        errors: [{ code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) }],
        meta: { requestId }
      };
      if (err.status >= 500) logger.error('request failed', { requestId, code: err.code });
      else logger.info('request rejected', { requestId, code: err.code });
      res.status(err.status).json(body);
      return;
    }
    // Unknown errors: log server-side, return a safe summary (no stack, no internals).
    logger.error('unhandled error', { requestId, name: (err as Error)?.name });
    const body: ApiFailure = {
      success: false,
      errors: [{ code: 'INTERNAL_ERROR', message: 'An internal error occurred.' }],
      meta: { requestId }
    };
    res.status(500).json(body);
  };
}
```

`packages/bff/src/http/routes/health.ts`:
```typescript
import { Router } from 'express';
import type { ErrorCode } from '@nms/shared';

export interface DependencyHealth {
  readonly status: 'ok' | 'error';
  readonly latencyMs?: number;
  readonly error?: ErrorCode;
}

export interface HealthChecks {
  redis(): Promise<DependencyHealth>;
  librenms(): Promise<DependencyHealth>;
  idp(): Promise<DependencyHealth>;
  tsdb(): Promise<DependencyHealth>;
}

export function createHealthRouter(checks: HealthChecks, version: string): Router {
  const router = Router();
  const startedAt = Date.now();

  // Liveness: NO dependency calls (NFR-21).
  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'bff',
      version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    });
  });

  // Readiness: dependency-aware; 503 when any dependency is unhealthy (AC-E#28).
  router.get('/ready', async (_req, res) => {
    const names = ['redis', 'librenms', 'idp', 'tsdb'] as const;
    const results = await Promise.all(
      names.map(async (name) => {
        try {
          return [name, await checks[name]()] as const;
        } catch {
          return [name, { status: 'error', error: 'UPSTREAM_UNAVAILABLE' } as DependencyHealth] as const;
        }
      })
    );
    const built = Object.fromEntries(results);
    const ready = results.every(([, r]) => r.status === 'ok');
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'bff',
      checks: built
    });
  });

  return router;
}
```

`packages/bff/src/http/app.ts`:
```typescript
import express, { type Express, type Router } from 'express';
import { correlationId } from './middleware/correlationId.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { createHealthRouter, type HealthChecks } from './routes/health.js';
import type { Logger } from '../observability/logger.js';

export interface AppDeps {
  readonly logger: Logger;
  readonly healthChecks: HealthChecks;
  readonly version: string;
  readonly routers: readonly Router[];
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));
  app.use(createHealthRouter(deps.healthChecks, deps.version));
  for (const router of deps.routers) app.use('/api/v1', router);
  app.use(createErrorHandler(deps.logger));
  return app;
}
```

- [ ] **Step 10: Create `packages/bff/src/index.ts` (startup: validate config, then listen)**

```typescript
import { loadConfig } from './config/env.js';
import { createLogger } from './observability/logger.js';
import { createApp } from './http/app.js';

const config = loadConfig(process.env); // Throws before listening — fail fast (NFR-29).
const logger = createLogger(config);

const unimplemented = async () => ({ status: 'ok' as const, latencyMs: 0 });

const app = createApp({
  logger,
  version: '0.1.0',
  routers: [],
  healthChecks: { redis: unimplemented, librenms: unimplemented, idp: unimplemented, tsdb: unimplemented }
});

app.listen(config.port, () => logger.info('bff listening', { port: config.port }));
```

Health checks are placeholders here and are replaced with real probes in Tasks 4 and 5. Leaving them as `ok` past those tasks would make `/ready` lie, so Task 5's step list replaces them explicitly.

- [ ] **Step 11: Add `packages/bff/package.json` and `tsconfig.json`**

```json
{
  "name": "@nms/bff",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "dev": "node --watch --experimental-strip-types src/index.ts",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src tests"
  },
  "dependencies": { "@nms/shared": "*", "express": "*", "zod": "*" },
  "devDependencies": { "supertest": "*", "vitest": "*", "@types/express": "*", "@types/supertest": "*" }
}
```

Replace each `"*"` with the exact version `npm install` resolves, then never change it without plan approval (team-config §7). `tsconfig.json` mirrors `packages/shared/tsconfig.json` plus a project reference to `../shared`.

- [ ] **Step 12: Update `.env.example`**

```
NODE_ENV=development
PORT=4000
REDIS_URL=redis://localhost:6379
# revision 2: the engine is REMOTE and HTTPS (Task 0.6 Step 11). Placeholder only.
LIBRENMS_BASE_URL=https://librenms.example.com
LIBRENMS_API_TOKEN=replace-me
LIBRENMS_UI_BASE_URL=https://librenms.example.com
OIDC_ISSUER_URL=https://idp.example.com/realms/nms
OIDC_CLIENT_ID=nms-custom-ui
OIDC_CLIENT_SECRET=replace-me
OIDC_REDIRECT_URI=http://localhost:4000/auth/callback
SESSION_COOKIE_NAME=nms_session
SESSION_IDLE_TIMEOUT_SECONDS=1800
SESSION_ABSOLUTE_LIFETIME_SECONDS=28800
ROLE_MAP={"nms-admin":"admin","nms-engineer":"engineer","nms-operator":"operator","nms-readonly":"readonly"}
AUTH_MODE=oidc
LOG_LEVEL=info
```

Placeholders only. A real token in this file is a committed secret (NFR-09).

- [ ] **Step 13: Run all tests and verify the health contract by hand**

Run: `npm run test --workspace @nms/bff`
Expected: PASS, all config, logger, and health tests.

Then run `npm run dev:bff` and:
```bash
curl -i http://localhost:4000/health   # 200 {"status":"ok","service":"bff",...}
curl -i http://localhost:4000/ready    # 200 {"status":"ready",...}
```

- [ ] **Step 14: Commit**

```bash
git add packages/bff .env.example
git commit -m "feat(bff): add fail-fast config, redacting logger, and health/ready endpoints"
```

---

## Task 4: LibreNMS client — the only holder of the API token

**Files:**
- Create: `packages/bff/src/librenms/client.ts`, `packages/bff/src/librenms/mappers.ts`
- Test: `packages/bff/tests/unit/librenms-client.test.ts`

**Interfaces:**
- Consumes: `Config['librenms']`, `Logger`, shared `Alarm`/`Device`/`DeviceInterface`.
- Produces: `LibreNmsClient` with `listAlarms(query)`, `getAlarm(id)`, `acknowledgeAlarm(id, actor)`, `listDevices(query)`, `getDevice(id)`, `listDeviceInterfaces(deviceId, query)`, `ensureUser(username, level)`, `checkHealth()`. All return domain types from `@nms/shared`, never raw LibreNMS payloads.

- [ ] **Step 1: Write the failing client test**

`packages/bff/tests/unit/librenms-client.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createLibreNmsClient } from '../../src/librenms/client.js';
import { createLogger } from '../../src/observability/logger.js';

const logger = createLogger({ logLevel: 'error' });
const config = { baseUrl: 'http://lnms.test', apiToken: 'super-secret-token', uiBaseUrl: undefined };

describe('LibreNmsClient', () => {
  it('sends the API token in the X-Auth-Token header', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ devices: [], count: 0 }), { status: 200 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await client.listDevices({ page: 1, perPage: 50 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ 'X-Auth-Token': 'super-secret-token' });
  });

  it('throws UPSTREAM_UNAVAILABLE when the network fails', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDevices({ page: 1, perPage: 50 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('throws UPSTREAM_ERROR on a 500 and never includes the token in the error', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.listDevices({ page: 1, perPage: 50 })).rejects.toSatisfy((err: Error) => {
      expect(err.message).not.toContain('super-secret-token');
      return true;
    });
  });

  it('acknowledgeAlarm rejects rather than resolving when upstream fails (FR-35)', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await expect(client.acknowledgeAlarm('42', 'alice')).rejects.toBeDefined();
  });

  it('applies a request timeout', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(init.signal).toBeDefined();
      return new Response(JSON.stringify({ devices: [], count: 0 }), { status: 200 });
    });
    const client = createLibreNmsClient(config, logger, fetchMock as unknown as typeof fetch);
    await client.listDevices({ page: 1, perPage: 50 });
    expect(fetchMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit --workspace @nms/bff`
Expected: FAIL — `createLibreNmsClient` not found.

- [ ] **Step 3: Implement `packages/bff/src/librenms/client.ts`**

```typescript
import type { Alarm, Device, DeviceInterface } from '@nms/shared';
import { AppError } from '../http/middleware/errorHandler.js';
import type { Logger } from '../observability/logger.js';
import type { DependencyHealth } from '../http/routes/health.js';
import { toAlarm, toDevice, toInterface } from './mappers.js';

export interface LibreNmsConfig {
  readonly baseUrl: string;
  readonly apiToken: string;
  readonly uiBaseUrl: string | undefined;
}

export interface PageQuery { readonly page: number; readonly perPage: number }
export interface PagedUpstream<T> { readonly items: readonly T[]; readonly total: number }

const TIMEOUT_MS = 10_000;

export interface LibreNmsClient {
  listAlarms(q: PageQuery & { severity?: string; acknowledged?: boolean; deviceKind?: string }): Promise<PagedUpstream<Alarm>>;
  getAlarm(id: string): Promise<Alarm>;
  acknowledgeAlarm(id: string, actor: string): Promise<void>;
  listDevices(q: PageQuery & { hostname?: string; location?: string; reachability?: string }): Promise<PagedUpstream<Device>>;
  getDevice(id: string): Promise<Device>;
  listDeviceInterfaces(deviceId: string, q: PageQuery): Promise<PagedUpstream<DeviceInterface>>;
  ensureUser(username: string, level: number): Promise<void>;
  checkHealth(): Promise<DependencyHealth>;
}

export function createLibreNmsClient(
  config: LibreNmsConfig,
  logger: Logger,
  fetchImpl: typeof fetch = fetch
): LibreNmsClient {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          // The ONLY place the LibreNMS token is used. Never logged, never returned.
          'X-Auth-Token': config.apiToken,
          'Content-Type': 'application/json',
          ...(init.headers ?? {})
        }
      });
      if (!res.ok) {
        // Log the status and path only — never the token, never the upstream body verbatim.
        logger.warn('librenms call failed', { path, status: res.status });
        throw new AppError('UPSTREAM_ERROR', 'The monitoring engine returned an error.', 502);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn('librenms unreachable', { path });
      throw new AppError('UPSTREAM_UNAVAILABLE', 'The monitoring engine is unavailable.', 503);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listAlarms(q) {
      // Endpoint paths and native filter support are VERIFIED IN TASK 6 against the real
      // API (design doc §6 rows FR-31/FR-38). Filters not supported upstream are applied
      // in the BFF over a BOUNDED query — never by fetching the unbounded set.
      const raw = await call<{ alerts?: unknown[]; count?: number }>(
        `/api/v0/alerts?state=1&limit=${q.perPage}&offset=${(q.page - 1) * q.perPage}`
      );
      return { items: (raw.alerts ?? []).map(toAlarm), total: raw.count ?? (raw.alerts?.length ?? 0) };
    },
    async getAlarm(id) {
      const raw = await call<{ alerts?: unknown[] }>(`/api/v0/alerts/${encodeURIComponent(id)}`);
      const first = raw.alerts?.[0];
      if (!first) throw new AppError('NOT_FOUND', 'Alarm not found.', 404);
      return toAlarm(first);
    },
    async acknowledgeAlarm(id, actor) {
      await call<unknown>(`/api/v0/alerts/${encodeURIComponent(id)}/ack`, {
        method: 'PUT',
        body: JSON.stringify({ note: `Acknowledged via NMS custom UI by ${actor}` })
      });
    },
    async listDevices(q) {
      const raw = await call<{ devices?: unknown[]; count?: number }>(
        `/api/v0/devices?limit=${q.perPage}&offset=${(q.page - 1) * q.perPage}`
      );
      return { items: (raw.devices ?? []).map(toDevice), total: raw.count ?? (raw.devices?.length ?? 0) };
    },
    async getDevice(id) {
      const raw = await call<{ devices?: unknown[] }>(`/api/v0/devices/${encodeURIComponent(id)}`);
      const first = raw.devices?.[0];
      if (!first) throw new AppError('NOT_FOUND', 'Device not found.', 404);
      return toDevice(first);
    },
    async listDeviceInterfaces(deviceId, q) {
      const raw = await call<{ ports?: unknown[]; count?: number }>(
        `/api/v0/devices/${encodeURIComponent(deviceId)}/ports?limit=${q.perPage}&offset=${(q.page - 1) * q.perPage}`
      );
      return { items: (raw.ports ?? []).map(toInterface), total: raw.count ?? (raw.ports?.length ?? 0) };
    },
    async ensureUser(username, level) {
      logger.info('ensuring librenms user', { username, level });
      // Exact mechanism (API vs the `sso` auto-provisioning path) is confirmed in Task 6
      // Step 5 and implemented in Task 7 Step 9. Never patch LibreNMS core (FR-07).
      throw new AppError('INTERNAL_ERROR', 'ensureUser not yet wired; see Task 7.', 500);
    },
    async checkHealth() {
      const startedAt = Date.now();
      try {
        await call<unknown>('/api/v0/system');
        return { status: 'ok', latencyMs: Date.now() - startedAt };
      } catch {
        return { status: 'error', error: 'UPSTREAM_UNAVAILABLE' };
      }
    }
  };
}
```

- [ ] **Step 4: Implement `packages/bff/src/librenms/mappers.ts`**

```typescript
import { available, unavailable, type Alarm, type Device, type DeviceInterface, type DeviceKind, type AlarmSeverity, type Reachability } from '@nms/shared';
import { z } from 'zod';

const numberish = z.union([z.number(), z.string()]).nullish();

function toNumberMetric(raw: unknown) {
  const parsed = numberish.safeParse(raw);
  if (!parsed.success || parsed.data === null || parsed.data === undefined) {
    return unavailable<number>('NO_DATA');
  }
  const n = typeof parsed.data === 'string' ? Number(parsed.data) : parsed.data;
  return Number.isFinite(n) ? available(n) : unavailable<number>('NO_DATA');
}

const KIND_BY_TYPE: Record<string, DeviceKind> = {
  network: 'switch', router: 'router', switch: 'switch', wireless: 'p2p'
};

const alarmSchema = z.object({
  id: numberish, device_id: numberish, hostname: z.string().nullish(), sysName: z.string().nullish(),
  severity: z.string().nullish(), rule: z.string().nullish(), name: z.string().nullish(),
  timestamp: z.string().nullish(), acknowledged: z.union([z.boolean(), z.number()]).nullish(),
  acked_by: z.string().nullish(), acked_at: z.string().nullish(), entity: z.string().nullish()
}).passthrough();

function toSeverity(raw: string | null | undefined): AlarmSeverity {
  switch ((raw ?? '').toLowerCase()) {
    case 'critical': case 'crit': return 'critical';
    case 'warning': case 'warn': return 'warning';
    default: return 'ok';
  }
}

export function toAlarm(raw: unknown): Alarm {
  const a = alarmSchema.parse(raw);
  const firstRaisedAt = a.timestamp ?? new Date(0).toISOString();
  return {
    id: String(a.id ?? ''),
    deviceId: String(a.device_id ?? ''),
    deviceHostname: a.hostname ?? a.sysName ?? 'unknown',
    deviceKind: 'other',
    entity: a.entity ?? null,
    severity: toSeverity(a.severity),
    ruleName: a.rule ?? a.name ?? 'unknown rule',
    firstRaisedAt,
    durationSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(firstRaisedAt)) / 1000)),
    acknowledged: Boolean(a.acknowledged),
    acknowledgedBy: a.acked_by ?? null,
    acknowledgedAt: a.acked_at ?? null
  };
}

const deviceSchema = z.object({
  device_id: numberish, hostname: z.string().nullish(), sysName: z.string().nullish(),
  type: z.string().nullish(), location: z.string().nullish(),
  status: z.union([z.boolean(), z.number()]).nullish(), uptime: numberish
}).passthrough();

export function toDevice(raw: unknown): Device {
  const d = deviceSchema.parse(raw);
  const reachability: Reachability =
    d.status === null || d.status === undefined ? 'unknown' : Boolean(d.status) ? 'up' : 'down';
  return {
    id: String(d.device_id ?? ''),
    hostname: d.hostname ?? 'unknown',
    displayName: d.sysName ?? d.hostname ?? 'unknown',
    kind: KIND_BY_TYPE[(d.type ?? '').toLowerCase()] ?? 'other',
    location: d.location ?? null,
    reachability,
    uptimeSeconds: toNumberMetric(d.uptime)
  };
}

const portSchema = z.object({
  port_id: numberish, device_id: numberish, ifName: z.string().nullish(), ifDescr: z.string().nullish(),
  ifAdminStatus: z.string().nullish(), ifOperStatus: z.string().nullish(),
  ifInOctets_rate: numberish, ifOutOctets_rate: numberish
}).passthrough();

export function toInterface(raw: unknown): DeviceInterface {
  const p = portSchema.parse(raw);
  return {
    id: String(p.port_id ?? ''),
    deviceId: String(p.device_id ?? ''),
    name: p.ifName ?? p.ifDescr ?? 'unknown',
    adminState: (p.ifAdminStatus ?? '').toLowerCase() === 'up' ? 'up' : 'down',
    operState:
      (p.ifOperStatus ?? '').toLowerCase() === 'up' ? 'up'
      : (p.ifOperStatus ?? '').toLowerCase() === 'down' ? 'down' : 'unknown',
    inOctetsRate: toNumberMetric(p.ifInOctets_rate),
    outOctetsRate: toNumberMetric(p.ifOutOctets_rate)
  };
}
```

`toNumberMetric` is the FR-24 guarantee in code: a missing upstream value becomes `unavailable`, never `0`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit --workspace @nms/bff`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bff/src/librenms packages/bff/tests/unit/librenms-client.test.ts
git commit -m "feat(bff): add LibreNMS client with server-side token, timeouts, and safe error mapping"
```

---

## Task 5: Redis session store and real health probes

**Files:**
- Create: `packages/bff/src/auth/sessionStore.ts`, `packages/bff/src/cache/redis.ts`, `packages/bff/src/health/checks.ts`
- Modify: `packages/bff/src/index.ts`
- Test: `packages/bff/tests/unit/sessionStore.test.ts`

**Interfaces:**
- Consumes: `Config`, `Logger`, `LibreNmsClient.checkHealth`.
- Produces: `SessionStore` with `create(data)`, `get(id)`, `touch(id)`, `update(id, patch)`, `destroy(id)`; `SessionRecord { username, displayName, subject, role, accessToken, refreshToken, accessTokenExpiresAt, idpSid, createdAt, lastSeenAt }`; `createHealthChecks(deps): HealthChecks`.

- [ ] **Step 1: Write the failing session-store test**

`packages/bff/tests/unit/sessionStore.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createSessionStore } from '../../src/auth/sessionStore.js';

function fakeRedis() {
  const map = new Map<string, string>();
  return {
    store: map,
    async set(key: string, value: string) { map.set(key, value); },
    async get(key: string) { return map.get(key) ?? null; },
    async del(key: string) { map.delete(key); },
    async expire() {},
    async ping() { return 'PONG'; }
  };
}

const base = {
  username: 'alice', displayName: 'Alice', subject: 'sub-1', role: 'operator' as const,
  accessToken: 'at', refreshToken: 'rt', accessTokenExpiresAt: Date.now() + 60_000, idpSid: 'sid-1'
};

describe('SessionStore', () => {
  it('creates a session with a high-entropy id not derived from user data', async () => {
    const store = createSessionStore(fakeRedis() as never, { idleTimeoutSeconds: 60, absoluteLifetimeSeconds: 600 });
    const id = await store.create(base);
    expect(id.length).toBeGreaterThanOrEqual(32);
    expect(id).not.toContain('alice');
    expect(id).not.toContain('sub-1');
  });

  it('returns the stored record', async () => {
    const store = createSessionStore(fakeRedis() as never, { idleTimeoutSeconds: 60, absoluteLifetimeSeconds: 600 });
    const id = await store.create(base);
    expect((await store.get(id))?.username).toBe('alice');
  });

  it('returns null for an unknown session', async () => {
    const store = createSessionStore(fakeRedis() as never, { idleTimeoutSeconds: 60, absoluteLifetimeSeconds: 600 });
    expect(await store.get('nope')).toBeNull();
  });

  it('destroy makes the session unusable immediately (FR-18)', async () => {
    const store = createSessionStore(fakeRedis() as never, { idleTimeoutSeconds: 60, absoluteLifetimeSeconds: 600 });
    const id = await store.create(base);
    await store.destroy(id);
    expect(await store.get(id)).toBeNull();
  });

  it('rejects a session past its absolute lifetime even if Redis still holds it', async () => {
    const redis = fakeRedis();
    const store = createSessionStore(redis as never, { idleTimeoutSeconds: 600, absoluteLifetimeSeconds: 1 });
    const id = await store.create(base);
    const key = [...redis.store.keys()][0]!;
    const record = JSON.parse(redis.store.get(key)!);
    record.createdAt = Date.now() - 10_000;
    redis.store.set(key, JSON.stringify(record));
    expect(await store.get(id)).toBeNull();
  });

  it('generates unique ids across creations', async () => {
    const store = createSessionStore(fakeRedis() as never, { idleTimeoutSeconds: 60, absoluteLifetimeSeconds: 600 });
    const ids = new Set(await Promise.all([store.create(base), store.create(base), store.create(base)]));
    expect(ids.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit --workspace @nms/bff`
Expected: FAIL — `createSessionStore` not found.

- [ ] **Step 3: Implement `packages/bff/src/auth/sessionStore.ts`**

```typescript
import { randomBytes } from 'node:crypto';
import type { PlatformRole } from '@nms/shared';

export interface SessionRecord {
  username: string;
  displayName: string;
  subject: string;
  role: PlatformRole;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  idpSid: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface RedisLike {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  ping(): Promise<string>;
}

export interface SessionLifetimes {
  readonly idleTimeoutSeconds: number;
  readonly absoluteLifetimeSeconds: number;
}

export interface SessionStore {
  create(data: Omit<SessionRecord, 'createdAt' | 'lastSeenAt'>): Promise<string>;
  get(id: string): Promise<SessionRecord | null>;
  update(id: string, patch: Partial<SessionRecord>): Promise<void>;
  destroy(id: string): Promise<void>;
}

const KEY_PREFIX = 'sess:';

export function createSessionStore(redis: RedisLike, lifetimes: SessionLifetimes): SessionStore {
  const key = (id: string) => `${KEY_PREFIX}${id}`;

  return {
    async create(data) {
      // 32 bytes from a CSPRNG. Never Math.random, never derived from user data.
      const id = randomBytes(32).toString('base64url');
      const now = Date.now();
      const record: SessionRecord = { ...data, createdAt: now, lastSeenAt: now };
      await redis.set(key(id), JSON.stringify(record));
      await redis.expire(key(id), lifetimes.absoluteLifetimeSeconds);
      return id;
    },
    async get(id) {
      const raw = await redis.get(key(id));
      if (!raw) return null;
      const record = JSON.parse(raw) as SessionRecord;
      const now = Date.now();
      const expiredAbsolute = now - record.createdAt > lifetimes.absoluteLifetimeSeconds * 1000;
      const expiredIdle = now - record.lastSeenAt > lifetimes.idleTimeoutSeconds * 1000;
      if (expiredAbsolute || expiredIdle) {
        // Enforce lifetimes in code as well as via TTL — never trust the store alone (FR-19).
        await redis.del(key(id));
        return null;
      }
      record.lastSeenAt = now;
      await redis.set(key(id), JSON.stringify(record));
      return record;
    },
    async update(id, patch) {
      const raw = await redis.get(key(id));
      if (!raw) return;
      const record = { ...(JSON.parse(raw) as SessionRecord), ...patch, lastSeenAt: Date.now() };
      await redis.set(key(id), JSON.stringify(record));
    },
    async destroy(id) {
      await redis.del(key(id));
    }
  };
}
```

- [ ] **Step 4: Implement `packages/bff/src/cache/redis.ts` and `packages/bff/src/health/checks.ts`**

`redis.ts` exports `createRedis(url): RedisLike & { quit(): Promise<void> }` wrapping the pinned Redis client.

`checks.ts`:
```typescript
import type { HealthChecks, DependencyHealth } from '../http/routes/health.js';
import type { RedisLike } from '../auth/sessionStore.js';
import type { LibreNmsClient } from '../librenms/client.js';

async function timed(fn: () => Promise<unknown>): Promise<DependencyHealth> {
  const startedAt = Date.now();
  try {
    await fn();
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch {
    return { status: 'error', error: 'UPSTREAM_UNAVAILABLE' };
  }
}

export interface HealthDeps {
  readonly redis: RedisLike;
  readonly librenms: LibreNmsClient;
  readonly idpIssuerUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export function createHealthChecks(deps: HealthDeps): HealthChecks {
  const doFetch = deps.fetchImpl ?? fetch;
  return {
    redis: () => timed(() => deps.redis.ping()),
    librenms: () => deps.librenms.checkHealth(),
    idp: () =>
      timed(async () => {
        const res = await doFetch(`${deps.idpIssuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`);
        if (!res.ok) throw new Error('idp discovery failed');
      }),
    // TSDB read adapter is Phase 2 (ADR 0005). Until then the probe reports ok so /ready
    // reflects only dependencies Phase 1 actually uses. Replace when the adapter lands.
    tsdb: async () => ({ status: 'ok', latencyMs: 0 })
  };
}
```

- [ ] **Step 5: Wire the real checks into `packages/bff/src/index.ts`**

Replace the `unimplemented` placeholders from Task 3 Step 10 with `createHealthChecks({ redis, librenms, idpIssuerUrl: config.oidc.issuerUrl })`, constructing `redis` from `createRedis(config.redisUrl)` and `librenms` from `createLibreNmsClient(config.librenms, logger)`.

- [ ] **Step 6: Run tests and verify `/ready` degrades**

Run: `npm run test --workspace @nms/bff`
Expected: PASS.

Then, with Redis and LibreNMS running, `curl -i http://localhost:4000/ready` → `200 ready`. Stop LibreNMS and repeat → `503 not_ready` with `librenms.status = "error"`, while `/health` still returns `200`. **This is AC-E#28.**

- [ ] **Step 7: Commit**

```bash
git add packages/bff/src/auth/sessionStore.ts packages/bff/src/cache packages/bff/src/health packages/bff/src/index.ts packages/bff/tests/unit/sessionStore.test.ts
git commit -m "feat(bff): add Redis session store and dependency-aware readiness probes"
```

---

## Task 6: Phase 0 verification — LibreNMS stack up and the API coverage matrix confirmed

This task produces **no application code**. It replaces assumption with measurement, and its output can change the design.

**Files:**
- Create: `docs/design/api-coverage-verification.md`  *(revision 2: `docker-compose.yml` moved to `deploy/librenms/compose.yml`, authored in Task 0.2)*
- Modify: `packages/bff/src/librenms/client.ts` (endpoint paths/filters — only if verification contradicts them)

**Interfaces:**
- Consumes: Task 4's client.
- Produces: a confirmed endpoint/filter list; any gap is escalated, not worked around.

- [ ] **Step 1: Confirm Task 0.6 passed — this task is GATED**

**REVISED (revision 2).** Do not start until **Task 0.6 (FR-58 verification) has passed all twelve checks** and `LIBRENMS_BASE_URL` points at the human's server. If any Task 0.6 check failed, stop and report to Jarvis — verifying ASM-1 against a half-working engine produces conclusions that have to be thrown away.

Note the engine is **remote**, so every command below targets `$LIBRENMS_BASE_URL` over HTTPS, not `localhost:8000`. If TLS uses a private CA, this host must trust it (Task 0.6 Step 10).

- [ ] **Step 2: (MOVED) The stack is already up**

**This step's v1 content moved to Tasks 0.2/0.4a** — the engine is deployed on the human's server, not brought up locally, and the manifest lives at `deploy/librenms/compose.yml` rather than a repo-root `docker-compose.yml`. Nothing to do here beyond confirming Step 1.

- [ ] **Step 3: Confirm authenticated API access from this machine**

```bash
curl -s -H "X-Auth-Token: $LIBRENMS_API_TOKEN" "$LIBRENMS_BASE_URL/api/v0/system" | head -c 400
```
Expected: a JSON system payload. The token comes from Task 0.6 Step 1 and lives in the git-ignored local `.env` — never in the repo.

- [ ] **Step 4: Verify each Phase 1 matrix row and record the result**

Work through the design doc §6 Phase 1 table. For each row, run the call and record actual behaviour in `docs/design/api-coverage-verification.md` with the request, an abridged response, and a verdict. The rows that must be answered precisely, because the design depends on them:

```bash
# FR-38 — does the API paginate server-side? THE most important row.
curl -s -H "X-Auth-Token: $T" "$LIBRENMS_BASE_URL/api/v0/devices?limit=2&offset=0" | head -c 600
# Does the response honour limit/offset, and does it report a total count?

# FR-37 — are hostname/type/location/status filters supported server-side?
curl -s -H "X-Auth-Token: $T" "$LIBRENMS_BASE_URL/api/v0/devices?type=network" | head -c 400

# FR-31/FR-32 — alarm list fields, filters, and the acknowledger identity
curl -s -H "X-Auth-Token: $T" "$LIBRENMS_BASE_URL/api/v0/alerts?state=1" | head -c 800

# FR-39 — per-interface state and rates
curl -s -H "X-Auth-Token: $T" "$LIBRENMS_BASE_URL/api/v0/devices/1/ports" | head -c 800
```

- [ ] **Step 5: Verify the acknowledgment and SSO provisioning mechanisms**

Acknowledge a real alert via the API, then confirm the native UI shows it acknowledged (**AC-D#22** rehearsal). Separately, confirm how LibreNMS's `sso` mechanism creates/updates users and levels (FR-16) — this determines whether Task 7 Step 9 uses the users API or relies on `sso` auto-provisioning.

- [ ] **Step 6: Reconcile findings with the client, or escalate**

- Endpoint path or parameter differences → correct `client.ts` and its tests.
- **A missing capability (e.g. no server-side pagination, or no acknowledger identity) → STOP and report to Jarvis.** Per the design doc §6, a failed row is a design change, not an implementation detail, and it comes back to the Technical Architect. Do not silently substitute a full-table fetch for missing pagination: that breaks FR-38 and NFR-08 at 5,000 devices, which is precisely the failure this task exists to catch early.

- [ ] **Step 7: Commit**

```bash
git add docs/design/api-coverage-verification.md packages/bff/src/librenms
git commit -m "docs: record verified LibreNMS API coverage and stand up the Phase 0 stack"
```

---

## Task 7: OIDC login, callback, role mapping, and logout

**Files:**
- Create: `packages/bff/src/auth/oidcClient.ts`, `packages/bff/src/auth/tokenVerifier.ts`, `packages/bff/src/auth/roleMap.ts`, `packages/bff/src/http/middleware/auth.ts`, `packages/bff/src/http/middleware/rateLimit.ts`, `packages/bff/src/http/routes/auth.ts`
- Modify: `packages/bff/src/http/app.ts`, `packages/bff/src/index.ts`
- Test: `packages/bff/tests/unit/roleMap.test.ts`, `packages/bff/tests/unit/tokenVerifier.test.ts`, `packages/bff/tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `LibreNmsClient.ensureUser`, `Config['oidc'|'session'|'roleMap']`.
- Produces: `mapGroupsToRole(groups, roleMap): PlatformRole | null`, `verifyIdToken(token, opts): Promise<Claims>`, `requireSession: RequestHandler` (sets `res.locals.session`), `requireRole(...roles): RequestHandler`, and routes `/auth/login`, `/auth/callback`, `/auth/logout`, `/api/v1/session`.

- [ ] **Step 1: Write the failing role-map test (fail-closed is the point)**

`packages/bff/tests/unit/roleMap.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { mapGroupsToRole, roleToLibreNmsLevel } from '../../src/auth/roleMap.js';

const map = {
  'nms-admin': 'admin', 'nms-engineer': 'engineer',
  'nms-operator': 'operator', 'nms-readonly': 'readonly'
} as const;

describe('mapGroupsToRole', () => {
  it('maps each configured group to its role', () => {
    expect(mapGroupsToRole(['nms-admin'], map)).toBe('admin');
    expect(mapGroupsToRole(['nms-engineer'], map)).toBe('engineer');
    expect(mapGroupsToRole(['nms-operator'], map)).toBe('operator');
    expect(mapGroupsToRole(['nms-readonly'], map)).toBe('readonly');
  });

  it('picks the highest-privilege role when several groups match', () => {
    expect(mapGroupsToRole(['nms-readonly', 'nms-admin'], map)).toBe('admin');
  });

  it('returns null for an unmapped group — fail closed, never default to readonly', () => {
    expect(mapGroupsToRole(['some-other-group'], map)).toBeNull();
  });

  it('returns null for no groups at all', () => {
    expect(mapGroupsToRole([], map)).toBeNull();
  });

  it('maps roles to LibreNMS levels', () => {
    expect(roleToLibreNmsLevel('admin')).toBe(10);
    expect(roleToLibreNmsLevel('engineer')).toBe(1);
    expect(roleToLibreNmsLevel('operator')).toBe(1);
    expect(roleToLibreNmsLevel('readonly')).toBe(1);
  });
});
```

The unmapped-group cases encode ADR 0003's fail-closed decision. If a future change defaults them to `readonly`, these tests fail — which is the intent.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit --workspace @nms/bff`
Expected: FAIL — `mapGroupsToRole` not found.

- [ ] **Step 3: Implement `packages/bff/src/auth/roleMap.ts`**

```typescript
import type { PlatformRole } from '@nms/shared';

const PRECEDENCE: readonly PlatformRole[] = ['admin', 'engineer', 'operator', 'readonly'];
const VALID = new Set<string>(PRECEDENCE);

export function mapGroupsToRole(
  groups: readonly string[],
  roleMap: Readonly<Record<string, string>>
): PlatformRole | null {
  const matched = groups
    .map((g) => roleMap[g])
    .filter((r): r is PlatformRole => typeof r === 'string' && VALID.has(r));
  if (matched.length === 0) return null; // Fail closed (ADR 0003).
  for (const role of PRECEDENCE) if (matched.includes(role)) return role;
  return null;
}

// OQ-7: proposed mapping, pending human confirmation.
export function roleToLibreNmsLevel(role: PlatformRole): number {
  return role === 'admin' ? 10 : 1;
}

export function canAcknowledge(role: PlatformRole): boolean {
  return role !== 'readonly'; // FR-34
}

export function canOpenAdminPortal(role: PlatformRole): boolean {
  return role === 'admin' || role === 'engineer'; // FR-42, pending OQ-7
}
```

- [ ] **Step 4: Write the failing token-verifier test**

`packages/bff/tests/unit/tokenVerifier.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { verifyIdToken } from '../../src/auth/tokenVerifier.js';

// Uses a locally generated RSA keypair and a stub JWKS resolver so the four
// AC-A#6 rejection cases are tested without a live IdP.
const opts = { issuer: 'https://idp.test/realms/nms', audience: 'nms-custom-ui', nonce: 'n-1' };

describe('verifyIdToken', () => {
  it('accepts a valid token', async () => {
    const { token, jwks } = await makeToken({});
    await expect(verifyIdToken(token, { ...opts, jwks })).resolves.toMatchObject({ sub: 'sub-1' });
  });

  it('rejects an invalid signature (AC-A#6)', async () => {
    const { token, otherJwks } = await makeToken({});
    await expect(verifyIdToken(token, { ...opts, jwks: otherJwks })).rejects.toThrow();
  });

  it('rejects a wrong audience (AC-A#6)', async () => {
    const { token, jwks } = await makeToken({ aud: 'someone-else' });
    await expect(verifyIdToken(token, { ...opts, jwks })).rejects.toThrow();
  });

  it('rejects a wrong issuer (AC-A#6)', async () => {
    const { token, jwks } = await makeToken({ iss: 'https://evil.test' });
    await expect(verifyIdToken(token, { ...opts, jwks })).rejects.toThrow();
  });

  it('rejects an expired token (AC-A#6)', async () => {
    const { token, jwks } = await makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyIdToken(token, { ...opts, jwks })).rejects.toThrow();
  });

  it('rejects a mismatched nonce', async () => {
    const { token, jwks } = await makeToken({ nonce: 'different' });
    await expect(verifyIdToken(token, { ...opts, jwks })).rejects.toThrow();
  });
});
```

Implement the `makeToken` helper in `packages/bff/tests/helpers/jwt.ts` using the pinned JOSE library: generate an RSA keypair, sign a token with the given claim overrides (defaults `iss`/`aud`/`nonce` from `opts`, `sub: 'sub-1'`, `exp` one hour ahead), and return `{ token, jwks, otherJwks }` where `otherJwks` is a second, unrelated key set.

- [ ] **Step 5: Run to verify it fails, then implement `tokenVerifier.ts`**

Run: `npm run test:unit --workspace @nms/bff` → FAIL.

Implement `verifyIdToken` using the pinned JOSE library's remote-JWKS verification (cached with bounded refresh), asserting **signature, `iss`, `aud`, `exp`** and comparing `nonce` explicitly (NFR-14). On any failure, throw `AppError('AUTH_REQUIRED', ..., 401)` — never return partial claims.

- [ ] **Step 6: Implement the auth middleware**

`packages/bff/src/http/middleware/auth.ts`:
```typescript
import type { RequestHandler } from 'express';
import type { PlatformRole } from '@nms/shared';
import { AppError } from './errorHandler.js';
import type { SessionStore, SessionRecord } from '../../auth/sessionStore.js';

export interface AuthDeps {
  readonly sessions: SessionStore;
  readonly cookieName: string;
  readonly refreshIfNeeded: (id: string, record: SessionRecord) => Promise<SessionRecord>;
}

export function createRequireSession(deps: AuthDeps): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const id = req.cookies?.[deps.cookieName];
      if (typeof id !== 'string' || id.length === 0) {
        return next(new AppError('AUTH_REQUIRED', 'Authentication required.', 401));
      }
      const record = await deps.sessions.get(id);
      if (!record) {
        return next(new AppError('AUTH_REQUIRED', 'Authentication required.', 401));
      }
      try {
        // FR-17: refresh proactively; on failure the session is destroyed inside.
        res.locals.session = await deps.refreshIfNeeded(id, record);
        res.locals.sessionId = id;
        next();
      } catch {
        next(new AppError('SESSION_EXPIRED', 'Session expired. Please sign in again.', 401));
      }
    })();
  };
}

export function requireRole(...allowed: readonly PlatformRole[]): RequestHandler {
  return (_req, res, next) => {
    const session = res.locals.session as SessionRecord | undefined;
    if (!session) return next(new AppError('AUTH_REQUIRED', 'Authentication required.', 401));
    // Role comes ONLY from the server-side session — never from the request (NFR-11).
    if (!allowed.includes(session.role)) {
      return next(new AppError('FORBIDDEN', 'You do not have permission to perform this action.', 403));
    }
    next();
  };
}
```

- [ ] **Step 7: Write the failing auth integration test**

`packages/bff/tests/integration/auth.test.ts` asserts:
```typescript
it('GET /auth/login redirects with code, S256 challenge, state, and nonce (AC-A#1)', async () => {
  const res = await request(app).get('/auth/login');
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location!);
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
  expect(url.searchParams.get('state')).toBeTruthy();
  expect(url.searchParams.get('nonce')).toBeTruthy();
});

it('rejects a callback with an unknown state', async () => {
  const res = await request(app).get('/auth/callback?code=x&state=never-issued');
  expect(res.status).toBe(400);
});

it('rejects a replayed state (single use)', async () => { /* issue, consume, reuse → 400 */ });

it('sets a Secure HttpOnly SameSite cookie and leaks no token to the browser (AC-A#2)', async () => {
  const res = await completeLogin(app, { groups: ['nms-operator'] });
  const cookie = res.headers['set-cookie']!.join(';');
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(JSON.stringify(res.body)).not.toMatch(/access_token|refresh_token|eyJ/);
});

it('denies a user whose groups map to nothing (fail closed)', async () => {
  const res = await completeLogin(app, { groups: ['unmapped'] });
  expect(res.status).toBe(403);
});

it('GET /api/v1/session returns role and presentation hints', async () => { /* ... */ });

it('POST /auth/logout destroys the session and redirects to IdP end_session (FR-18)', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const out = await agent.post('/auth/logout').set('x-requested-with', 'nms-ui');
  expect(out.status).toBe(302);
  expect(out.headers.location).toContain('end_session');
  const after = await agent.get('/api/v1/session');
  expect(after.status).toBe(401);
});

it('rate-limits repeated callback attempts (NFR-17)', async () => { /* expect a 429 */ });
```

- [ ] **Step 8: Run to verify it fails, then implement the OIDC client and auth routes**

`oidcClient.ts` provides discovery (cached), `buildAuthorizationUrl({ state, nonce, codeChallenge })`, `exchangeCode({ code, codeVerifier })`, `refresh(refreshToken)`, and `buildEndSessionUrl({ idToken, postLogoutRedirectUri })`.

`routes/auth.ts` implements:
- `GET /auth/login` — generate `state`, `nonce`, and PKCE verifier with `randomBytes`; store in a short-TTL Redis pre-session; redirect (302) to the authorization URL.
- `GET /auth/callback` — rate-limited; look up and **delete** the pre-session (single use); exchange the code; verify the ID token; map groups → role (403 if null); `ensureUser` in LibreNMS at the mapped level (FR-16); create the session; set the cookie `Secure; HttpOnly; SameSite=Lax; Path=/`; redirect into the UI.
- `POST /auth/logout` — session required, custom-header CSRF check; destroy the session; clear the cookie; redirect to the IdP end-session URL.
- `GET /api/v1/session` — session required; return `SessionInfo` with `canAcknowledge`/`canOpenAdminPortal` as presentation hints only.

Set `Secure` unconditionally; for local HTTP development, drive it from config rather than sniffing the request, so production can never accidentally omit it.

- [ ] **Step 9: Implement `ensureUser` per Task 6 Step 5's finding**

Replace Task 4's placeholder throw with the mechanism verified in Phase 0 — the LibreNMS users API or reliance on the `sso` auto-provisioning path — including level update on subsequent logins (**AC-A#5**). Configuration only; **no LibreNMS core change** (FR-07, FR-13).

- [ ] **Step 10: Run all tests**

Run: `npm run test --workspace @nms/bff`
Expected: PASS, including all six token-verifier rejection cases and the fail-closed denial.

- [ ] **Step 11: Commit**

```bash
git add packages/bff/src/auth packages/bff/src/http packages/bff/tests
git commit -m "feat(bff): add OIDC login with PKCE, server-side token validation, role mapping, and logout"
```

---

## Task 8: Alarm endpoints and the acknowledgment write path

**Files:**
- Create: `packages/bff/src/http/routes/alarms.ts`, `packages/bff/src/http/validation/pagination.ts`
- Modify: `packages/bff/src/index.ts`
- Test: `packages/bff/tests/unit/pagination.test.ts`, `packages/bff/tests/integration/alarms.test.ts`

**Interfaces:**
- Consumes: `LibreNmsClient`, `requireSession`, `requireRole`, `Logger.audit`.
- Produces: routes `GET /api/v1/alarms`, `GET /api/v1/alarms/:id`, `POST /api/v1/alarms/:id/acknowledgement`; `parsePageQuery(query): { page, perPage }` throwing `VALIDATION_ERROR` beyond bounds.

- [ ] **Step 1: Write the failing pagination test**

`packages/bff/tests/unit/pagination.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parsePageQuery, MAX_PER_PAGE } from '../../src/http/validation/pagination.js';

describe('parsePageQuery', () => {
  it('defaults to page 1, perPage 50', () => {
    expect(parsePageQuery({})).toEqual({ page: 1, perPage: 50 });
  });

  it('accepts valid values', () => {
    expect(parsePageQuery({ page: '3', perPage: '25' })).toEqual({ page: 3, perPage: 25 });
  });

  it('rejects perPage above the cap so an unbounded fetch is impossible (FR-38)', () => {
    expect(() => parsePageQuery({ perPage: String(MAX_PER_PAGE + 1) })).toThrow(/perPage/);
  });

  it('rejects page 0 and negatives', () => {
    expect(() => parsePageQuery({ page: '0' })).toThrow();
    expect(() => parsePageQuery({ page: '-1' })).toThrow();
  });

  it('rejects non-numeric values', () => {
    expect(() => parsePageQuery({ page: 'abc' })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

`packages/bff/src/http/validation/pagination.ts`:
```typescript
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';

export const MAX_PER_PAGE = 200;

const schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(50)
});

export function parsePageQuery(query: unknown): { page: number; perPage: number } {
  const parsed = schema.safeParse(query ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new AppError('VALIDATION_ERROR', issue.message, 400, String(issue.path[0] ?? ''));
  }
  return parsed.data;
}
```

Run: `npm run test:unit --workspace @nms/bff` → PASS.

- [ ] **Step 3: Write the failing alarm integration test**

`packages/bff/tests/integration/alarms.test.ts`:
```typescript
it('GET /api/v1/alarms requires authentication (AC-F#32)', async () => {
  const res = await request(app).get('/api/v1/alarms');
  expect(res.status).toBe(401);
  expect(res.body.errors[0].code).toBe('AUTH_REQUIRED');
  expect(res.body.data).toBeUndefined();
});

it('returns a paginated envelope with meta (AC-E#26)', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.get('/api/v1/alarms?page=1&perPage=2');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.meta).toMatchObject({ page: 1, perPage: 2 });
  expect(res.body.meta.total).toBeTypeOf('number');
});

it('rejects perPage above the cap', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.get('/api/v1/alarms?perPage=100000');
  expect(res.status).toBe(400);
  expect(res.body.errors[0].code).toBe('VALIDATION_ERROR');
});

it('filters by severity, acknowledgment state, and device type (AC-D#21)', async () => { /* three assertions */ });

it('an operator can acknowledge, and LibreNMS is called (FR-33, AC-D#22)', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.post('/api/v1/alarms/42/acknowledgement').set('x-requested-with', 'nms-ui').send({});
  expect(res.status).toBe(200);
  expect(librenmsMock.acknowledgeAlarm).toHaveBeenCalledWith('42', expect.any(String));
});

it('a readonly user is denied 403 server-side, bypassing the UI (FR-34, AC-A#8)', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-readonly'] });
  const res = await agent.post('/api/v1/alarms/42/acknowledgement').set('x-requested-with', 'nms-ui').send({});
  expect(res.status).toBe(403);
  expect(res.body.errors[0].code).toBe('FORBIDDEN');
  expect(librenmsMock.acknowledgeAlarm).not.toHaveBeenCalled(); // denied BEFORE any upstream call
});

it('surfaces an upstream failure and does NOT report acknowledged (FR-35, AC-D#23)', async () => {
  librenmsMock.acknowledgeAlarm.mockRejectedValueOnce(new AppError('UPSTREAM_ERROR', 'upstream', 502));
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.post('/api/v1/alarms/42/acknowledgement').set('x-requested-with', 'nms-ui').send({});
  expect(res.status).toBe(502);
  expect(res.body.success).toBe(false);
  expect(JSON.stringify(res.body)).not.toMatch(/"acknowledged":\s*true/);
});

it('audit-logs the acknowledgment with actor and target (NFR-18, AC-F#34)', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  await agent.post('/api/v1/alarms/42/acknowledgement').set('x-requested-with', 'nms-ui').send({});
  expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
    action: 'alarm.acknowledge', target: 'alarm:42', outcome: 'success'
  }));
});

it('audit-logs a denial too', async () => { /* outcome: 'denied' */ });

it('rejects a state-changing request without the CSRF header', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.post('/api/v1/alarms/42/acknowledgement').send({});
  expect(res.status).toBe(403);
});
```

- [ ] **Step 4: Run to verify it fails, then implement `routes/alarms.ts`**

```typescript
import { Router } from 'express';
import { z } from 'zod';
import type { Alarm, ApiSuccess, PageMeta } from '@nms/shared';
import { parsePageQuery } from '../validation/pagination.js';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { LibreNmsClient } from '../../librenms/client.js';
import type { Logger } from '../../observability/logger.js';
import type { SessionRecord } from '../../auth/sessionStore.js';

const filterSchema = z.object({
  severity: z.enum(['critical', 'warning', 'ok']).optional(),
  acknowledged: z.enum(['true', 'false']).optional(),
  deviceKind: z.enum(['router', 'switch', 'p2p', 'other']).optional()
}).strict(); // Unknown query fields are rejected, not ignored.

export function createAlarmsRouter(deps: {
  librenms: LibreNmsClient;
  logger: Logger;
  requireSession: import('express').RequestHandler;
  requireCsrf: import('express').RequestHandler;
}): Router {
  const router = Router();

  router.get('/alarms', deps.requireSession, (req, res, next) => {
    void (async () => {
      try {
        const { page, perPage } = parsePageQuery(req.query);
        const { severity, acknowledged, deviceKind } = filterSchema.parse(
          Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== 'page' && k !== 'perPage'))
        );
        const upstream = await deps.librenms.listAlarms({
          page, perPage, severity, deviceKind,
          ...(acknowledged === undefined ? {} : { acknowledged: acknowledged === 'true' })
        });
        const meta: PageMeta = {
          page, perPage, total: upstream.total, hasNext: page * perPage < upstream.total
        };
        const body: ApiSuccess<readonly Alarm[]> = { success: true, data: upstream.items, meta };
        res.status(200).json(body);
      } catch (err) { next(err); }
    })();
  });

  router.get('/alarms/:id', deps.requireSession, (req, res, next) => {
    void (async () => {
      try {
        res.status(200).json({ success: true, data: await deps.librenms.getAlarm(req.params.id!) });
      } catch (err) { next(err); }
    })();
  });

  // FR-33/34/35: authorization BEFORE any upstream call; failure never reports acknowledged.
  router.post(
    '/alarms/:id/acknowledgement',
    deps.requireSession,
    deps.requireCsrf,
    requireRole('admin', 'engineer', 'operator'),
    (req, res, next) => {
      void (async () => {
        const session = res.locals.session as SessionRecord;
        const alarmId = req.params.id!;
        const correlationId = String(res.locals.correlationId);
        try {
          await deps.librenms.acknowledgeAlarm(alarmId, session.username);
          deps.logger.audit({
            actor: session.username, action: 'alarm.acknowledge',
            target: `alarm:${alarmId}`, outcome: 'success', correlationId
          });
          res.status(200).json({ success: true, data: { alarmId, acknowledged: true } });
        } catch (err) {
          deps.logger.audit({
            actor: session.username, action: 'alarm.acknowledge',
            target: `alarm:${alarmId}`, outcome: 'failure', correlationId
          });
          next(err instanceof AppError ? err : new AppError('UPSTREAM_ERROR', 'Acknowledgment failed.', 502));
        }
      })();
    }
  );

  return router;
}
```

Add `requireCsrf` (rejects state-changing requests lacking the expected custom header) to `middleware/rateLimit.ts`'s neighbouring module, and a `requireRole` denial audit entry in the error handler path so AC-F#34's denial case is covered.

- [ ] **Step 5: Run tests**

Run: `npm run test --workspace @nms/bff`
Expected: PASS, all alarm tests including the 403-before-upstream-call assertion.

- [ ] **Step 6: Commit**

```bash
git add packages/bff/src/http packages/bff/tests
git commit -m "feat(bff): add alarm endpoints with server-side ack authorization and audit logging"
```

---

## Task 9: Device inventory and detail endpoints

**Files:**
- Create: `packages/bff/src/http/routes/devices.ts`, `packages/bff/src/cache/cache.ts`
- Modify: `packages/bff/src/index.ts`
- Test: `packages/bff/tests/integration/devices.test.ts`, `packages/bff/tests/unit/cache.test.ts`

**Interfaces:**
- Consumes: `LibreNmsClient`, `requireSession`, `RedisLike`.
- Produces: routes `GET /api/v1/devices`, `GET /api/v1/devices/:id`, `GET /api/v1/devices/:id/interfaces`, `GET /api/v1/admin-portal-url`; `createCache(redis, { ttlSeconds })` with `getOrSet(key, fn)`.

- [ ] **Step 1: Write the failing device integration test**

```typescript
it('requires authentication (AC-F#32)', async () => {
  expect((await request(app).get('/api/v1/devices')).status).toBe(401);
});

it('returns paginated devices with meta and never the unbounded set (AC-E#26)', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.get('/api/v1/devices?perPage=2');
  expect(res.body.data.length).toBeLessThanOrEqual(2);
  expect(res.body.meta).toMatchObject({ page: 1, perPage: 2 });
});

it('filters by hostname fragment, kind, location, and reachability (AC-E#25)', async () => { /* four assertions */ });

it('returns device detail with uptime as an explicit metric value (AC-E#27)', async () => {
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.get('/api/v1/devices/1');
  expect(res.body.data.uptimeSeconds.status).toMatch(/available|unavailable/);
});

it('reports an absent metric as unavailable, never as zero (FR-24 groundwork)', async () => {
  librenmsMock.getDevice.mockResolvedValueOnce({ /* device with uptime: null */ });
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.get('/api/v1/devices/1');
  expect(res.body.data.uptimeSeconds).toEqual({ status: 'unavailable', reason: 'NO_DATA' });
  expect(res.body.data.uptimeSeconds.value).toBeUndefined();
});

it('returns 404 for an unknown device', async () => { /* NOT_FOUND */ });

it('returns paginated interfaces for a device (FR-39)', async () => { /* meta present */ });

it('returns an explicit error when LibreNMS is unavailable, never empty data (NFR-22)', async () => {
  librenmsMock.listDevices.mockRejectedValueOnce(new AppError('UPSTREAM_UNAVAILABLE', 'down', 503));
  const agent = await loggedInAgent(app, { groups: ['nms-operator'] });
  const res = await agent.get('/api/v1/devices');
  expect(res.status).toBe(503);
  expect(res.body.errors[0].code).toBe('UPSTREAM_UNAVAILABLE');
  expect(res.body.data).toBeUndefined();
});

it('admin-portal-url is granted to engineer and denied to operator (FR-42)', async () => {
  const engineer = await loggedInAgent(app, { groups: ['nms-engineer'] });
  expect((await engineer.get('/api/v1/admin-portal-url')).status).toBe(200);
  const operator = await loggedInAgent(app, { groups: ['nms-operator'] });
  expect((await operator.get('/api/v1/admin-portal-url')).status).toBe(403);
});
```

The NFR-22 test is important: an upstream outage must produce an error status, not a `200` with an empty array, because the UI cannot distinguish "no devices" from "backend down" otherwise.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration --workspace @nms/bff` → FAIL.

- [ ] **Step 3: Implement the cache wrapper**

`packages/bff/src/cache/cache.ts` exposes `getOrSet<T>(key, fn): Promise<T>` writing JSON to Redis under `cache:` with an explicit TTL (default **45 s**, under NFR-06's 60 s ceiling) and **failing open** — if Redis errors, call `fn` directly rather than failing the request. A cache outage must not become an inventory outage.

- [ ] **Step 4: Implement `routes/devices.ts`**

Mirror Task 8's structure: `requireSession` on every route; `parsePageQuery`; a `.strict()` Zod filter schema for `hostname`, `kind`, `location`, `reachability`; cached list reads via `getOrSet`; `PageMeta` on every list; `requireRole('admin', 'engineer')` on `/admin-portal-url`, which returns a URL built from `config.librenms.uiBaseUrl` plus the optional device path for deep linking (FR-41).

- [ ] **Step 5: Run tests**

Run: `npm run test --workspace @nms/bff` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bff/src/http/routes/devices.ts packages/bff/src/cache packages/bff/tests
git commit -m "feat(bff): add paginated device inventory, detail, and role-gated admin portal URL"
```

---

## Task 10: Next.js UI — login, alarm console, inventory, device detail

**Files:**
- Create: `packages/web/package.json`, `next.config.ts`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/alarms/page.tsx`, `src/app/devices/page.tsx`, `src/app/devices/[id]/page.tsx`, `src/app/health/route.ts`, `src/app/ready/route.ts`, `src/lib/bffClient.ts`, `src/components/DataState.tsx`, `src/components/AlarmTable.tsx`, `src/components/AcknowledgeButton.tsx`, `src/components/DeviceTable.tsx`, `src/components/MetricValueCell.tsx`, `src/components/AdminPortalLink.tsx`, `src/hooks/useSession.ts`
- Test: `packages/web/tests/DataState.test.tsx`, `packages/web/tests/MetricValueCell.test.tsx`, `packages/web/tests/AcknowledgeButton.test.tsx`

**Interfaces:**
- Consumes: `@nms/shared` types **only** — never `@nms/bff` (ADR 0001).
- Produces: `bffClient` (relative URLs, `credentials: 'include'`, never a token), `<DataState>` rendering loading/error/empty/content (FR-43), `<MetricValueCell>` rendering `unavailable` as explicit text (FR-24).

- [ ] **Step 1: Write the failing `DataState` test**

```typescript
import { render, screen } from '@testing-library/react';
import { DataState } from '../src/components/DataState';

it('renders a loading state', () => {
  render(<DataState status="loading">{() => <div>content</div>}</DataState>);
  expect(screen.getByRole('status')).toBeInTheDocument();
});

it('renders an explicit error with a retry action, never a blank view (FR-43)', () => {
  render(<DataState status="error" errorCode="UPSTREAM_UNAVAILABLE" onRetry={() => {}}>{() => <div/>}</DataState>);
  expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/i);
  expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
});

it('renders an empty state distinct from the error state', () => {
  render(<DataState status="empty">{() => <div/>}</DataState>);
  expect(screen.getByText(/no .* found/i)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('renders content when loaded', () => {
  render(<DataState status="success">{() => <div>content</div>}</DataState>);
  expect(screen.getByText('content')).toBeInTheDocument();
});
```

- [ ] **Step 2: Write the failing `MetricValueCell` test (FR-24)**

```typescript
it('renders an available value', () => {
  render(<MetricValueCell metric={{ status: 'available', value: 42, timestamp: 'now' }} unit="s" />);
  expect(screen.getByText(/42/)).toBeInTheDocument();
});

it('renders "Not available" for an unavailable metric — never 0, never healthy (FR-24)', () => {
  render(<MetricValueCell metric={{ status: 'unavailable', reason: 'OID_NOT_SUPPORTED' }} unit="s" />);
  expect(screen.getByText(/not available/i)).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

it('conveys unavailability by text, not colour alone (NFR-30)', () => {
  render(<MetricValueCell metric={{ status: 'unavailable', reason: 'NO_DATA' }} unit="s" />);
  expect(screen.getByTitle(/not available/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `npm run test --workspace @nms/web`
Expected: FAIL — components not found.

- [ ] **Step 4: Implement `DataState` and `MetricValueCell`**

`DataState` takes `status: 'loading' | 'error' | 'empty' | 'success'`, an optional `errorCode`/`onRetry`, and a render-prop child; it renders `role="status"` while loading, `role="alert"` plus a retry button on error, a distinct empty message, and the child on success. Error copy is derived from the machine-readable `ErrorCode`, never from a raw upstream message.

`MetricValueCell` switches on `metric.status` using the `isAvailable` guard from `@nms/shared`; the `unavailable` branch renders the text "Not available" with a `title` explaining the reason. It has **no numeric fallback path**, which is what prevents `0` from ever appearing for a missing metric.

- [ ] **Step 5: Implement `bffClient`**

```typescript
import type { ApiFailure } from '@nms/shared';

const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'nms-ui';

export class BffError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/bff${path}`, {
    ...init,
    credentials: 'include', // The opaque session cookie is the ONLY credential the browser holds.
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: CSRF_VALUE, ...(init.headers ?? {}) }
  });
  const body = (await res.json()) as { success: boolean } & Partial<ApiFailure> & { data?: T };
  if (!res.ok || !body.success) {
    const first = body.errors?.[0];
    if (res.status === 401) window.location.assign('/bff/auth/login'); // FR-17
    throw new BffError(first?.code ?? 'INTERNAL_ERROR', first?.message ?? 'Request failed', res.status);
  }
  return body.data as T;
}

export const bffClient = {
  getSession: () => request<import('@nms/shared').SessionInfo>('/api/v1/session'),
  listAlarms: (q: string) => request<readonly import('@nms/shared').Alarm[]>(`/api/v1/alarms?${q}`),
  acknowledgeAlarm: (id: string) =>
    request<{ alarmId: string }>(`/api/v1/alarms/${id}/acknowledgement`, { method: 'POST', body: '{}' }),
  listDevices: (q: string) => request<readonly import('@nms/shared').Device[]>(`/api/v1/devices?${q}`),
  getDevice: (id: string) => request<import('@nms/shared').Device>(`/api/v1/devices/${id}`)
};
```

`/bff` is a same-origin path routed to the BFF by the dev proxy and the production reverse proxy. **No LibreNMS API path is ever exposed here** (ADR 0002). Note this is a *UI→BFF* proxy carrying the user's own cookie — categorically different from the prohibited token-injecting `/api/v0/` proxy.

- [ ] **Step 6: Write the failing acknowledge-button test (FR-35 revert)**

```typescript
it('reverts optimistic state and shows an error when acknowledgment fails (FR-35)', async () => {
  acknowledgeMock.mockRejectedValueOnce(new BffError('UPSTREAM_ERROR', 'failed', 502));
  render(<AcknowledgeButton alarmId="42" acknowledged={false} canAcknowledge />);
  await userEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/failed/i);
  expect(screen.getByRole('button', { name: /acknowledge/i })).toBeEnabled();
});

it('is not rendered for a user who cannot acknowledge (presentation only)', () => {
  render(<AcknowledgeButton alarmId="42" acknowledged={false} canAcknowledge={false} />);
  expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
});
```

The second test's name states the boundary explicitly: hiding the button is presentation, and Task 8's 403 test is the actual control (FR-34).

- [ ] **Step 7: Implement the pages, components, and health routes**

- `/` — redirects to `/alarms` when a session exists, else to `/bff/auth/login`.
- `/alarms` — filter controls for device type, severity, and acknowledgment state (FR-31); columns per FR-32; `<AcknowledgeButton>`; wrapped in `<DataState>`.
- `/devices` — hostname search plus type/location/reachability filters, server-side paginated (FR-37/38).
- `/devices/[id]` — identity, reachability, uptime via `<MetricValueCell>`, paginated interface list (FR-39).
- `<AdminPortalLink>` — rendered only when `canOpenAdminPortal`, target fetched from `/api/v1/admin-portal-url` (FR-40/42).
- `src/app/health/route.ts` → `200 { status: 'ok', service: 'web', version }`, no dependency calls.
- `src/app/ready/route.ts` → checks the BFF's `/health`; `200 ready` or `503 not_ready`.
- `next.config.ts` sets the UI's own security headers (CSP with no `unsafe-inline` for scripts, HSTS, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`) and rewrites `/bff/*` to the BFF origin.

- [ ] **Step 8: Run tests, typecheck, and the dependency check**

Run: `npm run test --workspace @nms/web && npm run typecheck && npm run lint:deps`
Expected: PASS, and `Workspace dependency rule: OK` — proving `web` never reached into `bff`.

- [ ] **Step 9: Verify the health URLs by hand**

```bash
curl -i http://localhost:3000/health   # 200 {"status":"ok","service":"web",...}
curl -i http://localhost:3000/ready    # 200 ready; 503 when the BFF is stopped
```

- [ ] **Step 10: Commit**

```bash
git add packages/web
git commit -m "feat(web): add login redirect, alarm console, inventory, and device detail with explicit data states"
```

---

## Task 11: Security verification pass (AC-F#31..34)

**Files:**
- Create: `packages/bff/tests/integration/security.test.ts`, `scripts/scan-bundle-for-secrets.mjs`
- Test: as above.

**Interfaces:**
- Consumes: the assembled app and the built web bundle.
- Produces: an enumerated auth check across every route and a bundle secret scan usable in CI.

- [ ] **Step 1: Write the failing enumerated-auth test (AC-F#32)**

```typescript
const PROTECTED_ROUTES = [
  ['get', '/api/v1/session'],
  ['get', '/api/v1/alarms'],
  ['get', '/api/v1/alarms/42'],
  ['post', '/api/v1/alarms/42/acknowledgement'],
  ['get', '/api/v1/devices'],
  ['get', '/api/v1/devices/1'],
  ['get', '/api/v1/devices/1/interfaces'],
  ['get', '/api/v1/admin-portal-url']
] as const;

it.each(PROTECTED_ROUTES)('%s %s returns 401 without authentication', async (method, path) => {
  const res = await (request(app) as never)[method](path).set('x-requested-with', 'nms-ui');
  expect(res.status).toBe(401);
  expect(res.body.data).toBeUndefined();
});

const PUBLIC_ROUTES = [['get', '/health'], ['get', '/ready']] as const;

it.each(PUBLIC_ROUTES)('%s %s is intentionally public and returns no operational data', async (method, path) => {
  const res = await (request(app) as never)[method](path);
  expect([200, 503]).toContain(res.status);
  expect(JSON.stringify(res.body)).not.toMatch(/token|secret|redis:\/\/|password/i);
});
```

This list is the enumeration AC-F#32 asks for. Adding a route without adding it here should be caught in review; a future task adding routes must extend this list.

- [ ] **Step 2: Write the failing header/cookie test (AC-F#33)**

Assert on an authenticated response: `Strict-Transport-Security` with `max-age=31536000`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, and that the session cookie carries `Secure`, `HttpOnly`, `SameSite`.

- [ ] **Step 3: Write the failing log-inspection test (AC-F#34)**

Capture `process.stdout` during a login plus acknowledgment, then assert the captured JSON contains **no** `Bearer`, no `eyJ` JWT prefix, no cookie value, no `LIBRENMS_API_TOKEN` value, and no community string — and **does** contain an audit entry with actor and target.

- [ ] **Step 4: Run to verify these fail where behaviour is missing, then fix**

Run: `npm run test:integration --workspace @nms/bff`
Fix any gap in the middleware rather than weakening the test.

- [ ] **Step 5: Implement the bundle secret scan (AC-F#31)**

`scripts/scan-bundle-for-secrets.mjs` walks `packages/web/.next` after a production build and fails if it finds the configured `LIBRENMS_API_TOKEN`, `OIDC_CLIENT_SECRET`, or `TSDB_*` values, any `X-Auth-Token` literal, or any `NEXT_PUBLIC_` variable whose name matches the secret pattern from the logger.

- [ ] **Step 6: Run the full verification**

```bash
npm run build
node scripts/scan-bundle-for-secrets.mjs
npm run lint && npm run typecheck && npm test && npm run test:coverage
```
Expected: no secrets found; lint/typecheck clean; all tests pass; **≥80% coverage on new code** (NFR-28).

- [ ] **Step 7: Commit**

```bash
git add packages/bff/tests/integration/security.test.ts scripts/scan-bundle-for-secrets.mjs
git commit -m "test: add enumerated auth, header, log-redaction, and bundle secret checks"
```

---

## Task 12: Device simulation harness (FR-50..53)

**Files:**
- Create: `packages/simulator/package.json`, `tsconfig.json`, `src/index.ts`, `src/agent/snmpAgent.ts`, `src/agent/oidStore.ts`, `src/profiles/{router,switch,p2pRadio}.ts`, `src/control/api.ts`
- Test: `packages/simulator/tests/oidStore.test.ts`, `packages/simulator/tests/control.test.ts`

**Interfaces:**
- Consumes: `@nms/shared` (reuses `DeviceKind`).
- Produces: `OidStore` with `set(oid, value)`, `get(oid)`, `withhold(oid, mode)`, `restore(oid)`; `SnmpAgent` with `start()`/`stop()`; the control API from design doc §7.1.

- [ ] **Step 1: Write the failing OID-withholding test (FR-52)**

```typescript
import { describe, it, expect } from 'vitest';
import { createOidStore } from '../src/agent/oidStore.js';

const RSSI = '1.3.6.1.4.1.99999.1.2.1';

describe('OidStore withholding', () => {
  it('returns a value normally', () => {
    const store = createOidStore({ [RSSI]: -62 });
    expect(store.get(RSSI)).toEqual({ kind: 'value', value: -62 });
  });

  it('returns noSuchObject when withheld in that mode', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'noSuchObject');
    expect(store.get(RSSI)).toEqual({ kind: 'noSuchObject' });
  });

  it('returns noSuchInstance when withheld in that mode', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'noSuchInstance');
    expect(store.get(RSSI)).toEqual({ kind: 'noSuchInstance' });
  });

  it('omits the varbind from a walk when withheld in omit mode', () => {
    const store = createOidStore({ [RSSI]: -62, '1.3.6.1.4.1.99999.1.2.2': 20 });
    store.withhold(RSSI, 'omit');
    expect(store.walk('1.3.6.1.4.1.99999.1.2').map((v) => v.oid)).not.toContain(RSSI);
  });

  it('does not respond at all in timeout mode', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'timeout');
    expect(store.get(RSSI)).toEqual({ kind: 'timeout' });
  });

  it('NEVER substitutes zero for a withheld value — the FR-24 trap', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'noSuchObject');
    const result = store.get(RSSI);
    expect(result).not.toHaveProperty('value');
    expect(JSON.stringify(result)).not.toContain('0');
  });

  it('restores a withheld OID', () => {
    const store = createOidStore({ [RSSI]: -62 });
    store.withhold(RSSI, 'omit');
    store.restore(RSSI);
    expect(store.get(RSSI)).toEqual({ kind: 'value', value: -62 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace @nms/simulator`
Expected: FAIL — `createOidStore` not found.

- [ ] **Step 3: Implement `src/agent/oidStore.ts`**

```typescript
export type WithholdMode = 'noSuchObject' | 'noSuchInstance' | 'omit' | 'timeout';

export type OidResult =
  | { kind: 'value'; value: number | string }
  | { kind: 'noSuchObject' }
  | { kind: 'noSuchInstance' }
  | { kind: 'timeout' }
  | { kind: 'absent' };

export interface OidStore {
  set(oid: string, value: number | string): void;
  get(oid: string): OidResult;
  walk(prefix: string): readonly { oid: string; value: number | string }[];
  withhold(oid: string, mode: WithholdMode): void;
  restore(oid: string): void;
}

export function createOidStore(initial: Record<string, number | string> = {}): OidStore {
  const values = new Map<string, number | string>(Object.entries(initial));
  const withheld = new Map<string, WithholdMode>();

  return {
    set(oid, value) { values.set(oid, value); },
    get(oid) {
      const mode = withheld.get(oid);
      if (mode === 'noSuchObject') return { kind: 'noSuchObject' };
      if (mode === 'noSuchInstance') return { kind: 'noSuchInstance' };
      if (mode === 'timeout') return { kind: 'timeout' };
      if (mode === 'omit') return { kind: 'absent' };
      const value = values.get(oid);
      return value === undefined ? { kind: 'absent' } : { kind: 'value', value };
    },
    walk(prefix) {
      return [...values.entries()]
        .filter(([oid]) => oid.startsWith(prefix) && !withheld.has(oid))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([oid, value]) => ({ oid, value }));
    },
    withhold(oid, mode) { withheld.set(oid, mode); },
    restore(oid) { withheld.delete(oid); }
  };
}
```

There is deliberately no code path that turns a withheld OID into `0`.

- [ ] **Step 4: Implement the SNMP agent and profiles**

`snmpAgent.ts` binds a UDP SNMP agent per simulated device on its own address/port, serving GET/GETNEXT from an `OidStore`, honouring `timeout` mode by not replying and `omit` by skipping the varbind.

Profiles export OID maps: `router` and `switch` (sysDescr/sysName/sysUpTime, `ifTable` state + octet counters, CPU/memory), `p2pRadio` (the same plus SNR, RSSI, and mod-rate under a vendor-style enterprise subtree). **Vendor-specific OIDs are placeholders until OQ-11 names the vendors** — profiles are data, so this is a data change later, not a code change.

- [ ] **Step 5: Write the failing control-API test (FR-51)**

Assert: `POST /control/devices` creates N devices; `PATCH /control/devices/:id/oids` changes a value; `POST .../interfaces/:idx/flap` produces the requested number of transitions within the window (**AC-C#14 support**); `POST .../oids/withhold` withholds and `DELETE` restores; `POST .../reachability` makes the device stop answering (NFR-22 support).

- [ ] **Step 6: Run to verify it fails, then implement `src/control/api.ts`**

Implement the routes in design doc §7.1, **bound to localhost by default**, with a startup log line stating plainly that this is a test-only control surface and must never run in production.

- [ ] **Step 7: CWMP element — ONLY if OQ-21 option (a) is approved**

If approved: add a minimal CWMP responder under `src/cwmp/` that presents as a TR-069-speaking, **SNMP-silent** device, and a test asserting LibreNMS marks such a device unreachable without error. **If OQ-21 is undecided or resolved as (b) or (c), SKIP this step entirely and do not build an ACS** (ADR 0004).

- [ ] **Step 8: End-to-end verification against LibreNMS**

```bash
npm run sim
curl -X POST http://localhost:9001/control/devices \
  -H 'content-type: application/json' \
  -d '{"profile":"p2pRadio","count":3}'
```
Add the simulated devices to LibreNMS and confirm discovery and polling. Then withhold RSSI and confirm the chain end to end: **withheld OID → LibreNMS no value → BFF returns `unavailable` → UI shows "Not available", not `0`.** This is FR-52 and FR-24 proven together, and it is the single most important manual check in this plan.

- [ ] **Step 9: Run all tests and commit**

```bash
npm test
git add packages/simulator
git commit -m "feat(simulator): add SNMP device harness with state induction and OID withholding"
```

---

## Task 13: Documentation and handover

**Files:**
- Create: `README.md` (replace the placeholder), `docs/runbook-local-dev.md`
- Modify: `.claude/team/team-config.md` and the developer/tester overlays — **propose edits to Jarvis; do not edit unilaterally** (they are team-protocol artefacts, not application code).

- [ ] **Step 1: Write the README**

Cover: architecture summary and a link to the design doc; prerequisites (Node v24.16.0, npm 11.13.0, Docker); `npm ci`; `npm run dev`; the exact URLs (`http://localhost:3000`, `http://localhost:4000`, `http://localhost:9001`); the `/health` and `/ready` contract with example responses; every script from Task 1; and a prominent security note that all credentials live in the BFF and no `/api/v0/` proxy is ever exposed.

- [ ] **Step 2: Write the local-dev runbook**

Bringing up the Docker stack; creating the LibreNMS API token; registering IdP clients (**pending OQ-2**); adding simulated devices; the withhold-and-verify procedure from Task 12 Step 8; and where the tester's artefacts land (`artifacts/<run>/logs/`, `artifacts/<run>/reports/`, `coverage/`).

- [ ] **Step 3: Report the verified commands to Jarvis for overlay updates**

Report that `npm ci`, `npm run build`, `npm test`, `npm run lint`, and `npm run typecheck` are now defined and passing, so team-config §7 and the developer/tester overlays can move from `verified: no` to `verified: yes`, and that the run/health-check open question is resolved. **Jarvis owns those files** — propose, do not edit.

- [ ] **Step 4: Final full verification**

```bash
npm ci && npm run lint && npm run typecheck && npm run build && npm test && npm run test:coverage
```
Expected: all pass, coverage ≥80% on new code.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/runbook-local-dev.md
git commit -m "docs: add README and local development runbook"
```

---

## Plan self-review

**1. Spec coverage.** Every Phase 0/1 requirement from the design doc §0 maps to a task: **FR-54 → Tasks 0.2/0.4a/0.4b (topology) ; FR-55 → Task 0.2 (pinned manifest) / 0.4b Step 8 (native's CM debt) ; FR-56 → Task 0.5 Steps 2–3 + Task 0.6 Step 7 ; FR-57 → Task 0.5 Steps 4–6 ; FR-58 → Task 0.6 (all twelve checks)**; FR-01..05/FR-07 → Tasks 0.4/0.5 and Task 6; FR-08/FR-46/FR-47 → Tasks 4, 10, 11; FR-10..19 → Task 7; FR-30..32 → Task 8; FR-33..35 → Task 8 (+ Task 10 revert); FR-37..39 → Task 9; FR-40..42 → Tasks 9, 10; FR-43 → Task 10; FR-50..53 → Task 12; NFR-09/15 → Tasks 3, 11; NFR-10..14/16 → Tasks 3, 7, 11; NFR-17..19 → Tasks 7, 8; NFR-20..22 → Tasks 3, 5, 9; NFR-28 → Task 11; NFR-29 → Task 3. Acceptance: AC-A#1..8 (Task 7 + Task 8's readonly test), AC-D#20..23 (Task 8), AC-E#25..28 (Tasks 9, 5), AC-F#31..34 (Task 11). AC-E#30 is verified by stopping both services while LibreNMS keeps polling — recorded in the Task 13 runbook.

**2. Placeholder scan.** No "TBD"/"handle errors appropriately" steps. Three steps are *conditional by design*, each with an explicit instruction to stop rather than guess: Task 12 Step 7 (OQ-21), Task 6 Step 2 (OQ-3/OQ-22), Task 7 Step 9 (mechanism confirmed in Task 6). Task 6's outputs may legitimately change Task 4's endpoint constants — that is the task's purpose, and Step 6 says to escalate rather than work around a gap.

**3. Type consistency.** `MetricValue`/`available`/`unavailable`/`isAvailable` (Task 2) are used unchanged in Tasks 4, 9, 10, 12. `SessionRecord`/`SessionStore` (Task 5) are used unchanged in Tasks 7, 8, 9. `DependencyHealth`/`HealthChecks` (Task 3) are implemented in Task 5. `AppError(code, message, status, field?)` keeps one signature throughout. `parsePageQuery`/`MAX_PER_PAGE` (Task 8) are reused in Task 9. `PageMeta` field names (`page`, `perPage`, `total`, `hasNext`) match between Task 2, the BFF routes, and the web tests.

**4. Ordering.** Each task is independently reviewable and leaves the repo green. Task 6 deliberately sits between the client and the auth work so assumptions are tested against reality before anything is built on them.

**5. Revision-2 additions (deployment package).**
- **Numbering:** Tasks `0.1`–`0.6` inserted; **Tasks 1–13 unchanged**. Decimal insertion was chosen over renumbering to `1..19` precisely to avoid invalidating ~2,800 lines of internal references and every `Task N` citation in the eight ADRs.
- **Gating:** `0.1 → 0.2 → 0.3 → (0.4a | 0.4b) → 0.5 → 0.6`, and **0.6 gates Task 6**. Tasks 1, 2, 3, 12 are parallel and unblocked by the server.
- **Branching, not guessing (revision 3):** Task 0.4's two branches are now selected by a **discovered fact** (Task 0.1 Step 5), not by a human answer. Compose is the approved method; native (0.4b) survives as the fallback for the single case where Docker turns out to be absent — and even then the agent reports rather than choosing, because installing a container runtime is itself a host change.
- **Execution boundary (revision 3 — inverted):** every server-touching step is `[DEVELOPER AGENT EXECUTES via SSH]` with expected output. The expected-output discipline was originally there because the runner was not the author; it is now load-bearing for a different reason — **expected-vs-actual is the evidence contract**, and a step with no stated expectation can only produce transcript, not evidence. Two things did not transfer: the **human-owned pre-flight snapshot** (an agent cannot snapshot its own host) and **any destructive or pre-existing-service-affecting action** (STOP + confirm).
- **Negative checks are first-class:** Task 0.5 Step 3 and Task 0.6 Steps 3, 8(3) and 9 are failure-mode tests. A deployment passing only positive checks has shown that it works, not that it is safe — and Task 0.6 Step 9 (header-injection bypass) is the one whose failure is Critical.
- **Placeholders:** none. Unknown host facts are **discovered** in Task 0.1 Step 3 and evaluated against four explicit STOP conditions in Step 4 — the plan stops rather than assuming any of them.
- **Revision-3 credential posture:** the SSH credential is referenced by path (gitignored repo-root `Credentials.md`) and never by value, anywhere in this plan or in any artifact it produces. Task 0.1 Step 6 installs a project SSH key specifically so the credential leaves the automation loop after one use. Secret *generation* happens on the server (Task 0.4a Step 3) and is verified by a masked `KEY=<set:NN>` listing, so no generated value ever crosses the wire into an evidence file.

## Execution handoff

Plan complete and saved to `docs/plans/nms-platform-foundation-plan.md`.

**G2 is APPROVED (2026-08-09) and revision 3 is a doc-only amendment to an approved plan** — it inverts the execution posture the human authorized, folds in the resolved decisions, and does not add or remove any task. The Developer executes it under the Global Constraints, including the six deployment guardrails.

If the Developer finds the plan wrong mid-implementation, it comes back to the Technical Architect for revision — the Developer does not silently redesign. That matters more now than in revision 2: under agent execution there is no human reading each command before it runs, so a plan step that turns out to be wrong on the real host is a **stop-and-escalate**, not an improvise.
