import { Router } from 'express';
import type { ErrorCode } from '@nms/shared';

export interface DependencyHealth {
  readonly status: 'ok' | 'error';
  readonly latencyMs?: number;
  readonly error?: ErrorCode;
}

export interface HealthChecks {
  redis(): Promise<DependencyHealth>;
  librenms(): Promise<DependencyHealth>;
  idp(): Promise<DependencyHealth>;
  tsdb(): Promise<DependencyHealth>;
}

/**
 * `/health` and `/ready` are the ONLY unauthenticated endpoints in the platform and they
 * return no operational data (NFR-16 documented exception, design §3.3).
 *
 * The `checks` object carries a status, a latency, and a machine-readable code only —
 * never a hostname, DSN, credential, or upstream error body (NFR-09/NFR-15).
 */
/** Default per-dependency readiness budget. Short enough that a probe always answers. */
export const DEFAULT_READY_TIMEOUT_MS = 2000;

/**
 * Races a dependency check against a timeout (finding 9).
 *
 * A `try/catch` around an await handles REJECTION but not HANGING: a black-holed TCP connect
 * can stall for minutes, and a readiness probe that never answers leaves the instance neither
 * ready nor drained, breaking NFR-21 drain semantics. A timeout is therefore treated as
 * NOT-READY — fail closed, never "assume ok".
 */
async function checkWithTimeout(
  run: () => Promise<DependencyHealth>,
  timeoutMs: number
): Promise<DependencyHealth> {
  let timer: NodeJS.Timeout | undefined;
  const unavailable: DependencyHealth = { status: 'error', error: 'UPSTREAM_UNAVAILABLE' };
  try {
    return await Promise.race([
      // The upstream error body is deliberately discarded: it can carry a hostname, DSN or
      // credential, and /ready is unauthenticated (NFR-09/NFR-15).
      Promise.resolve()
        .then(run)
        .catch(() => unavailable),
      new Promise<DependencyHealth>((resolve) => {
        timer = setTimeout(() => resolve(unavailable), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createHealthRouter(
  checks: HealthChecks,
  version: string,
  readyTimeoutMs: number = DEFAULT_READY_TIMEOUT_MS
): Router {
  const router = Router();
  const startedAt = Date.now();

  // Liveness: NO dependency calls (NFR-21).
  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'bff',
      version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    });
  });

  // Readiness: dependency-aware; 503 when any dependency is unhealthy (AC-E#28).
  // A readiness failure drains traffic; it must never restart the process, since a restart
  // cannot fix an upstream LibreNMS outage and would only add flapping.
  router.get('/ready', async (_req, res) => {
    const names = ['redis', 'librenms', 'idp', 'tsdb'] as const;
    const results = await Promise.all(
      names.map(
        async (name) =>
          [name, await checkWithTimeout(() => checks[name](), readyTimeoutMs)] as const
      )
    );
    const built = Object.fromEntries(results);
    const ready = results.every(([, r]) => r.status === 'ok');
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'bff',
      checks: built
    });
  });

  return router;
}
