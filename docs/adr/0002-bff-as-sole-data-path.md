# 0002. The BFF is the sole browser-to-data path; the reference's proxy pattern is rejected

- **Status:** Proposed (awaiting human approval at G2)
- **Date:** 2026-08-09
- **Deciders:** Human (approver), Technical Architect (author)
- **Work item:** `nms-platform-foundation`
- **Relates to:** FR-08, FR-46, FR-47, NFR-09, NFR-11, NFR-16, CON-6, OQ-6 (resolved at G1), AC-F#31..32

## Context

The architecture reference (`LibreNMS_Custom_UI_Architecture.md`) proposes two data paths that the requirement spec prohibits. This ADR records the rejection formally, because the reference will outlive this work item and a future reader will otherwise reasonably transcribe it.

**Reference §4.3** configures Nginx to expose `/api/v0/` to the browser and inject a *global* LibreNMS API token at the proxy:

```nginx
location /api/v0/ {
    proxy_pass http://127.0.0.1:8000/api/v0/;
    proxy_set_header X-Auth-Token "YOUR_LIBRENMS_GLOBAL_API_TOKEN";
}
```

**Reference §6.1** further suggests the custom UI "read graph telemetry straight from InfluxDB".

Both were flagged at G1 (OQ-6) and resolved in favour of a server-side BFF (CON-6).

## The concrete failure of the reference pattern

The Nginx snippet is not merely "less ideal" — it is an authorization bypass with no mitigating control:

1. The `location /api/v0/` block carries **no `auth_request`, no token validation, and no role check.** Any caller who can reach the hostname gets the global token's privileges, authenticated or not.
2. The injected token is a **global LibreNMS API token**, which carries administrative read across every device and write access to alarm state. There is no per-user scoping in LibreNMS API tokens that would make this safe.
3. The bypass is trivially discoverable: the browser's own network tab shows the endpoint, and it responds to `curl` with no credential at all. This directly fails AC-F#32 ("request to any documented data endpoint without authentication → 401").
4. It makes FR-34 unenforceable. An `nms-readonly` user could acknowledge alarms by calling `/api/v0/` directly, since the proxy has no concept of the caller's role. Hiding the button in the UI would be the only control, which the requirement explicitly calls insufficient.

The browser-direct TSDB query has the same shape: a browser holding a TSDB credential is an unauthenticated read of every metric for every device, for anyone who opens developer tools.

## Decision

**All browser data access terminates at the BFF.** Specifically:

- The BFF is the only component holding the LibreNMS API token, the TSDB credential, and the IdP client secret. These are read from environment/secret store at startup, validated at startup (NFR-29), and never serialised into a response body, a log line (NFR-15), or a client bundle.
- **No `/api/v0/` path is exposed to the browser at any layer** — not by Nginx, not by a Next.js rewrite, not by a development proxy. The reverse proxy configuration for this platform contains no LibreNMS API location block at all.
- The browser never receives a TSDB credential and never connects to the TSDB. Chart data arrives as JSON from BFF endpoints that perform the TSDB query server-side (FR-46).
- Every BFF route declares its auth requirement explicitly, in code, at the route definition (NFR-16). There is no default-public route. The route table is the enumerable list AC-F#32 tests against.
- Authorization is evaluated server-side on every request from the caller's validated session, never from a client-supplied role claim (NFR-11, FR-34).

The native LibreNMS UI is still reachable by the browser — but as a *UI over its own authenticated session* (FR-40, established by OIDC SSO per ADR 0003), which is a different thing from an unauthenticated API proxy. Proxying the native UI at `/native/` (reference §4.3's other block) is acceptable because that path carries no injected credential; the user's own LibreNMS session authenticates it.

## Consequences

**Positive:**
- AC-F#31 (no credential in bundle or traffic) and AC-F#32 (401 without auth) become achievable and, given ADR 0001's dependency rule, structurally supported.
- FR-34's server-side denial has a place to live: the BFF's authorization layer.
- A single audit point exists for NFR-18 (audit-log state changes) and NFR-23 (correlation ID across the call chain).

**Negative / accepted costs:**
- Every piece of data the UI needs requires a deliberate BFF endpoint. There is no generic passthrough escape hatch — by design. This is real ongoing cost: the API coverage matrix in the design doc exists precisely because each requirement now needs a named endpoint.
- The BFF is on the latency path for chart reads. Mitigated by Redis caching (FR-48) and by keeping the BFF's TSDB query thin.
- The BFF is a new availability dependency for the UI. Accepted: NFR-20 only requires that *collection and alerting* survive, and those are entirely within LibreNMS, which the BFF does not touch.

**Explicitly forbidden implementations (a reviewer should reject these on sight):**
- Any Nginx/Next.js rewrite exposing LibreNMS `/api/v0/` to the browser.
- Any LibreNMS API token, TSDB DSN, or client secret appearing in `packages/web`, in a `NEXT_PUBLIC_*` variable, or in any file `packages/web` imports.
- Any BFF endpoint that forwards a caller-supplied role, level, or user identifier as the basis for an authorization decision.
