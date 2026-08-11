import { describe, it, expect } from 'vitest';
import { createSessionStore } from '../../src/auth/sessionStore.js';

function fakeRedis() {
  const map = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    store: map,
    ttl,
    async set(key: string, value: string) {
      map.set(key, value);
    },
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async del(key: string) {
      map.delete(key);
      ttl.delete(key);
    },
    async expire(key: string, seconds: number) {
      ttl.set(key, seconds);
    },
    async ping() {
      return 'PONG';
    }
  };
}

const base = {
  username: 'alice',
  displayName: 'Alice',
  subject: 'sub-1',
  role: 'operator' as const,
  accessToken: 'at',
  refreshToken: 'rt',
  accessTokenExpiresAt: Date.now() + 60_000,
  idpSid: 'sid-1'
};

describe('SessionStore', () => {
  it('creates a session with a high-entropy id not derived from user data', async () => {
    const store = createSessionStore(fakeRedis() as never, {
      idleTimeoutSeconds: 60,
      absoluteLifetimeSeconds: 600
    });
    const id = await store.create(base);
    expect(id.length).toBeGreaterThanOrEqual(32);
    expect(id).not.toContain('alice');
    expect(id).not.toContain('sub-1');
  });

  it('returns the stored record', async () => {
    const store = createSessionStore(fakeRedis() as never, {
      idleTimeoutSeconds: 60,
      absoluteLifetimeSeconds: 600
    });
    const id = await store.create(base);
    expect((await store.get(id))?.username).toBe('alice');
  });

  it('returns null for an unknown session', async () => {
    const store = createSessionStore(fakeRedis() as never, {
      idleTimeoutSeconds: 60,
      absoluteLifetimeSeconds: 600
    });
    expect(await store.get('nope')).toBeNull();
  });

  it('destroy makes the session unusable immediately (FR-18)', async () => {
    const store = createSessionStore(fakeRedis() as never, {
      idleTimeoutSeconds: 60,
      absoluteLifetimeSeconds: 600
    });
    const id = await store.create(base);
    await store.destroy(id);
    expect(await store.get(id)).toBeNull();
  });

  it('rejects a session past its absolute lifetime even if Redis still holds it', async () => {
    const redis = fakeRedis();
    const store = createSessionStore(redis as never, {
      idleTimeoutSeconds: 600,
      absoluteLifetimeSeconds: 1
    });
    const id = await store.create(base);
    const key = [...redis.store.keys()][0]!;
    const record = JSON.parse(redis.store.get(key)!);
    record.createdAt = Date.now() - 10_000;
    redis.store.set(key, JSON.stringify(record));
    expect(await store.get(id)).toBeNull();
  });

  it('rejects a session past its idle timeout even if Redis still holds it', async () => {
    const redis = fakeRedis();
    const store = createSessionStore(redis as never, {
      idleTimeoutSeconds: 1,
      absoluteLifetimeSeconds: 600
    });
    const id = await store.create(base);
    const key = [...redis.store.keys()][0]!;
    const record = JSON.parse(redis.store.get(key)!);
    record.lastSeenAt = Date.now() - 10_000;
    redis.store.set(key, JSON.stringify(record));
    expect(await store.get(id)).toBeNull();
    // Idle-expired session is proactively deleted, not left to linger.
    expect(redis.store.has(key)).toBe(false);
  });

  it('slides the idle timeout on a successful lookup (activity extends the session)', async () => {
    const redis = fakeRedis();
    const store = createSessionStore(redis as never, {
      idleTimeoutSeconds: 60,
      absoluteLifetimeSeconds: 600
    });
    const id = await store.create(base);
    const key = [...redis.store.keys()][0]!;
    const before = JSON.parse(redis.store.get(key)!).lastSeenAt as number;
    await new Promise((r) => setTimeout(r, 5));
    await store.get(id);
    const after = JSON.parse(redis.store.get(key)!).lastSeenAt as number;
    expect(after).toBeGreaterThan(before);
    // TTL is re-applied on slide so Redis expiry tracks the code-level idle window.
    expect(redis.ttl.get(key)).toBeGreaterThan(0);
  });

  it('generates unique ids across creations', async () => {
    const store = createSessionStore(fakeRedis() as never, {
      idleTimeoutSeconds: 60,
      absoluteLifetimeSeconds: 600
    });
    const ids = new Set(await Promise.all([store.create(base), store.create(base), store.create(base)]));
    expect(ids.size).toBe(3);
  });

  it('stores the opaque id under a namespaced key and never as user data', async () => {
    const redis = fakeRedis();
    const store = createSessionStore(redis as never, {
      idleTimeoutSeconds: 60,
      absoluteLifetimeSeconds: 600
    });
    const id = await store.create(base);
    const key = [...redis.store.keys()][0]!;
    expect(key).toBe(`sess:${id}`);
    // The tokens live in the SERVER-SIDE record only.
    const record = JSON.parse(redis.store.get(key)!);
    expect(record.accessToken).toBe('at');
    expect(record.refreshToken).toBe('rt');
  });
});
