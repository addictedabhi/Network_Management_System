/**
 * Test-only JWT helper: mints ID tokens with a locally generated key pair and exposes the JWKS
 * so `verifyIdToken` can be exercised with NO live IdP. `otherJwks` is an unrelated key set used
 * to prove signature rejection.
 */
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
  type JWTVerifyGetKey,
  type JWK
} from 'jose';

const ISSUER = 'https://idp.test/realms/nms';
const AUDIENCE = 'nms-custom-ui';
const NONCE = 'n-1';

export interface MakeTokenOverrides {
  iss?: string;
  aud?: string;
  nonce?: string;
  exp?: number;
  sub?: string;
  groups?: readonly string[];
  preferred_username?: string;
  name?: string;
}

export interface MadeToken {
  token: string;
  jwks: JWTVerifyGetKey;
  otherJwks: JWTVerifyGetKey;
  kid: string;
}

let counter = 0;

export async function makeToken(overrides: MakeTokenOverrides = {}): Promise<MadeToken> {
  const kid = `test-key-${counter++}`;
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } as JWK;

  // An unrelated key set — a token signed by our private key will NOT verify against it.
  const { publicKey: otherPub } = await generateKeyPair('RS256');
  const otherJwk = {
    ...(await exportJWK(otherPub)),
    kid,
    alg: 'RS256',
    use: 'sig'
  } as JWK;

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    nonce: overrides.nonce ?? NONCE,
    groups: overrides.groups ?? ['nms-operator'],
    preferred_username: overrides.preferred_username ?? 'alice',
    name: overrides.name ?? 'Alice Operator',
    sid: 'idp-sid-1'
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(overrides.sub ?? 'sub-1')
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(overrides.exp ?? now + 3600)
    .sign(privateKey);

  return {
    token,
    jwks: createLocalJWKSet({ keys: [publicJwk] }),
    otherJwks: createLocalJWKSet({ keys: [otherJwk] }),
    kid
  };
}

export const TEST_OIDC = { issuer: ISSUER, audience: AUDIENCE, nonce: NONCE } as const;
