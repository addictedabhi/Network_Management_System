/**
 * The opaque server-side session store (ADR 0003, FR-12, FR-18, FR-19).
 *
 * The browser only ever holds the OPAQUE session id (a random lookup key — see `sessionCookie.ts`).
 * Everything sensitive — the OIDC access/refresh/id tokens and the resolved identity — lives ONLY
 * in the Redis record, reachable only by the BFF. Nothing here is ever serialized to the browser.
 *
 * Lifetimes are enforced in code AND via the Redis TTL:
 *   - The TTL is the safety net (Redis reaps the key if the BFF never touches it again).
 *   - The code check is authoritative on read, so a session that outlived its idle/absolute window
 *     is rejected and deleted even if the TTL has not yet fired — never trust the store alone.
 */
import { randomBytes } from 'node:crypto';
import type { PlatformRole } from '@nms/shared';

export interface SessionRecord {
  username: string;
  displayName: string;
  subject: string;
  role: PlatformRole;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  /** The last id_token, kept SERVER-SIDE for the RP-initiated logout `id_token_hint` (FR-18). */
  idpIdToken: string;
  idpSid: string;
  createdAt: number;
  lastSeenAt: number;
}

/**
 * The minimal Redis surface the store needs. Keeping it narrow lets unit tests mock Redis at the
 * boundary (no live host required) and keeps the store client-agnostic.
 */
export interface RedisLike {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  ping(): Promise<string>;
}

export interface SessionLifetimes {
  readonly idleTimeoutSeconds: number;
  readonly absoluteLifetimeSeconds: number;
}

export interface SessionStore {
  create(data: Omit<SessionRecord, 'createdAt' | 'lastSeenAt'>): Promise<string>;
  get(id: string): Promise<SessionRecord | null>;
  update(id: string, patch: Partial<SessionRecord>): Promise<void>;
  destroy(id: string): Promise<void>;
}

const KEY_PREFIX = 'sess:';

/** Seconds of TTL to apply on write: the idle window bounded by the absolute lifetime. */
function slideTtlSeconds(record: SessionRecord, lifetimes: SessionLifetimes): number {
  const remainingAbsolute = Math.ceil(
    (record.createdAt + lifetimes.absoluteLifetimeSeconds * 1000 - Date.now()) / 1000
  );
  return Math.max(1, Math.min(lifetimes.idleTimeoutSeconds, remainingAbsolute));
}

export function createSessionStore(redis: RedisLike, lifetimes: SessionLifetimes): SessionStore {
  const key = (id: string) => `${KEY_PREFIX}${id}`;

  async function persist(id: string, record: SessionRecord): Promise<void> {
    await redis.set(key(id), JSON.stringify(record));
    await redis.expire(key(id), slideTtlSeconds(record, lifetimes));
  }

  return {
    async create(data) {
      // 32 bytes from a CSPRNG (`crypto.randomBytes`). Never `Math.random`, never derived from
      // user data — the id is a pure random lookup key, so it leaks no identity (ADR 0003).
      const id = randomBytes(32).toString('base64url');
      const now = Date.now();
      const record: SessionRecord = { ...data, createdAt: now, lastSeenAt: now };
      await persist(id, record);
      return id;
    },
    async get(id) {
      const raw = await redis.get(key(id));
      if (!raw) return null;
      const record = JSON.parse(raw) as SessionRecord;
      const now = Date.now();
      const expiredAbsolute = now - record.createdAt > lifetimes.absoluteLifetimeSeconds * 1000;
      const expiredIdle = now - record.lastSeenAt > lifetimes.idleTimeoutSeconds * 1000;
      if (expiredAbsolute || expiredIdle) {
        // Enforce lifetimes in code as well as via TTL — never trust the store alone (FR-19).
        await redis.del(key(id));
        return null;
      }
      // Sliding idle expiry: activity extends the window (FR-19). Re-apply the TTL so Redis
      // expiry tracks the code-level idle clock, still capped by the absolute lifetime.
      record.lastSeenAt = now;
      await persist(id, record);
      return record;
    },
    async update(id, patch) {
      const raw = await redis.get(key(id));
      if (!raw) return;
      const record: SessionRecord = {
        ...(JSON.parse(raw) as SessionRecord),
        ...patch,
        lastSeenAt: Date.now()
      };
      await persist(id, record);
    },
    async destroy(id) {
      // Server-side invalidation (FR-18): the record is gone, so a logged-out opaque id can never
      // be resumed even if the cookie survives in a browser.
      await redis.del(key(id));
    }
  };
}
