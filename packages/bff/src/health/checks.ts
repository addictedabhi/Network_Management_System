/**
 * Real dependency probes for `/ready` (NFR-21, AC-E#28), replacing the fail-closed placeholders
 * as each dependency's task lands.
 *
 * WIRED:
 *   - `librenms` (Task 4) — `LibreNmsClient.checkHealth()` hits `/api/v0/system` WITH the API
 *     token, so `ok` means reachable AND authenticated.
 *   - `tsdb`     (Task 4) — `MetricsReader.checkHealth()` hits InfluxDB v2 `/health`.
 *   - `redis`    (Task 5) — `RedisLike.ping()`; a `PONG` means the session store is reachable.
 *     A rejecting or hanging PING yields `error` → `/ready` answers 503 (ADR 0003 consequence:
 *     a Redis outage means the BFF cannot serve authenticated traffic, so it must NOT be ready).
 *
 * NOW REAL (Task 10 / this change):
 *   - `idp`   — the OIDC client's `discover()` fetches the realm discovery document AND `getJwks()`
 *     resolves the realm JWKS. `ok` means the `nms` realm is reachable AND its signing keys are
 *     fetchable — the two things the callback's token validation actually depends on. It is NOT a
 *     stub: a stubbed/hardcoded `ok` is the exact fail-open class this codebase has fought, so the
 *     probe genuinely performs the network calls and reports `error` on any failure.
 *
 * Each probe's own timeout lives in the client/adapter; `createHealthRouter` additionally races
 * every probe against the per-check readiness budget, so a hung dependency is NOT-READY rather
 * than a stalled probe (health.ts finding 9). The upstream error is deliberately discarded here
 * so no hostname/DSN/credential leaks into the unauthenticated `/ready` body (NFR-09/NFR-15).
 */
import type { HealthChecks, DependencyHealth } from '../http/routes/health.js';
import type { LibreNmsClient } from '../librenms/client.js';
import type { MetricsReader } from '../metrics/metricsReader.js';
import type { RedisLike } from '../auth/sessionStore.js';
import type { OidcClient } from '../auth/oidcClient.js';

export interface HealthCheckDeps {
  readonly redis: Pick<RedisLike, 'ping'>;
  readonly librenms: Pick<LibreNmsClient, 'checkHealth'>;
  readonly metrics: Pick<MetricsReader, 'checkHealth'>;
  /** The OIDC client, whose discovery + JWKS fetch back the REAL idp probe. */
  readonly oidc: Pick<OidcClient, 'discover' | 'getJwks'>;
}

/** Times a probe; any throw becomes a body-free `error` so nothing sensitive can leak. */
async function timed(fn: () => Promise<unknown>): Promise<DependencyHealth> {
  const startedAt = Date.now();
  try {
    await fn();
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch {
    return { status: 'error', error: 'UPSTREAM_UNAVAILABLE' };
  }
}

export function createHealthChecks(deps: HealthCheckDeps): HealthChecks {
  return {
    // Real Redis PING (Task 5). ok only when the session store answers.
    redis: () => timed(() => deps.redis.ping()),
    // REAL idp probe: discovery document reachable AND realm JWKS fetchable. Never fabricated.
    idp: () =>
      timed(async () => {
        await deps.oidc.discover();
        await deps.oidc.getJwks();
      }),
    librenms: () => deps.librenms.checkHealth(),
    tsdb: () => deps.metrics.checkHealth()
  };
}
