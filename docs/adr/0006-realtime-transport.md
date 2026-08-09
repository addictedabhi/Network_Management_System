# 0006. Real-time transport — Server-Sent Events over WebSocket

- **Status:** Proposed (awaiting human approval at G2). Implementation is **Phase 2**; recorded now because it shapes the Phase 1 BFF structure.
- **Date:** 2026-08-09
- **Deciders:** Human (approver), Technical Architect (author)
- **Work item:** `nms-platform-foundation`
- **Relates to:** OQ-13, FR-36, FR-44, FR-45, FR-49, NFR-05, AC-D#24, AC-E#29

## Context

FR-45 requires push delivery rather than aggressive client polling, with a ≤10 s p95 appearance target (NFR-05). FR-49 requires automatic reconnection with backoff and a visible degraded state; FR-44 requires a freshness indicator. OQ-13 asks WebSocket or SSE and records a recommendation of SSE "unless bidirectional need emerges".

The traffic profile is the deciding fact. Every real-time payload in the requirement spec flows **server → browser**: new alarms (FR-36), interface state changes (FR-25), RF metric updates (FR-45). The one client→server action in Phase 1, acknowledgment (FR-33), is a deliberate, auditable, rate-limited, authorization-checked write (FR-34, NFR-17, NFR-18) — precisely the kind of operation that belongs on an ordinary HTTP POST with a response status the UI can act on (FR-35 requires surfacing failure and reverting optimistic state). Routing it through a socket frame would obscure the status code, complicate the audit path, and gain nothing.

## Considered options

### Option A — Server-Sent Events (SELECTED)
Plain HTTP `text/event-stream` on a BFF endpoint.

- **Pro:** it is HTTP. The session cookie, the auth middleware, the authorization check, the rate limiter, the correlation-ID logging, and the security headers from ADR 0002/0003 all apply unchanged. A WebSocket upgrade bypasses most Express/Next-style HTTP middleware chains, which means the auth check must be re-implemented at the upgrade handshake — a second authorization code path, and second code paths are where authorization bugs live.
- **Pro:** reconnection with `Last-Event-ID` and browser-native retry is part of the protocol, so FR-49's backoff-and-resume is largely a protocol feature rather than bespoke code.
- **Pro:** trivially proxy-friendly and observable — an SSE stream is readable with `curl`, which makes the tester's NFR-05 timing measurement (AC-D#24) straightforward.
- **Con:** one-way only. Accepted, per the traffic profile above.
- **Con:** HTTP/1.1 per-host connection limits (~6) if many tabs are open. Mitigated by a single multiplexed stream per tab carrying all topics, and by HTTP/2 in any realistic deployment behind TLS.

### Option B — WebSocket
- **Pro:** bidirectional; lower per-message overhead at high frequency.
- **Con:** requires a separate authorization path at the upgrade handshake (see above), separate scaling/sticky-session considerations, and more client state machinery to reproduce what SSE gives natively.
- **Con:** no requirement needs bidirectionality. Choosing it would be paying complexity for an unused capability.

### Option C — Client polling
- **Rejected by FR-45** explicitly.

## Decision

**Server-Sent Events**, on an authenticated BFF endpoint, with:

- **One stream per browser tab**, carrying typed events (`alarm.created`, `alarm.updated`, `interface.state`, `heartbeat`) discriminated by an event name, with payload types defined in `@nms/shared`.
- **A periodic heartbeat event** even when nothing changes. This is what makes FR-44's freshness indicator and FR-49's degraded state honest: the UI distinguishes "nothing is happening" from "the stream is dead" only if silence is abnormal. Without a heartbeat, a stalled stream looks identical to a quiet network — the exact failure mode FR-44 was written to prevent.
- **Authorization on connect and on every event fan-out**, from the server-side session (ADR 0003). A session that expires mid-stream terminates the stream rather than continuing to deliver data to an unauthenticated caller.
- **Event source:** the BFF derives events by observing LibreNMS (its API/eventlog per FR-02/FR-03) — never by having the browser poll LibreNMS, and never by modifying LibreNMS to push (FR-07). The precise derivation mechanism and its interval interact with **OQ-14 (polling interval)**, which is unresolved; the ≤10 s target of NFR-05 cannot be validated until OQ-14 is answered, because the platform cannot surface a state change faster than LibreNMS records it.

## Consequences

**Positive:** one authorization path for all browser traffic; reconnection is mostly protocol-provided; the stream is inspectable with standard tools, which materially helps verification.

**Negative:** long-lived connections hold BFF resources, so a connection cap and idle-timeout policy are required. Multi-instance BFF deployments need events fanned out across instances (Redis pub/sub, already a dependency) rather than held in per-process memory.

**Open dependency:** **OQ-14** shapes whether NFR-05's ≤10 s target is achievable at all. If the standard polling interval is LibreNMS's 5-minute default, then a state change cannot appear within 10 s of *occurring* — only within 10 s of LibreNMS *recording* it, which is how NFR-05 is worded and is the reading this design targets. The human should confirm that reading, because the two are very different operational promises and an operator watching a wall display will experience the former.
