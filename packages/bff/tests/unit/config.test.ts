import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  REDIS_URL: 'redis://localhost:6379',
  LIBRENMS_BASE_URL: 'http://localhost:8000',
  LIBRENMS_API_TOKEN: 'test-token',
  OIDC_ISSUER_URL: 'https://idp.example.com/realms/nms',
  OIDC_CLIENT_ID: 'nms-custom-ui',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: 'http://localhost:4000/auth/callback',
  SESSION_COOKIE_NAME: 'nms_session',
  ROLE_MAP: '{"nms-admin":"admin","nms-readonly":"readonly"}',
  AUTH_MODE: 'oidc'
};

describe('loadConfig', () => {
  it('accepts a complete valid environment', () => {
    expect(loadConfig(valid).port).toBe(4000);
  });

  it('throws when a required secret is missing', () => {
    const { LIBRENMS_API_TOKEN, ...missing } = valid;
    expect(() => loadConfig(missing)).toThrow(/LIBRENMS_API_TOKEN/);
  });

  it('refuses AUTH_MODE=dev-local in production', () => {
    expect(() =>
      loadConfig({ ...valid, NODE_ENV: 'production', AUTH_MODE: 'dev-local' })
    ).toThrow(/dev-local/);
  });

  /**
   * Finding 14b: the original version of this test triggered the throw via `PORT` being
   * not-a-number — a path that could not plausibly echo a token — so `not.toContain('secret')`
   * passed trivially and proved nothing. These exercise SECRET-BEARING values whose content
   * would actually reach the message if the redaction posture regressed.
   */
  it('never echoes an invalid secret value in the thrown message', () => {
    const leaked = 'sk-live-DEADBEEF-super-secret-token';
    expect(() => loadConfig({ ...valid, LIBRENMS_API_TOKEN: '' })).toThrow();
    try {
      // A URL-typed field whose value is a secret-looking non-URL: zod's message for a bad
      // url() does not include the input, and this pins that it stays that way.
      loadConfig({ ...valid, OIDC_ISSUER_URL: leaked });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain(leaked);
      expect((err as Error).message).not.toContain('DEADBEEF');
      expect((err as Error).message).toContain('OIDC_ISSUER_URL');
    }
  });

  it('never echoes the client secret when it is invalid', () => {
    try {
      loadConfig({ ...valid, OIDC_CLIENT_SECRET: '   ' });
      throw new Error('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('OIDC_CLIENT_SECRET');
      // The offending VALUE (even whitespace-only) must never be quoted back.
      expect(message).not.toMatch(/"\s+"/);
    }
  });

  /**
   * Re-derived during this iteration (same inert-control class as findings 11/12): ROLE_MAP was
   * validated only by `JSON.parse` succeeding. `JSON.parse('123')`, `'[1,2]'` and `'null'` all
   * succeed and yield a non-object, so the role map could be structurally wrong and still load
   * — and a broken role map is an AUTHORIZATION control failing silently (NFR-11).
   */
  describe('ROLE_MAP shape', () => {
    it.each(['123', '"a string"', '[1,2]', 'null', 'true'])(
      'rejects valid JSON %s that is not an object',
      (raw) => {
        expect(() => loadConfig({ ...valid, ROLE_MAP: raw })).toThrow(/ROLE_MAP/);
      }
    );

    it('rejects a role map whose values are not strings', () => {
      expect(() => loadConfig({ ...valid, ROLE_MAP: '{"nms-admin":123}' })).toThrow(/ROLE_MAP/);
    });

    it('rejects malformed JSON', () => {
      expect(() => loadConfig({ ...valid, ROLE_MAP: '{not json' })).toThrow(/ROLE_MAP/);
    });

    it('accepts a well-formed role map', () => {
      expect(loadConfig(valid).roleMap).toEqual({
        'nms-admin': 'admin',
        'nms-readonly': 'readonly'
      });
    });

    it('never echoes the ROLE_MAP contents in the error message', () => {
      try {
        loadConfig({ ...valid, ROLE_MAP: '{"group":"secret-role-name"' });
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as Error).message).not.toContain('secret-role-name');
      }
    });
  });

  /**
   * Finding 11: env was pre-filtered to `k in schema.shape` BEFORE `safeParse`, so `.strict()`
   * could never fire — an inert control. A typo'd key was silently dropped, and the operator
   * got a running server with a default where they thought they had set a value.
   */
  describe('unknown-key rejection (finding 11)', () => {
    it('rejects a typo\'d known-prefix key instead of silently ignoring it', () => {
      expect(() => loadConfig({ ...valid, LIBRENMS_API_TOKKEN: 'x' })).toThrow(
        /LIBRENMS_API_TOKKEN/
      );
    });

    it('rejects an unknown OIDC_* key', () => {
      expect(() => loadConfig({ ...valid, OIDC_CLIENT_SECRETT: 'x' })).toThrow(
        /OIDC_CLIENT_SECRETT/
      );
    });

    it('rejects an unknown SESSION_* key', () => {
      expect(() => loadConfig({ ...valid, SESSION_TIMEOUT: '60' })).toThrow(/SESSION_TIMEOUT/);
    });

    it('does NOT reject unrelated ambient environment variables', () => {
      // The real `process.env` carries PATH, HOME, CI, npm_* and hundreds more. Strictness must
      // apply to THIS application's namespace, not to the whole machine environment, or the
      // BFF would refuse to start anywhere.
      expect(() =>
        loadConfig({ ...valid, PATH: '/usr/bin', HOME: '/root', CI: 'true', npm_lifecycle_event: 'test' })
      ).not.toThrow();
    });

    it('names the offending key without echoing its value', () => {
      try {
        loadConfig({ ...valid, LIBRENMS_API_TOKKEN: 'secret-typo-value' });
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('LIBRENMS_API_TOKKEN');
        expect((err as Error).message).not.toContain('secret-typo-value');
      }
    });
  });

  /**
   * Finding 12: the `SECRET_KEYS` empty-check loop was mostly unreachable — the schema already
   * enforced `.min(1)` on two of the keys and the other two were absent from the schema. One
   * live gap survived: a WHITESPACE-ONLY token satisfies `.min(1)`.
   */
  describe('whitespace-only secrets (finding 12)', () => {
    it.each(['LIBRENMS_API_TOKEN', 'OIDC_CLIENT_SECRET', 'OIDC_CLIENT_ID', 'SESSION_COOKIE_NAME'])(
      'rejects a whitespace-only %s',
      (key) => {
        expect(() => loadConfig({ ...valid, [key]: '   ' })).toThrow(new RegExp(key));
      }
    );

    it('rejects a tab/newline-only token', () => {
      expect(() => loadConfig({ ...valid, LIBRENMS_API_TOKEN: '\t\n ' })).toThrow(
        /LIBRENMS_API_TOKEN/
      );
    });

    it('trims a padded secret rather than carrying the padding into an Authorization header', () => {
      // A token with trailing whitespace produces a malformed header and a 401 that is very
      // hard to diagnose, so the value is normalized at the boundary.
      expect(loadConfig({ ...valid, LIBRENMS_API_TOKEN: '  real-token  ' }).librenms.apiToken).toBe(
        'real-token'
      );
    });
  });
});
