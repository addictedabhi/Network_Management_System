/**
 * A minimal in-memory fixed-window rate limiter (NFR-17) — no new dependency.
 *
 * Applied to `/auth/callback` and write routes to blunt brute-force / replay attempts. Keyed by
 * source address (and route). In-memory is acceptable for the POC single-instance BFF; a
 * horizontally-scaled deployment would move the counter to Redis (noted, out of POC scope).
 *
 * Fails OPEN by design only for its own bookkeeping (a limiter that crashes must not take the
 * request path down); it never fails open on the LIMIT itself — over-limit is always rejected.
 */
import type { RequestHandler } from 'express';
import { AppError } from './errorHandler.js';

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  /** Distinguishes counters for different routes sharing one limiter map. */
  readonly bucket: string;
}

interface Counter {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const counters = new Map<string, Counter>();

  return (req, _res, next) => {
    const now = Date.now();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const key = `${options.bucket}:${ip}`;
    const existing = counters.get(key);
    if (!existing || existing.resetAt <= now) {
      counters.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > options.max) {
      next(new AppError('RATE_LIMITED', 'Too many requests. Please try again shortly.', 429));
      return;
    }
    next();
  };
}
