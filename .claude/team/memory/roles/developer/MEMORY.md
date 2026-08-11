# Role memory — developer

Curated index. One line per learning; detail in `learnings/`.

- 2026-08-10 — **A strict `script-src` CSP silently breaks Next.js hydration; build+tests stay green, only a live browser shows it.** Satisfy the "no unsafe-inline scripts" floor with a NONCE-based CSP in `src/middleware.ts` (`'nonce-…' 'strict-dynamic'`), never by adding `'unsafe-inline'`. Screenshot-verify every UI change. Detail: `learnings/2026-08-10-task10-web-and-oidc.md`.
- 2026-08-10 — **`exactOptionalPropertyTypes` (base tsconfig): declare React props that callers may pass `undefined` as `?: T | undefined`.** And switch on `metric.status` inline rather than the `isAvailable()` guard for `MetricValue` narrowing in web.
- 2026-08-10 — **supertest drops `Secure` cookies over its plaintext transport** — extract `Set-Cookie` and set the `Cookie` header explicitly on follow-up requests in login-then-protected integration tests.
- 2026-08-10 — **jose v6 `createRemoteJWKSet` `[customFetch]` option** routes JWKS via the shared secureFetch (POC self-signed CA); the idp `/ready` probe must really call discovery+JWKS (tested ok + both failure paths), never a stub.
- 2026-08-10 — **Disable Next's `AGENTS.md`/`CLAUDE.md` auto-generation with `agentRules: false`.** `web ↛ bff` guard stays green with web present (web imports `@nms/shared` only, reaches BFF via `/bff/*` HTTP rewrite); built client bundle carries zero token/secret literals.
