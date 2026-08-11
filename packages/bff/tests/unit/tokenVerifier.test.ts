import { describe, it, expect } from 'vitest';
import { verifyIdToken, extractGroups } from '../../src/auth/tokenVerifier.js';
import { makeToken, TEST_OIDC } from '../helpers/jwt.js';

describe('verifyIdToken', () => {
  it('accepts a valid token and returns claims', async () => {
    const { token, jwks } = await makeToken({});
    const claims = await verifyIdToken(token, { ...TEST_OIDC, jwks });
    expect(claims.sub).toBe('sub-1');
    expect(extractGroups(claims)).toEqual(['nms-operator']);
  });

  it('rejects an invalid signature (AC-A#6)', async () => {
    const { token, otherJwks } = await makeToken({});
    await expect(verifyIdToken(token, { ...TEST_OIDC, jwks: otherJwks })).rejects.toThrow();
  });

  it('rejects a wrong audience (AC-A#6)', async () => {
    const { token, jwks } = await makeToken({ aud: 'someone-else' });
    await expect(verifyIdToken(token, { ...TEST_OIDC, jwks })).rejects.toThrow();
  });

  it('rejects a wrong issuer (AC-A#6)', async () => {
    const { token, jwks } = await makeToken({ iss: 'https://evil.test' });
    await expect(verifyIdToken(token, { ...TEST_OIDC, jwks })).rejects.toThrow();
  });

  it('rejects an expired token (AC-A#6)', async () => {
    const { token, jwks } = await makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyIdToken(token, { ...TEST_OIDC, jwks })).rejects.toThrow();
  });

  it('rejects a mismatched nonce', async () => {
    const { token, jwks } = await makeToken({ nonce: 'different' });
    await expect(verifyIdToken(token, { ...TEST_OIDC, jwks })).rejects.toThrow();
  });

  it('never surfaces token material in the thrown error', async () => {
    const { token, jwks } = await makeToken({ nonce: 'different' });
    try {
      await verifyIdToken(token, { ...TEST_OIDC, jwks });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toMatch(/eyJ/);
    }
  });
});
