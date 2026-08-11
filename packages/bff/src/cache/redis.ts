/**
 * Thin wrapper over the pinned `redis` client, exposing exactly the `RedisLike` surface the
 * session store and health probe need (ADR 0003 session store; NFR-21 readiness).
 *
 * The connection URL comes from server-side config only (`REDIS_URL`); it never reaches the
 * browser. `PING` is used by the `/ready` probe (`health/checks.ts`); a per-call socket timeout
 * keeps a dead Redis from hanging the probe (readiness fails closed instead — health.ts finding 9
 * additionally races every probe against the readiness budget).
 */
import { createClient } from 'redis';
import type { RedisLike } from '../auth/sessionStore.js';

/** Bound how long a single Redis command (connect/PING/GET/SET) may block. */
const COMMAND_TIMEOUT_MS = 2000;

export interface RedisClient extends RedisLike {
  connect(): Promise<void>;
  quit(): Promise<void>;
}

export function createRedis(url: string): RedisClient {
  const client = createClient({
    url,
    socket: { connectTimeout: COMMAND_TIMEOUT_MS, reconnectStrategy: false },
    commandsQueueMaxLength: 1000
  });

  // A missing error listener turns a transient socket error into an unhandled 'error' event that
  // crashes the process. We swallow it here (the /ready probe surfaces Redis health explicitly);
  // no URL or credential is logged.
  client.on('error', () => {});

  return {
    async connect() {
      await client.connect();
    },
    async set(key, value) {
      return client.set(key, value);
    },
    async get(key) {
      return client.get(key);
    },
    async del(key) {
      return client.del(key);
    },
    async expire(key, seconds) {
      return client.expire(key, seconds);
    },
    async ping() {
      return client.ping();
    },
    async quit() {
      await client.quit();
    }
  };
}
