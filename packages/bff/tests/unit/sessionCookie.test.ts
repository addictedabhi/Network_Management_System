import { describe, it, expect } from 'vitest';
import {
  serializeSessionCookie,
  clearSessionCookie,
  readSessionId
} from '../../src/auth/sessionCookie.js';

const NAME = 'nms_sid';
const OPAQUE_ID = 'Zk9x-3vR_opaque-session-id-1234567890abcdef';

// A representative server-side session record. Only the OPAQUE id may ever be serialized into a
// cookie — these token/identity values must never appear in a Set-Cookie header (FR-12, AC-A#2).
const SENSITIVE = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.ACCESS_TOKEN_SECRET',
  refreshToken: 'REFRESH_TOKEN_SECRET_value',
  idToken: 'eyJID_TOKEN_SECRETj9',
  clientSecret: 'oidc-client-secret-xyz',
  username: 'alice',
  subject: 'sub-1'
};

describe('session cookie carries ONLY the opaque id', () => {
  it('sets HttpOnly, Secure and SameSite=Lax', () => {
    const cookie = serializeSessionCookie(NAME, OPAQUE_ID, { maxAgeSeconds: 600 });
    expect(cookie).toContain(`${NAME}=${OPAQUE_ID}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it('contains NO token, secret, or user PII — the id is a lookup key only', () => {
    const cookie = serializeSessionCookie(NAME, OPAQUE_ID, { maxAgeSeconds: 600 });
    for (const secret of Object.values(SENSITIVE)) {
      expect(cookie).not.toContain(secret);
    }
  });

  it('clear cookie expires immediately and carries no value', () => {
    const cookie = clearSessionCookie(NAME);
    expect(cookie).toContain(`${NAME}=;`);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it('reads the opaque id back from a Cookie header, or null when absent', () => {
    expect(readSessionId(`${NAME}=${OPAQUE_ID}`, NAME)).toBe(OPAQUE_ID);
    expect(readSessionId(`other=1; ${NAME}=${OPAQUE_ID}; x=y`, NAME)).toBe(OPAQUE_ID);
    expect(readSessionId('other=1', NAME)).toBeNull();
    expect(readSessionId(undefined, NAME)).toBeNull();
  });
});
