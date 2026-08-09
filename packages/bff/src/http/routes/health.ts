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
export function createHealthRouter(checks: HealthChecks, version: string): Router {
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
      names.map(async (name) => {
        try {
          return [name, await checks[name]()] as const;
        } catch {
          return [name, { status: 'error', error: 'UPSTREAM_UNAVAILABLE' } as DependencyHealth] as const;
        }
      })
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
