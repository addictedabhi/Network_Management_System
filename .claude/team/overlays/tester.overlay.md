# Overlay — tester — Network Management System

Stack RESOLVED 2026-08-09 (team-config §7): Node/TypeScript + React/Next.js custom UI + Node BFF; LibreNMS (PHP) as the engine. Former Java/Maven commands are retired.

RESOLVED 2026-08-09 — health-check contract is fixed by the design and verified in code:
- `GET /health` — liveness, makes NO dependency calls. `GET /ready` — readiness, dependency-aware, returns **503** when a dependency is down. Exact JSON shapes are in `docs/design/nms-platform-foundation.md` §3.3 — read them there and assert byte-exactness; do not paraphrase.
- These are the ONLY unauthenticated endpoints (the single documented NFR-16 exception).
RESOLVED 2026-08-09 — local run: `npm run dev` works (aliases `dev:bff`; BFF on :4000). It needs a valid env — fail-fast refusal on invalid config is CORRECT (NFR-29), not a defect. No UI exists yet (Task 10); `npm run sim` awaits Task 12.

RESOLVED 2026-08-09: LibreNMS runs on a remote, human-provided server that this project installs (team-config §8, requirement doc FR-54..58). Verification runs against that server once FR-58 passes. You never execute the deployment yourself (team-protocol §5).

## Build / Test — exact commands
**VERIFIED 2026-08-09** against the real scaffold:
- Install: `npm ci` — **verified: yes**
- Build: `npm run build` — **verified: yes**
- Test: `npm test` — **verified: yes** — **276 tests, 0 failures, 0 skipped, 0 todo** (177 vitest = **168 bff + 9 shared**; plus **99 `node:test`**) at `24f0d19`. ONE command suffices. Number history: 222 (wrong) → 231 → 244 → 258 → 273 → 276 — **always report the number you actually observe**, with the breakdown.
- Workspace dep guard: `npm run lint:deps` — verified. Treat as a security control (NFR-09/AC-F#31): verify with real negative cases (a violation outside `src/`, a dynamic `import()`) AND an import-like string that must not false-positive.
- Workspace dep guard: `npm run lint:deps` — **verified: yes**. Treat this as a security control (NFR-09/AC-F#31): verify it with a real negative case (a `web` file importing `@nms/bff`) rather than trusting exit 0 — it had a fail-open defect.
- Type check: `npm run typecheck` — **verified: yes**, command is **`tsc -b`**
- Lint: `npm run lint` — runs workspace `lint` scripts (`--if-present`) **and** `lint:deps`, so `lint:deps` genuinely runs. **ESLint is still NOT scaffolded**, so no JS/TS style/correctness linting happens — treat it as a dependency-rule gate only, never a full lint gate.

## Run for testing
- Local run: `npm run dev` works (aliases `dev:bff`; BFF :4000). Needs a valid env — fail-fast refusal on invalid config is CORRECT (NFR-29). `npm run sim` awaits Task 12; no UI until Task 10. Ports: UI :3000 (Task 10), BFF :4000, simulator :9001 (Task 12).
- Dev server address: UI **http://localhost:3000**, BFF **http://localhost:4000**, simulator **:9001**

## Test environment — simulated devices (per team-config §9)
- Verification polls **DUMMY POLLERS / simulated devices** exposing **SNMP** and **TR-069**, not production hardware.
- TR-069 is NOT a native LibreNMS protocol — its support model is an open design question (requirement doc OQ-21). Do not assume TR-069 data flows end-to-end until the approved design says how.
- Simulator setup/teardown: **not yet built** — the harness is plan Task 12 (FR-50..53) and has not started. No simulator cases are executable yet; do not invent them.

## Environment prerequisites — check BEFORE any test execution
- Required: a reachable LibreNMS instance with API access; the TSDB; Redis; a reachable OIDC IdP; the device simulators.
- If ANY prerequisite is unmet: STOP and report the exact error to Jarvis — never emulate, mock, or script around an outage to produce results (team-protocol §6).

## Health check — RESOLVED
- **`GET http://localhost:4000/health`** — liveness; no dependency calls; must succeed even when LibreNMS/TSDB/Redis are down.
- **`GET http://localhost:4000/ready`** — readiness; dependency-aware; **503** when a dependency is unavailable. Note the current placeholder probes **fail closed by design** (review finding 13), so `/ready` reporting not-ready with no real dependencies wired is CORRECT behaviour, not a defect.
- Assert response bodies against `docs/design/nms-platform-foundation.md` §3.3 byte-exactly.

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

## Artifacts to collect — RESOLVED 2026-08-09 (human adopted the default)
Write every run to **`.claude/team/artifacts/<work-item>/run-<n>/`** (n = findings-loop iteration) in the **PRIMARY checkout**, never inside a verification worktree (worktrees are removed).
- **Test-framework reports:** vitest output AND `node:test` output (the guard suite). Capture both; `npm test` runs both.
- **BFF logs:** structured JSON log output from the service under test.
- **Terminal command captures:** the exact command invoked plus its output, for every check you run.
- **Screenshots: Playwright MCP** — applies once a UI exists. **No UI exists yet** (Next.js `web` workspace is Task 10), so UI/browser cases are NOT yet executable; do not invent them.
- `results.md` carries the per-case pass/fail table with evidence pointers and MUST end with `status: complete` as its final line (protocol §7 — a run dir without it is treated as incomplete and redone, and its `run-<n>` number is not reused).
- **Redact secrets in every capture.** A gitignored repo-root `Credentials.md` holds real SSH credentials for `10.121.77.206`; never let a credential reach an artifact.
- Write every run to `.claude/team/artifacts/<work-item>/run-<n>/` in the PRIMARY checkout (never a worktree) with `results.md` ending in `status: complete`, per team-protocol §2-artifacts.

## Verify
1. Run `npm ci`, then the build and test commands above; confirm success and zero failures.
2. Start the BFF with `npm run dev:bff`; exercise `/health` and `/ready` per the Health check section. Remember `/ready` fail-closed is expected at this stage.
3. Confirm environment prerequisites and simulator availability BEFORE executing cases; STOP and report if unmet.
4. Execute the approved G2.7 test-case list plus the Regression scope; record results per team-protocol §2-artifacts.
