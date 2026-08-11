# 2026-08-10 — Task 10 (Next.js AIRNMS UI) + BFF OIDC endpoints

## Context
Built the visible milestone: `packages/web` (Next 16 / React 19) + the BFF OIDC login/callback/logout
routes it needs, plus the protected `/api/v1/devices` + metrics API and the idp `/ready` flip.
Dev-fast mode, self-verified. All facts sourced from plan Task 7/10 + ADR 0003 + team memory.

## What I learned / what to do differently

- **A strict `script-src` CSP silently breaks Next.js hydration, and the failure is invisible to
  the build/tests.** `next build` passed, all unit tests passed, `tsc` passed — but the running
  page threw `InvariantError: Expected a request ID ... self.__next_r` because `script-src 'self'`
  blocked Next's inline bootstrap scripts. Only a live browser (Playwright) surfaced it. The
  security floor ("no `unsafe-inline` for scripts") is satisfiable WITHOUT weakening it: use a
  **nonce-based CSP in `src/middleware.ts`** (`script-src 'self' 'nonce-… ' 'strict-dynamic'`), and
  Next stamps the nonce onto its scripts automatically by reading the CSP off the request headers.
  Adding `'unsafe-inline'` would have been the wrong fix. Lesson: a security header that passes the
  build is not proven until a real browser renders the page — screenshot verification is not
  optional for a UI change.

- **`exactOptionalPropertyTypes: true` (inherited from tsconfig.base) means an optional prop must be
  typed `?: T | undefined` if a caller may pass `undefined` explicitly.** React components that
  forward `errorCode={errorCode}` where `errorCode: string | undefined` fail to typecheck against a
  `errorCode?: string` prop. Declare component props as `?: T | undefined` in this repo.

- **The `MetricValue` discriminated union does not narrow through the `isAvailable()` guard under
  exactOptional in the web tsconfig** — switch on `metric.status === 'available'` inline in the
  component instead; the negative branch then narrows to the `unavailable` member cleanly.

- **supertest will not resend a `Secure` cookie over its plaintext transport.** Integration tests
  that log in and then call a protected route must extract the `Set-Cookie` value and set the
  `Cookie` header EXPLICITLY on follow-up requests — the agent jar drops Secure cookies. This bit
  both the auth and devices integration tests (11 spurious 401s) until fixed.

- **jose v6 `createRemoteJWKSet` takes a `[customFetch]` symbol option** — use it to route JWKS
  retrieval through the shared `secureFetch` so the POC self-signed CA is trusted identically to
  discovery, without touching process-global TLS.

- **The idp `/ready` probe must genuinely call discovery + JWKS**, not a stub. Wired it to
  `oidc.discover()` + `oidc.getJwks()` and tested both the ok path AND both failure paths (discovery
  down, JWKS down) — the fail-open-stub class this codebase keeps fighting.

- **The `web ↛ bff` dep guard stayed green with `web` scaffolded** because `packages/web` imports
  `@nms/shared` types only and reaches the BFF over HTTP (`/bff/*` same-origin rewrite). Verified
  the built client bundle (`.next/static`) carries zero token/secret literals and no BFF origin.

- **Next auto-generates `AGENTS.md`/`CLAUDE.md` into the package on dev/build** — disable with
  `agentRules: false` in next.config so it does not pollute the repo.

## Facts recorded
- New pinned deps: `jose@6.2.8` (bff); `next@16.3.0`, `react@19.2.8`, `react-dom@19.2.8`, RTL/MSW/
  jsdom/vitest-react toolchain (web). All exact-pinned.
- OQ-7 FINAL levels used (engineer=10, readonly=5), NOT the plan's superseded proposal.
