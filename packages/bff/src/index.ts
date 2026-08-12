import { loadConfig } from './config/env.js';
import { createLogger } from './observability/logger.js';
import { createApp } from './http/app.js';
import { createSecureFetch } from './http/secureFetch.js';
import { createLibreNmsClient } from './librenms/client.js';
import { createInfluxMetricsReader } from './metrics/influxMetricsReader.js';
import { createRedis } from './cache/redis.js';
import { createHealthChecks } from './health/checks.js';
import { createSessionStore } from './auth/sessionStore.js';
import { createPreSessionStore } from './auth/preSessionStore.js';
import { createOidcClient } from './auth/oidcClient.js';
import { createRequireSession } from './http/middleware/auth.js';
import { createAuthRouter, createRefreshIfNeeded } from './http/routes/auth.js';
import { createDeviceRouter } from './http/routes/devices.js';
import { createAlarmRouter } from './http/routes/alarms.js';
import { createDashboardLayoutRouter } from './http/routes/dashboardLayout.js';
import { createLayoutStore } from './dashboard/layoutStore.js';
import { BFF_VERSION } from './version.js';

import { readFileSync } from 'node:fs';

const config = loadConfig(process.env); // Throws before listening — fail fast (NFR-29).
const logger = createLogger(config);

/**
 * Resolve the POC CA to trust for the self-signed gateway. A PEM cannot survive an EnvironmentFile
 * intact, so the deployed BFF bind-mounts the cert and gives its PATH; we read it here. The inline
 * PEM string (POC_TLS_CA_CERT) remains supported for local/dev use. File wins when both are set.
 * A missing/unreadable file is FATAL (fail fast) — a silently-absent CA would make every HTTPS call
 * to the gateway fail later with an opaque handshake error.
 */
const caCert: string | undefined = config.pocTlsCaCertFile
  ? readFileSync(config.pocTlsCaCertFile, 'utf8')
  : config.pocTlsCaCert;

/**
 * A single fetch implementation shared by the token-bearing clients. The POC self-signed CA
 * (if configured) is trusted by THIS client only — TLS verification stays on, and no
 * process-global TLS state is touched (team-config §8 guardrail 6). See `secureFetch.ts`.
 */
const secureFetch = createSecureFetch({ caCert });

const librenms = createLibreNmsClient(config.librenms, logger, secureFetch);
const metrics = createInfluxMetricsReader(config.tsdb, logger, secureFetch);
const redis = createRedis(config.redisUrl);
const oidc = createOidcClient(config.oidc, secureFetch);

const sessions = createSessionStore(redis, {
  idleTimeoutSeconds: config.session.idleTimeoutSeconds,
  absoluteLifetimeSeconds: config.session.absoluteLifetimeSeconds
});
const preSessions = createPreSessionStore(redis);

const refreshIfNeeded = createRefreshIfNeeded({ oidc, sessions, logger });
const requireSession = createRequireSession({
  sessions,
  cookieName: config.session.cookieName,
  refreshIfNeeded
});

/**
 * FR-16 — CLOSED, satisfied by LibreNMS's own SSO auto-provisioning + per-login role sync.
 * Verified against real LibreNMS 25.7.0 source (design `nms-custdash-fr16.md` §2): the `sso`
 * mechanism `firstOrNew`+`save`s the native user on first login (`create_users`) AND re-syncs the
 * level from the group→level map on EVERY login (`SSOAuthorizer::getRoles` → `syncRoles` in
 * `LegacyUserProvider::retrieveByCredentials`). There is NO supported user-management REST API in
 * `routes/api.php`, so a BFF-side write would have no endpoint and could only drift or conflict
 * with `syncRoles`. We keep this as an honestly-documented no-op that logs the intended level for
 * traceability; it never patches LibreNMS core (FR-07). If a future non-SSO IdP path is added,
 * FR-16 re-opens as a new work item — not this one.
 */
const ensureUser = async (username: string, level: number): Promise<void> => {
  logger.info('login provisioning (native sso mechanism handles native user)', { username, level });
};

const authRouter = createAuthRouter({
  oidc,
  preSessions,
  sessions,
  logger,
  cookieName: config.session.cookieName,
  issuerUrl: config.oidc.issuerUrl,
  clientId: config.oidc.clientId,
  absoluteLifetimeSeconds: config.session.absoluteLifetimeSeconds,
  roleMap: config.roleMap,
  // After a successful login (and after IdP logout) land the browser on the CUSTOM UI, which the
  // gateway serves at /app — NOT the gateway root (that is the native LibreNMS UI behind
  // oauth2-proxy). The path is configurable via UI_POST_LOGIN_PATH for non-/app deployments.
  uiPostLoginPath: process.env.UI_POST_LOGIN_PATH ?? '/app',
  postLogoutRedirectUri: config.oidc.redirectUri.replace(/\/bff\/auth\/callback$/, '/app'),
  requireSession,
  ensureUser
});

const deviceRouter = createDeviceRouter({
  librenms,
  metrics,
  logger,
  requireSession,
  uiBaseUrl: config.librenms.uiBaseUrl
});

const alarmRouter = createAlarmRouter({
  librenms,
  logger,
  requireSession
});

/**
 * Per-user dashboard layout store (ADR 0010). Reuses the BFF's existing Redis client; the layout
 * key is derived from the session subject server-side, so no cross-user layout access is possible.
 */
const layouts = createLayoutStore(redis);
const dashboardLayoutRouter = createDashboardLayoutRouter({
  layouts,
  logger,
  requireSession
});

/**
 * `/ready` now performs REAL dependency probes for Redis (session store, PING), LibreNMS
 * (reachable + authenticated), the InfluxDB v2 TSDB (reachable), AND the IdP (the `nms` realm
 * discovery document + JWKS are fetchable). No probe is a stub — an unverified dependency reports
 * `error`, never a fabricated `ok`.
 */
const app = createApp({
  logger,
  version: BFF_VERSION,
  routers: [deviceRouter, alarmRouter, dashboardLayoutRouter],
  rootRouters: [authRouter],
  healthChecks: createHealthChecks({ redis, librenms, metrics, oidc }),
  isProduction: config.nodeEnv === 'production'
});

async function main(): Promise<void> {
  // Connect Redis lazily; a Redis outage must NOT stop the process from listening — `/ready`
  // reports the outage and drains traffic, while `/health` (liveness) stays up so the instance is
  // not restart-looped for an upstream failure (NFR-21).
  try {
    await redis.connect();
  } catch {
    logger.error('redis connect failed at startup; /ready will report not_ready until it recovers');
  }
  app.listen(config.port, () =>
    logger.warn('bff listening; /ready probes redis + librenms + tsdb + idp', {
      port: config.port,
      version: BFF_VERSION
    })
  );
}

void main();
