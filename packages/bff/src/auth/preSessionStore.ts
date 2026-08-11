/**
 * The short-lived pre-session store (ADR 0003 §State/PKCE integrity).
 *
 * Between `/auth/login` and `/auth/callback` the BFF must remember the `state`, `nonce`, and PKCE
 * `codeVerifier` it generated — SERVER-SIDE, keyed by `state`, so the browser never holds them.
 * The record is SINGLE-USE (consumed on callback and deleted) and short-TTL, so a stale or replayed
 * `state` finds nothing and the callback is rejected.
 *
 * Reuses the same narrow `RedisLike` surface as the session store (no live host needed for tests).
 */
import type { RedisLike } from './sessionStore.js';

export interface PreSession {
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly createdAt: number;
}

export interface PreSessionStore {
  /** Store the login-integrity values under `state`, with the given TTL. */
  put(state: string, value: Omit<PreSession, 'createdAt'>): Promise<void>;
  /** Look up AND DELETE atomically-enough for single use; returns null if absent/replayed. */
  consume(state: string): Promise<PreSession | null>;
}

const KEY_PREFIX = 'presess:';
const DEFAULT_TTL_SECONDS = 300;

export function createPreSessionStore(
  redis: RedisLike,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): PreSessionStore {
  const key = (state: string) => `${KEY_PREFIX}${state}`;
  return {
    async put(state, value) {
      const record: PreSession = { ...value, createdAt: Date.now() };
      await redis.set(key(state), JSON.stringify(record));
      await redis.expire(key(state), ttlSeconds);
    },
    async consume(state) {
      const raw = await redis.get(key(state));
      // Delete first so a concurrent replay of the same state cannot also succeed. A missing
      // key (expired, never issued, or already consumed) returns null → the callback rejects.
      await redis.del(key(state));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as PreSession;
      } catch {
        return null;
      }
    }
  };
}
