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

  it('never includes secret values in the thrown message', () => {
    try {
      loadConfig({ ...valid, PORT: 'not-a-number' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain('secret');
      expect((err as Error).message).not.toContain('test-token');
    }
  });
});
