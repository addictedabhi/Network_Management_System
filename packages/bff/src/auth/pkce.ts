/**
 * PKCE + login-integrity value generation (ADR 0003; AC-A#1).
 *
 * Every value here is generated with `crypto.randomBytes` (a CSPRNG), NEVER `Math.random`:
 *   - `codeVerifier` — 32 random bytes, base64url (43 chars), the RFC 7636 high-entropy verifier;
 *   - `codeChallenge` — S256 = base64url(SHA-256(verifier));
 *   - `state` / `nonce` — 32 random bytes each, base64url; CSRF/replay defence for the flow.
 */
import { randomBytes, createHash } from 'node:crypto';

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function codeChallengeS256(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export interface LoginIntegrity {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

export function createLoginIntegrity(): LoginIntegrity {
  const codeVerifier = randomUrlSafe(32);
  return {
    state: randomUrlSafe(32),
    nonce: randomUrlSafe(32),
    codeVerifier,
    codeChallenge: codeChallengeS256(codeVerifier)
  };
}
