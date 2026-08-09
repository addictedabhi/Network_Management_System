import { describe, it, expect } from 'vitest';
import { redact } from '../../src/observability/logger.js';

describe('redact', () => {
  it('redacts authorization headers', () => {
    expect(redact({ headers: { authorization: 'Bearer abc' } })).toEqual({
      headers: { authorization: '[REDACTED]' }
    });
  });

  it('redacts cookies, tokens, secrets, and communities', () => {
    const out = redact({
      cookie: 'nms_session=xyz',
      access_token: 'a',
      client_secret: 'b',
      snmpCommunity: 'public',
      password: 'p'
    }) as Record<string, unknown>;
    for (const key of ['cookie', 'access_token', 'client_secret', 'snmpCommunity', 'password']) {
      expect(out[key]).toBe('[REDACTED]');
    }
  });

  it('redacts nested values and preserves safe fields', () => {
    expect(redact({ ctx: { userId: 'u1', refreshToken: 'r' } })).toEqual({
      ctx: { userId: 'u1', refreshToken: '[REDACTED]' }
    });
  });
});
