/**
 * ID-token validation (NFR-14, AC-A#6, ADR 0003).
 *
 * Validation is server-side, in ONE place. It verifies:
 *   - the signature, against the realm JWKS (RS256/ES* per the key set);
 *   - the issuer (`iss`) equals the configured realm issuer;
 *   - the audience (`aud`) contains the configured client id;
 *   - expiry (`exp`) is honoured (with a small clock skew tolerance jose applies);
 *   - the `nonce` claim equals the one bound to this login (replay/injection defence).
 *
 * On ANY failure it throws `AppError('AUTH_REQUIRED', ..., 401)` — never returns partial claims.
 * The raw jose error is not surfaced to the client and carries no token material into the message.
 *
 * The JWKS is resolved by a caller-supplied `JWTVerifyGetKey` so production uses jose's
 * `createRemoteJWKSet` (cached, bounded refresh) while tests inject a local key set — no live IdP.
 */
import { jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { AppError } from '../http/middleware/errorHandler.js';

export interface VerifyIdTokenOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly nonce: string;
  /** The key resolver — `createRemoteJWKSet(...)` in production, a local set in tests. */
  readonly jwks: JWTVerifyGetKey;
}

/** The subset of ID-token claims the BFF consumes. `groups` drives role mapping (FR-15). */
export interface IdTokenClaims extends JWTPayload {
  readonly sub: string;
  readonly groups?: readonly string[];
  readonly preferred_username?: string;
  readonly name?: string;
  readonly email?: string;
  readonly nonce?: string;
  readonly sid?: string;
}

export async function verifyIdToken(
  token: string,
  opts: VerifyIdTokenOptions
): Promise<IdTokenClaims> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, opts.jwks, {
      issuer: opts.issuer,
      audience: opts.audience
      // `exp` is enforced by jwtVerify by default; signature is verified against `opts.jwks`.
    });
    payload = result.payload;
  } catch {
    // Signature / iss / aud / exp failure. No partial claims escape; no jose detail is surfaced.
    throw new AppError('AUTH_REQUIRED', 'Authentication failed.', 401);
  }

  // Nonce is compared EXPLICITLY (jose does not check it). A mismatch means this token was not
  // minted for this login attempt — reject rather than trust.
  if (typeof payload.nonce !== 'string' || payload.nonce !== opts.nonce) {
    throw new AppError('AUTH_REQUIRED', 'Authentication failed.', 401);
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new AppError('AUTH_REQUIRED', 'Authentication failed.', 401);
  }

  return payload as IdTokenClaims;
}

/** Narrows an arbitrary claim to a string[] of group names, dropping non-strings. */
export function extractGroups(claims: IdTokenClaims): string[] {
  const raw: unknown = claims.groups;
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is string => typeof g === 'string');
}
