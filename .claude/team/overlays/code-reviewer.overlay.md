# Overlay — code-reviewer — Network Management System

Stack RESOLVED 2026-08-09 (team-config §7): TypeScript + React/Next.js custom UI + Node/TypeScript BFF. Former Java/Google-Java-Format facts are RETIRED.

## Code style
- Style references: match touched files; Prettier (default config) + ESLint strict; TypeScript strict mode — flag any `any` in production code.
- No linter config committed yet (greenfield) — flag the absence of ESLint/Prettier/tsconfig strict settings during review of the scaffolding feature.

## Review checklist — project-specific, always applied
- **Credential exposure (Critical floor):** any LibreNMS API token, TSDB credential, or IdP client secret reachable from client-side code, a `NEXT_PUBLIC_*` variable, a client component, or a browser-visible response (requirement doc FR-08, NFR-09).
- **Authorization enforced server-side:** every state-changing handler (notably alarm acknowledgment) checks the caller's role in the BFF, not only in the UI (FR-34, NFR-11). A hidden button with no server check is a High finding.
- **Token handling:** no tokens in localStorage/sessionStorage (FR-12); server-side validation of signature/iss/aud/exp (NFR-14); PKCE, never implicit flow (FR-11).
- **Input validation at the BFF boundary:** schema-validated (Zod) before business logic, strict/unknown-field rejection.
- **Unbounded queries:** every list endpoint paginated server-side (FR-38); no fetch-all-then-slice.
- **Failure honesty:** loading/error/empty states present (FR-43); no zeroed, fabricated, or cached-as-live data on backend failure (NFR-22); unavailable metrics rendered as "not available", never as 0 or healthy (FR-24).
- **Logging hygiene:** no tokens, secrets, SNMP community strings, `Authorization` values, or PII in logs (NFR-15).
- **LibreNMS core untouched:** any diff that modifies LibreNMS source is a blocking finding (FR-07).
- **Pinned versions:** unrequested dependency version changes in package.json/package-lock.json are defects (team-protocol §5).
- **Accessibility:** severity never conveyed by colour alone (NFR-30).

## Secret scanning
- Patterns/locations to scan: default family per team-protocol §6 (high-entropy strings, `Authorization: Bearer <token>`, `AKIA[0-9A-Z]{16}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `password\s*=\s*\S+`) PLUS project-specific: `api[_-]?key`, `X-Auth-Token`, LibreNMS API tokens, InfluxDB/Timescale connection strings and tokens, SNMP community strings (`community`), OIDC `client_secret`.
- Scan all diff hunks plus any `.env*`, config, docker-compose, and Nginx/gateway config files in the diff. Note the architecture reference contains a placeholder global token pattern that must NOT appear in real config.

## Scope
- Out of review scope: LibreNMS upstream source (platform dependency, not team-authored); generated types/lockfile churn reviewed only for unrequested version changes.
