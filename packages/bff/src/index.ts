import { loadConfig } from './config/env.js';
import { createLogger } from './observability/logger.js';
import { createApp } from './http/app.js';
import { placeholderHealthChecks } from './http/routes/placeholderChecks.js';
import { BFF_VERSION } from './version.js';

const config = loadConfig(process.env); // Throws before listening — fail fast (NFR-29).
const logger = createLogger(config);

/**
 * Dependency probes are FAIL-CLOSED placeholders until Task 4 (LibreNMS client) and Task 5
 * (Redis session store) supply real ones — see `placeholderChecks.ts`. `/ready` therefore
 * answers 503 until then, deliberately: an instance whose dependencies are unverified must not
 * receive traffic (finding 13 / NFR-22).
 */
const app = createApp({
  logger,
  version: BFF_VERSION,
  routers: [],
  healthChecks: placeholderHealthChecks,
  isProduction: config.nodeEnv === 'production'
});

app.listen(config.port, () =>
  logger.warn('bff listening with placeholder dependency probes; /ready will report not_ready', {
    port: config.port,
    version: BFF_VERSION
  })
);
