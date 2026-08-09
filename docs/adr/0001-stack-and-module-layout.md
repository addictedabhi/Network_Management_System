# 0001. Stack confirmation and module layout (npm workspaces monorepo)

- **Status:** Proposed (awaiting human approval at G2)
- **Date:** 2026-08-09
- **Deciders:** Human (approver), Technical Architect (author)
- **Work item:** `nms-platform-foundation`
- **Relates to:** team-config §7, CON-3, FR-07, requirement doc §12 Phase 0

## Context

The repository is greenfield: it contains only `README.md`, the architecture reference, and the G1-approved requirement spec. No `package.json` exists. The stack was resolved at G1 (OQ-1, option a): a React/Next.js custom operations UI and a Node/TypeScript BFF, with LibreNMS (PHP/Laravel) as an unmodified platform dependency.

Two facts constrain the layout:

1. **The UI and the BFF share types.** Every alarm, device, and interface shape crosses the boundary between them. If the two live in unrelated projects, those shapes get duplicated and drift, and the drift shows up as a runtime mismatch rather than a compile error.
2. **The BFF is a security boundary, not a convenience layer** (FR-08, FR-46, FR-47, NFR-09). It holds the LibreNMS service token and TSDB credentials. Anything that can be imported into browser-bound code is, in effect, publishable to the browser. Next.js makes this risk concrete: a stray import of a server module into a client component ships that module's constants into the client bundle.

The team-config records the module layout as "to be established by YOUR first design"; the developer overlay defers to whatever this ADR fixes.

## Decision drivers

- Shared types must have exactly one definition (FR-32/FR-37 shapes are consumed by both sides).
- Credential-bearing code must be structurally incapable of reaching the browser bundle (NFR-09, AC-F#31).
- `npm ci` must work from the repo root and one command must run the whole test suite (team-config §7 needs the script names fixed).
- LibreNMS is never vendored into this repo (FR-07): it is an external service reached over HTTP.
- The simulation harness (FR-50..53) is a deliverable, not a test fixture, and needs its own build and its own lifecycle.

## Considered options

### Option A — Single Next.js application, BFF as Next.js API routes
One `package.json`; the BFF lives in `app/api/*` route handlers.

- **Pro:** the least machinery; one build; one dev server; fastest Phase 0.
- **Con:** the security boundary becomes a convention rather than a structure. Server-only code sits in the same compilation unit as client code, and the only thing preventing a credential-bearing module from being bundled into the browser is developer discipline plus Next.js's server/client heuristics. AC-F#31 (no credential anywhere in the bundle) would be verified by inspection every time rather than guaranteed by construction.
- **Con:** NFR-20 requires the collection engine to survive UI unavailability, and NFR-21 requires per-service `/health` and `/ready`. Fusing UI and BFF into one deployable makes "the UI is down but the API tier is up" unexpressible.

### Option B — npm workspaces monorepo: separate `web`, `bff`, `shared`, `simulator` packages (SELECTED)
One repo, one lockfile, four workspaces, two deployable services.

- **Pro:** the BFF is a separate compilation unit with its own `package.json`. Credential-bearing code cannot be imported into the browser bundle because `web` does not depend on `bff` at all — they communicate over HTTP only. The security property is structural.
- **Pro:** shared types live in `shared`, which is dependency-free and contains no runtime secrets, so both sides can safely depend on it.
- **Pro:** two deployables, each with its own `/health` and `/ready` (NFR-21), and UI failure is independent of BFF failure (NFR-20).
- **Con:** more setup than Option A, and cross-workspace type changes require building `shared` first.

### Option C — Separate repositories per service
- **Pro:** hardest isolation; independent release cadence.
- **Con:** shared types must be published as a versioned package or duplicated; a single logical change spans multiple PRs and cannot be reviewed atomically. For a team of this size at Phase 0, the coordination cost buys nothing that Option B does not already give.

## Decision

**Option B.** A single repository using npm workspaces with four packages:

```
package.json                  # workspace root; delegating scripts only, no app code
package-lock.json             # single lockfile — the only place versions are pinned
tsconfig.base.json            # strict TS settings inherited by every workspace
packages/
  shared/                     # @nms/shared  — types, Zod schemas, error codes. No I/O, no secrets, no deps on other workspaces.
  bff/                        # @nms/bff     — Node/TypeScript HTTP service. The ONLY holder of LibreNMS tokens and TSDB credentials.
  web/                        # @nms/web     — Next.js custom operations UI. Depends on @nms/shared ONLY. Never on @nms/bff.
  simulator/                  # @nms/simulator — SNMP device simulation harness (FR-50..53). Depends on @nms/shared.
docs/{requirements,design,plans,adr}/
```

**The load-bearing rule:** `packages/web` MUST NOT declare `@nms/bff` as a dependency, and `packages/shared` MUST NOT import from `bff`, `web`, or `simulator`. The dependency graph is strictly `web → shared`, `bff → shared`, `simulator → shared`. This is what makes "no credential in the browser bundle" a structural property rather than a review checklist item, and it is enforced mechanically by a `lint:deps` check (see the design doc's Module layout section) so that a violating import fails CI rather than being caught by a reviewer's attention.

## Consequences

**Positive:**
- Credential exposure via bundling is structurally prevented, satisfying NFR-09/AC-F#31 by construction.
- Both deployables satisfy NFR-21 independently; NFR-20's independence claim is testable (AC-E#30).
- One `npm ci` at the root installs everything; one `npm test` runs everything.
- The simulator ships as a first-class package, so FR-50..53 are buildable and testable rather than ad-hoc scripts.

**Negative / accepted costs:**
- Contributors must understand workspaces. Mitigated by the plan's Task 1 fixing the exact commands.
- `@nms/shared` must be built before dependent typechecks in CI. Handled by ordering in the root scripts.
- Two services to run locally in development. Mitigated by a single `npm run dev` that starts both concurrently.

**Neutral:**
- LibreNMS, MariaDB, Redis, and the TSDB remain external services, configured but never vendored (FR-07). Their local orchestration is a Phase 0 deliverable and depends on OQ-22.
