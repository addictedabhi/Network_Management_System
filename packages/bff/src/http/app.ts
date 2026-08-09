import express, { type Express, type Router } from 'express';
import { correlationId } from './middleware/correlationId.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { createHealthRouter, type HealthChecks } from './routes/health.js';
import type { Logger } from '../observability/logger.js';

export interface AppDeps {
  readonly logger: Logger;
  readonly healthChecks: HealthChecks;
  readonly version: string;
  readonly routers: readonly Router[];
}

/** Assembles the BFF express app. Dependencies are injected so tests drive real HTTP. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));
  app.use(createHealthRouter(deps.healthChecks, deps.version));
  for (const router of deps.routers) app.use('/api/v1', router);
  app.use(createErrorHandler(deps.logger));
  return app;
}
