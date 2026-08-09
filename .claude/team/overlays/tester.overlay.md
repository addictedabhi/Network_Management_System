# Overlay — tester — Network Management System

Stack RESOLVED 2026-08-09 (team-config §7): Node/TypeScript + React/Next.js custom UI + Node BFF; LibreNMS (PHP) as the engine. Former Java/Maven commands are retired.

OPEN QUESTION: local run command / dev-server deploy — not yet decided (resolve in G2 design/scaffold)
OPEN QUESTION: health-check URL + expected response — not yet decided
OPEN QUESTION: artifact collection methods — not yet decided; needed before G2.7
RESOLVED 2026-08-09: LibreNMS runs on a remote, human-provided server that this project installs (team-config §8, requirement doc FR-54..58). Verification runs against that server once FR-58 passes. You never execute the deployment yourself (team-protocol §5).

## Build / Test — exact commands
**VERIFIED 2026-08-09** against the real scaffold:
- Install: `npm ci` — **verified: yes**
- Build: `npm run build` — **verified: yes**
- Test: `npm test` — **verified: yes** (23 tests, 0 failures at scaffold stage)
- Workspace dep guard: `npm run lint:deps` — **verified: yes**. Treat this as a security control (NFR-09/AC-F#31): verify it with a real negative case (a `web` file importing `@nms/bff`) rather than trusting exit 0 — it had a fail-open defect.
- Type check: `npm run typecheck` — **verified: yes**, command is **`tsc -b`**
- Lint: `npm run lint` — **NO-OP today** (exits 0, nothing runs; ESLint not scaffolded). Do NOT record it as a passing lint gate.

## Run for testing
- Local run: **`npm ci` → `npm run dev`** (UI :3000, BFF :4000) → **`npm run sim`** (:9001). Verified 2026-08-09.
- Dev server address: UI **http://localhost:3000**, BFF **http://localhost:4000**, simulator **:9001**

## Test environment — simulated devices (per team-config §9)
- Verification polls **DUMMY POLLERS / simulated devices** exposing **SNMP** and **TR-069**, not production hardware.
- TR-069 is NOT a native LibreNMS protocol — its support model is an open design question (requirement doc OQ-21). Do not assume TR-069 data flows end-to-end until the approved design says how.
- Simulator setup/teardown commands: OPEN QUESTION — to be defined in the G2 design.

## Environment prerequisites — check BEFORE any test execution
- Required: a reachable LibreNMS instance with API access; the TSDB; Redis; a reachable OIDC IdP; the device simulators.
- If ANY prerequisite is unmet: STOP and report the exact error to Jarvis — never emulate, mock, or script around an outage to produce results (team-protocol §6).

## Health check
- URL: OPEN QUESTION
- Expected: OPEN QUESTION — per requirement doc NFR-21 the shape is `/health` (liveness, no dependency calls) and `/ready` (readiness, dependency-aware)

## UI scope
- UI location(s): the custom operations UI (Next.js) — to be created; native LibreNMS UI reachable via the "Open Admin Portal" action.
- Rendering states to always check on every data view: loading, error, empty (requirement doc FR-43), plus data-freshness/stale indication on real-time views (FR-44).
- Severity must never be conveyed by colour alone (NFR-30) — check for an icon/shape/text cue alongside colour on the P2P matrix and heatmap.

## Security checks — always in scope
- Inspect the frontend bundle and all browser-visible traffic for LibreNMS API tokens, TSDB credentials, or client secrets (AC-F#31). Any hit is a Critical finding, reported to Jarvis immediately per team-protocol §6.
- Negative authorization tests are mandatory, not optional: call state-changing endpoints (e.g. alarm acknowledgment) directly, bypassing the UI, as an unauthorized/read-only role and assert server-side denial (AC-A#8, FR-34).
- Assert security headers and cookie attributes (AC-F#33); assert no tokens/secrets/community strings in logs (AC-F#34).

## Feature flags
- Mechanism & where to toggle: NA (none yet)

## Adjacent-regression map
- Greenfield — build this map as features land. Expected high-risk couplings once built: the auth/session path (touches every view), the BFF cache layer (stale data across dashboards), and the real-time channel (silent staleness).

## Artifacts to collect
- Default evidence + capture method: OPEN QUESTION (log paths, screenshot tool, framework reports — decide before G2.7)
- Write every run to `.claude/team/artifacts/<work-item>/run-<n>/` in the PRIMARY checkout (never a worktree) with `results.md` ending in `status: complete`, per team-protocol §2-artifacts.

## Verify
1. Run `npm ci`, then the build and test commands above; confirm success and zero failures.
2. Start per "Run for testing"; confirm the health check passes (blocked until the OPEN QUESTIONs above are resolved).
3. Confirm environment prerequisites and simulator availability BEFORE executing cases; STOP and report if unmet.
4. Execute the approved G2.7 test-case list plus the Regression scope; record results per team-protocol §2-artifacts.
