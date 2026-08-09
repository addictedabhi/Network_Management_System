import { loadConfig } from './config/env.js';
import { createLogger } from './observability/logger.js';
import { createApp } from './http/app.js';

const config = loadConfig(process.env); // Throws before listening — fail fast (NFR-29).
const logger = createLogger(config);

// PLACEHOLDER health probes. Task 4 (LibreNMS client) and Task 5 (Redis session store)
// replace these with real probes. Leaving them hardcoded 'ok' past those tasks would make
// /ready lie about dependency health.
const unimplemented = async () => ({ status: 'ok' as const, latencyMs: 0 });

const app = createApp({
  logger,
  version: '0.1.0',
  routers: [],
  healthChecks: {
    redis: unimplemented,
    librenms: unimplemented,
    idp: unimplemented,
    tsdb: unimplemented
  }
});

app.listen(config.port, () => logger.info('bff listening', { port: config.port }));
