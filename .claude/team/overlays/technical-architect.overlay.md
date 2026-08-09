# Overlay — technical-architect — Network Management System

All facts here are project-specific by design. Repo is greenfield — several facts are to-be-established by the first design. Stack RESOLVED 2026-08-09 (team-config §7): Node/TypeScript + React/Next.js custom UI + Node BFF/gateway; LibreNMS (PHP/Laravel) as an unmodified platform dependency. The former Java/Maven facts are RETIRED — do not design against them.

## Module map
- Source layout: to be established by YOUR first design. Expected top-level shape per team-config §7: a Next.js custom operations UI and a Node/TypeScript BFF/gateway. Propose the module structure explicitly in the design doc — the developer overlay defers to your approved layout.
- LibreNMS is NOT team-authored source: it is deployed and configured, never modified (requirement doc FR-07, goal G-6). A design that requires patching LibreNMS core is a design failure — escalate to Jarvis instead.
- Key modules & owners: none yet (greenfield)

## Data model & migrations
- LibreNMS relational store: **MariaDB** — owned and schema-managed by LibreNMS itself. Never hand-alter LibreNMS schema; treat it as read-mostly via the LibreNMS API (direct DB reads require explicit justification in an ADR).
- Time-series store: OPEN QUESTION — InfluxDB vs TimescaleDB (requirement doc OQ-3). Human decision pending; document the choice as an ADR when made.
- Cache/queue: Redis (poller queue + BFF API cache).
- Versioned-migration mechanism for any team-owned store: not yet decided — choose and record as an ADR if the BFF gains its own persistence.

## API conventions
- Style/contract rules: REST, plural-noun resources, versioned paths (/api/v1/...), consistent success/error envelope, machine-readable error codes, server-side pagination on ALL list endpoints — per repo owner's API rules and requirement doc FR-38.
- The BFF is the ONLY path from browser to data (FR-47). It authenticates the user, authorises the action, and calls LibreNMS/TSDB server-side with credentials that never leave the server (FR-08, FR-46, NFR-09). The architecture reference's global-API-token Nginx pattern is PROHIBITED (requirement doc CON-6, OQ-6 — resolved in favour of the BFF).

## ADRs
- Location: docs/adr/
- Format: Nygard
- Current highest number: 0 (none yet)
- ADRs expected from the first design: stack/layout confirmation, TSDB choice, real-time transport (WebSocket vs SSE, OQ-13), TR-069 support model (OQ-21), P2P link pairing model (OQ-11), auth/session design.

## Security posture notes
- Auth mechanism: OIDC/OAuth2 via an external IdP (Keycloak or equivalent — availability is OQ-2). Custom UI uses Authorization Code + PKCE; tokens never in localStorage/sessionStorage; server-side token validation against IdP JWKS including iss/aud/exp (requirement doc FR-10..19, NFR-14).
- Known sensitive areas: the BFF's credential handling, the acknowledgment write path (authorization + audit), and SNMP community/credential storage.

## Design inputs requiring explicit treatment
- **TR-069:** verification will use simulated devices speaking SNMP **and TR-069** (team-config §9). TR-069/CWMP is not a native LibreNMS collection protocol — your design must state how (or whether) TR-069 data enters the system: separate ACS component, adapter feeding LibreNMS, or simulator-only for test. Do NOT silently expand scope; if this needs a scope decision, route it to Jarvis (requirement doc OQ-21).
- **Scaffold commands:** your plan MUST fix the package.json script names (`build`, `test`, `lint`, `typecheck`) so the developer/tester overlays can be marked verified, and MUST resolve the local-run and health-check open questions (`/health` liveness, `/ready` readiness per NFR-21).
- **API coverage matrix:** requirement doc ASM-1 assumes the LibreNMS REST API exposes everything the custom UI needs. Verify this explicitly per functional requirement and record gaps — gaps are filled by TSDB reads, never by LibreNMS core changes.

## Verify (for plan verification steps)
- Install: `npm ci` — verified: no (no package.json yet; node v24.16.0 and npm 11.13.0 verified present)
- Build: `npm run build` — verified: no (script to be defined by your scaffold)
- Test: `npm test` — verified: no (script to be defined by your scaffold)
