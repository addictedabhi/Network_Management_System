# Overlay — developer — Network Management System

Note: repo is greenfield (README + architecture reference + requirement doc only). Commands below apply once the first feature scaffolds the Node/TypeScript project at repo root. Stack RESOLVED 2026-08-09 (team-config §7): Node/TypeScript + React/Next.js. The former Java/Maven facts are retired — do not use them.

## Repo & layout
- Repo root: (this repository).
- Layout is to be established by the first feature's approved plan (Technical Architect owns it). Expected shape per team-config §7: a Next.js custom UI and a Node/TypeScript BFF/gateway. Do NOT invent a layout — follow the approved plan.
- LibreNMS (PHP/Laravel) is a platform dependency, NOT team-authored source. Never edit LibreNMS core (requirement doc FR-07).

## Toolchain
- Required toolchain: Node.js 22+ (machine has **v24.16.0** — verified), npm (machine has **11.13.0** — verified)
## Deployment target & credential handling (READ BEFORE ANY Task 0.x WORK)
- **Target host:** `10.121.77.206`. Deployment IS authorized for agents (human decision 2026-08-09) — this is a documented exception to team-protocol §5 for THIS host only. See team-config §8 for the full guardrails.
- **CRITICAL — credential hygiene.** SSH credentials are in the **gitignored repo-root `Credentials.md`**. Read it ONLY to establish the connection. NEVER copy its contents into any file you write, any config, any log, any artifact, any commit, any handoff, or any command you echo. Reference the **path only**. Never `cat` it into terminal output that gets captured as evidence. A leak is a Critical finding you must self-report to Jarvis immediately.
- **Stop conditions — do NOT proceed, report to Jarvis instead:** any destructive or irreversible host action (disk wipe, OS change, removing or reconfiguring a pre-existing service); discovering the host runs unrelated production services; discovered specs at or below the ADR 0008 floor of 4 vCPU / 8 GB when about to install Keycloak.
- **Facts before actions.** Server OS, Docker availability, CPU/RAM/disk, and sudo are UNKNOWN. Task 0.1 SSH fact-gathering comes first and its findings choose the install path.
- **Evidence.** Record expected-vs-actual output per Task 0.x step under `.claude/team/artifacts/nms-platform-foundation/`, with secrets redacted.
- SSH: Windows 11 OpenSSH client available; bootstrap with password auth, then install a project SSH key for non-interactive automation.

## Runtime facts
- Install method: Docker Compose. TSDB: **TimescaleDB**. IdP: **Keycloak, co-hosted** on the same server.
- PHP is NOT installed on this machine. LibreNMS runs on a **remote, human-provided server** which this project also installs (team-config §8; requirement doc FR-54..58); `LIBRENMS_BASE_URL` points there. If a task requires a live LibreNMS and none is reachable, STOP and report to Jarvis — never mock around an unreachable environment. You never execute a deployment against a shared/protected server (team-protocol §5).
- Dependency policy: versions pinned by package.json + package-lock.json; any version change requires explicit plan approval.

## Verify — exact commands
Run from repo root. **VERIFIED 2026-08-09** against the real scaffold (branch `feature/nms-1-nms-platform-foundation`):
- Install (deterministic): `npm ci` — **verified: yes**
- Full build: `npm run build` — **verified: yes**
- Full test run (never skip tests for verification): `npm test` — **verified: yes** (23 tests, 0 failures)
- Workspace dep guard: `npm run lint:deps` — **verified: yes**. This is the structural NFR-09/AC-F#31 control; it previously failed OPEN on a missing/malformed manifest. Any edit to `scripts/check-workspace-deps.mjs` is security-relevant — re-probe it with a real negative case, don't trust exit 0.
- Type check: `npm run typecheck` — **verified: yes**, command is **`tsc -b`** (NOT `--noEmit`; TS6310 with composite refs)
- Lint: `npm run lint` — **exits 0 but is a NO-OP today** (no workspace defines `lint`; ESLint not scaffolded). Do NOT cite it as a passing lint gate.
- Local run: `npm run dev` (UI :3000, BFF :4000); `npm run sim` (:9001)

## Style & conventions
- TypeScript strict mode; no `any` in production code.
- Prettier + ESLint (strict) enforced by tooling; single quotes, semicolons.
- React: functional components with hooks only; one component per file; Props interfaces explicit.
- Input-validation boundary: the BFF/gateway request handler layer — validate ALL inbound data with schema validation (Zod) before it reaches business logic.
- Security-critical, non-negotiable per the requirement doc: no LibreNMS API token, TSDB credential, or IdP client secret may ever reach the browser bundle or client-visible traffic (FR-08, NFR-09). Authorization is enforced server-side on every request (NFR-11) — hiding a UI control is never the control.
- Every data-loading view implements explicit loading, error, and empty states (FR-43); never render zeroed or fabricated data on backend failure (NFR-22).

## Branching & commits
- Feature branch naming: feature/<ticket-id>-short-description
- Protected branch (never commit directly): main
- Commit policy: manual — never commit or push; hand Jarvis a commit-ready package after G4.
