import type { DependencyHealth, HealthChecks } from './health.js';

/**
 * FAIL-CLOSED placeholder dependency probes (finding 13 / NFR-22).
 *
 * Tasks 4 (LibreNMS client) and 5 (Redis session store) replace these with real probes.
 *
 * They report `error`, NOT `ok`. The previous placeholders returned a hardcoded
 * `{ status: 'ok', latencyMs: 0 }`, which made the shipped binary advertise dependency-aware
 * readiness while being STRUCTURALLY INCAPABLE of reporting unhealthy — the same defect class
 * as the fail-open lint guard, and worse than having no check at all because the check is
 * trusted. `latencyMs` is omitted entirely rather than reported as 0: a measurement for a call
 * that never happened is fabricated data, which NFR-22 forbids.
 *
 * Consequence, and it is intentional: a BFF started with these placeholders answers
 * `/ready` with 503 and will not receive load-balancer traffic until real probes land.
 * That is the correct posture — an instance whose dependencies are unverified is not ready.
 */
const notImplemented = async (): Promise<DependencyHealth> => ({
  status: 'error',
  error: 'UPSTREAM_UNAVAILABLE'
});

export const placeholderHealthChecks: HealthChecks = {
  redis: notImplemented,
  librenms: notImplemented,
  idp: notImplemented,
  tsdb: notImplemented
};
