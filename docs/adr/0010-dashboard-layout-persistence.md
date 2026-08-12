# 0010. Custom-UI dashboard layout persistence in Redis

- **Status:** **ACCEPTED** — human go-ahead on the Phase-3 customisable-dashboard design (`docs/design/nms-custdash-fr16.md`), routed through Jarvis.
- **Date:** 2026-08-12
- **Deciders:** Human (approved the store choice at the design checkpoint); Technical Architect (design author, recommendation); Developer (this record).
- **Work item:** `nms-platform-foundation` — Phase 3.
- **Relates to:** ADR 0002 (BFF as sole data path), ADR 0003 (authentication and opaque Redis session store), FR-16, FR-24, NFR-09, NFR-11.

## Context

The Phase-3 customisable dashboard lets each user add / remove / reorder / resize a personal set
of widgets over the real panels the custom UI already ships. That layout is a small per-user JSON
document (an ordered list of `{ widgetId, x, y, w, h, params? }`) — tens of bytes to a few KB per
user, single-writer (the owning user), read once per dashboard load. It must **persist per user
across sessions** and must be **scoped to the owning user with no cross-user (IDOR) surface**.

Three stores were weighed (design §1.2): (a) the Redis instance the BFF already owns for sessions;
(b) a new BFF-owned relational store; (c) LibreNMS's own `dashboards`/`users_widgets` schema.

## Decision

**Persist the layout in Redis under a per-user key, `dash:layout:v1:<sub>`, with NO TTL.**

- `<sub>` is the OIDC subject taken **exclusively from the server-side session record** (never from
  a request param/body/query). The key is not addressable by client input, so a user physically
  cannot read or write another user's layout — per-user scoping is structural, not a trusted-client
  check (NFR-11).
- The value is a Zod-validated JSON document (strict mode, bounded size, widget-id allowlist,
  bounded geometry). Writes are session-gated and CSRF-header-protected (same double-submit/header
  pattern as `POST /alarms/:id/ack`, ADR 0003).
- **No TTL.** This is a deliberate, separate keyspace from session keys (`sess:`), which DO expire.
  A saved layout must not evaporate on an idle timeout.
- **Independent of the native LibreNMS "NOC Triage" dashboard (dashboard_id=4). It does NOT read,
  write, or mirror the native `dashboards`/`users_widgets` store.** The two widget catalogs are
  disjoint (native widgets are LibreNMS-rendered; ours are React panels backed by the BFF), so a
  mirror would model nothing real and would couple the custom UI to the LibreNMS `user_id` space
  and its read-mostly relational store. The native dashboard stays reachable via the native UI
  (Open Admin Portal), untouched, and the deploy seed keeps recreating it on fresh installs.

Rejected alternatives:

- **(b) New relational store** — a new dependency + a versioned-migration mechanism the BFF does
  not have + a new operational surface (datastore process, backups, pool, credentials) on a shared
  POC host, for a single small JSON doc per user. Disproportionate at POC scale.
- **(c) LibreNMS `users_widgets`** — direct writes to a third-party read-mostly schema that does not
  model our React panels, plus a fragile OIDC-`sub`→LibreNMS-`user_id` join. Violates the
  "LibreNMS DB is read-mostly" posture and mis-models the data.

## Consequences

- **Redis becomes a persistence store, not only an ephemeral cache.** Durability is therefore a
  Redis **config** property that must be verified, not assumed: a layout key survives a restart only
  if the deployed Redis has **AOF (`appendonly yes`) or RDB snapshotting** enabled. This is a
  **build-time / deploy-time gate**, recorded here as the load-bearing dependency:
  - If AOF or RDB is on → layouts are durable across restarts. Good.
  - If both are off → the deploy must enable `appendonly yes` (a small host config change, flagged
    to the human) **or** the honest POC limitation "a saved layout may reset if Redis restarts" is
    documented. The code is built regardless; this gate only determines the deploy action / the
    honest caveat. (The actual deployed state is checked read-only in build step 2 and reported to
    the human; **this round makes no host change.**)
- **Contingency if we outgrow Redis-as-store** (multi-instance sharing, audit, large layouts): the
  relational-store option (b) is the documented fallback, which would then justify its own ADR for
  the migration mechanism.
- The security floor is preserved: no token in the browser, `web ↛ bff`, every read/write via the
  BFF, per-user scope from the session `sub` only, CSRF on writes, strict-nonce CSP unchanged.
