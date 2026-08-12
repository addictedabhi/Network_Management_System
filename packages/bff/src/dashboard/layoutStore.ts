/**
 * Per-user dashboard layout store (ADR 0010).
 *
 * The layout is persisted in Redis under `dash:layout:v1:<sub>` where `<sub>` is the OIDC subject
 * from the SERVER-SIDE session — never from request input. The key is therefore not addressable by
 * the client: a user physically cannot read or write another user's layout (no IDOR surface,
 * NFR-11). This is a distinct keyspace from `sess:` and is written with NO TTL — a saved layout
 * must not evaporate on an idle timeout (session keys expire; layout keys do not).
 *
 * Durability across a Redis restart is a Redis *config* property (AOF/RDB), verified at deploy —
 * see ADR 0010. This module makes no assumption about it; it only reads/writes the key.
 *
 * Redis is injected via the narrow `RedisLike` surface so unit tests mock it at the boundary.
 */
import type { DashboardLayout } from '@nms/shared';
import type { RedisLike } from '../auth/sessionStore.js';

const KEY_PREFIX = 'dash:layout:v1:';

export interface LayoutStore {
  /** Read the layout for a subject, or `null` when none is stored (an honest empty, not an error). */
  get(subject: string): Promise<DashboardLayout | null>;
  /** Full-replace the layout for a subject. No TTL is set (ADR 0010). */
  put(subject: string, layout: DashboardLayout): Promise<void>;
  /** Reset (delete) the subject's layout so the client renders the default. */
  delete(subject: string): Promise<void>;
}

export function createLayoutStore(redis: RedisLike): LayoutStore {
  // The key is derived ONLY from the session subject the caller passes in (which the route takes
  // from `res.locals.session`, never from the request). Guard against an empty subject so a
  // misconfiguration can never collapse all users onto one shared key.
  const key = (subject: string): string => {
    if (!subject) throw new Error('layout key requires a non-empty session subject');
    return `${KEY_PREFIX}${subject}`;
  };

  return {
    async get(subject) {
      const raw = await redis.get(key(subject));
      if (!raw) return null;
      // The value was Zod-validated on write, so a parse here is trusted structure. A malformed
      // value (hand-edited / corrupted) is treated as "no layout" rather than crashing the read.
      try {
        return JSON.parse(raw) as DashboardLayout;
      } catch {
        return null;
      }
    },
    async put(subject, layout) {
      // NO `expire()` call — layout keys have no TTL (ADR 0010).
      await redis.set(key(subject), JSON.stringify(layout));
    },
    async delete(subject) {
      await redis.del(key(subject));
    }
  };
}
