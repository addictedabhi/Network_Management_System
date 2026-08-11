import express, { type Express, type Router } from 'express';
import { correlationId } from './middleware/correlationId.js';
import { createSecurityHeaders } from './middleware/securityHeaders.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createHealthRouter, type HealthChecks } from './routes/health.js';
import type { Logger } from '../observability/logger.js';

export interface AppDeps {
  readonly logger: Logger;
  readonly healthChecks: HealthChecks;
  readonly version: string;
  /** Routers mounted under `/api/v1` (devices, alarms, session). */
  readonly routers: readonly Router[];
  /** Routers mounted at the ROOT (the OIDC `/auth/*` flow, which is not under `/api/v1`). */
  readonly rootRouters?: readonly Router[];
  /** Per-dependency readiness budget; defaults to DEFAULT_READY_TIMEOUT_MS. */
  readonly readyTimeoutMs?: number;
  /** Gates HSTS (finding 17). Defaults to false so tests and dev never emit a year-long pin. */
  readonly isProduction?: boolean;
}

/** Assembles the BFF express app. Dependencies are injected so tests drive real HTTP. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(createSecurityHeaders(deps.isProduction ?? false));
  app.use(express.json({ limit: '100kb' }));
  app.use(createHealthRouter(deps.healthChecks, deps.version, deps.readyTimeoutMs));
  // Root-mounted routers carry their own absolute paths (`/auth/*`, `/api/v1/session`).
  for (const router of deps.rootRouters ?? []) app.use(router);
  for (const router of deps.routers) app.use('/api/v1', router);
  // Order matters: 404 catches everything the routers did not match, then the error handler
  // formats anything thrown. Both must sit AFTER the routers to be reachable at all.
  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));
  return app;
}
