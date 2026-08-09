import { describe, it, expect } from 'vitest';
import { redact, REDACTED, createLogger } from '../../src/observability/logger.js';

describe('redact — key-name matching', () => {
  it('redacts authorization headers', () => {
    expect(redact({ headers: { authorization: 'Bearer abc' } })).toEqual({
      headers: { authorization: REDACTED }
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
      expect(out[key]).toBe(REDACTED);
    }
  });

  it('redacts nested values and preserves safe fields', () => {
    expect(redact({ ctx: { userId: 'u1', refreshToken: 'r' } })).toEqual({
      ctx: { userId: 'u1', refreshToken: REDACTED }
    });
  });

  /**
   * Finding H-3: redaction was key-name-only and missed common spellings. Each key below
   * carries a real secret in production traffic, so a miss is a direct NFR-15 breach.
   */
  it.each([
    'passwd',
    'pwd',
    'PWD',
    'Passwd',
    'user_password',
    'bearer',
    'Bearer',
    'sessionId',
    'session_id',
    'SESSIONID',
    'apiKey',
    'api-key',
    'privateKey',
    'private_key',
    'clientSecret',
    'refresh_token',
    'idToken',
    'auth',
    'authToken',
    'credentials',
    'passphrase',
    'snmp_community',
    'x-api-key',
    'set-cookie',
    'csrfToken',
    'signingKey',
    'salt',
    'otp',
    'pin'
  ])('redacts the key %s', (key) => {
    const out = redact({ [key]: 'super-secret-value' }) as Record<string, unknown>;
    expect(out[key]).toBe(REDACTED);
  });

  it('does not over-redact innocuous keys', () => {
    const out = redact({
      userId: 'u1',
      deviceName: 'core-sw-01',
      port: 4000,
      status: 'ok',
      hostname: 'router1',
      passwordPolicyVersion: 3
    }) as Record<string, unknown>;
    expect(out.userId).toBe('u1');
    expect(out.deviceName).toBe('core-sw-01');
    expect(out.port).toBe(4000);
    expect(out.status).toBe('ok');
    expect(out.hostname).toBe('router1');
  });
});

/**
 * Finding H-1: `redact()` recursed without cycle tracking, so a circular object blew the
 * stack. Worst placement possible — it is reachable from the error handler, so the FAILURE
 * path crashed the process and destroyed the log that would have explained the original error.
 */
describe('redact — circular structures (H-1)', () => {
  it('does not throw on a self-referencing object', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;
    expect(() => redact(node)).not.toThrow();
  });

  it('marks the cycle instead of recursing forever', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;
    const out = redact(node) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[Circular]');
  });

  it('handles a mutual cycle between two objects', () => {
    const a: Record<string, unknown> = { id: 'a' };
    const b: Record<string, unknown> = { id: 'b', a };
    a.b = b;
    const out = redact(a) as Record<string, unknown>;
    expect(out.id).toBe('a');
    expect((out.b as Record<string, unknown>).id).toBe('b');
    expect((out.b as Record<string, unknown>).a).toBe('[Circular]');
  });

  it('handles a cycle through an array', () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(() => redact({ arr })).not.toThrow();
  });

  it('does NOT mark repeated but acyclic siblings as circular', () => {
    // A DAG is not a cycle. Marking a shared-but-acyclic child as [Circular] would destroy
    // legitimate diagnostics, so the tracker must be scoped to the current path.
    const shared = { k: 'v' };
    const out = redact({ a: shared, b: shared }) as Record<string, Record<string, unknown>>;
    expect(out.a).toEqual({ k: 'v' });
    expect(out.b).toEqual({ k: 'v' });
  });

  it('survives a deeply nested structure without blowing the stack', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 5000; i += 1) deep = { child: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});

/**
 * Finding H-2: `Error` serialized to `{}` because `message`/`stack`/`name` are non-enumerable,
 * so logged errors arrived empty exactly when diagnostics mattered most.
 */
describe('redact — Error objects (H-2)', () => {
  it('serializes name and message rather than an empty object', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>;
    expect(out).not.toEqual({});
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
  });

  it('includes a stack', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>;
    expect(typeof out.stack).toBe('string');
    expect(out.stack as string).toContain('boom');
  });

  it('serializes a nested error held in a context field', () => {
    const out = redact({ err: new TypeError('bad type') }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out.err.name).toBe('TypeError');
    expect(out.err.message).toBe('bad type');
  });

  it('recurses into cause', () => {
    const root = new Error('root cause');
    const wrapper = new Error('wrapper', { cause: root });
    const out = redact(wrapper) as Record<string, Record<string, unknown>>;
    expect(out.message).toBe('wrapper');
    expect(out.cause.name).toBe('Error');
    expect(out.cause.message).toBe('root cause');
  });

  it('does not blow up on a self-referencing cause chain', () => {
    const err = new Error('loop') as Error & { cause?: unknown };
    err.cause = err;
    expect(() => redact(err)).not.toThrow();
  });

  it('redacts secret-bearing custom properties on an Error', () => {
    const err = Object.assign(new Error('auth failed'), { token: 'abc123' });
    const out = redact(err) as Record<string, unknown>;
    expect(out.message).toBe('auth failed');
    expect(out.token).toBe(REDACTED);
  });

  it('redacts a secret embedded in an Error message (H-4 overlap)', () => {
    const out = redact(new Error('failed for Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')) as Record<
      string,
      unknown
    >;
    expect(out.message as string).not.toContain('eyJhbGciOiJIUzI1NiJ9.abc.def');
    expect(out.message as string).toContain(REDACTED);
  });
});

/**
 * Finding H-4: no value-level redaction. NFR-15 forbids the secret reaching output
 * REGARDLESS of which key it sat under, so a credential inside a URL or a free-text message
 * must be scrubbed even when the key name is innocuous.
 */
describe('redact — value-level patterns (H-4)', () => {
  it('redacts inline credentials in a redis URL', () => {
    const out = redact({ redisUrl: 'redis://appuser:sup3rs3cret@cache.internal:6379/0' }) as Record<
      string,
      string
    >;
    expect(out.redisUrl).not.toContain('sup3rs3cret');
  });

  it('keeps the non-secret part of a URL useful for debugging', () => {
    const out = redact({ dsn: 'postgres://user:pw@db.internal:5432/nms' }) as Record<
      string,
      string
    >;
    expect(out.dsn).not.toContain('pw@');
    expect(out.dsn).toContain('db.internal');
  });

  it('leaves a credential-free URL untouched', () => {
    const url = 'https://librenms.internal:8000/api/v0/devices';
    expect((redact({ url }) as Record<string, string>).url).toBe(url);
  });

  it('redacts a bearer token inside free text under an innocuous key', () => {
    const out = redact({
      message: 'upstream rejected Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
    }) as Record<string, string>;
    expect(out.message).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload.sig');
  });

  it('redacts a private key header block', () => {
    const out = redact({
      blob: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\n-----END RSA PRIVATE KEY-----'
    }) as Record<string, string>;
    expect(out.blob).not.toContain('MIIEowIBAAKC');
    expect(out.blob).toContain(REDACTED);
  });

  it('redacts a bare JWT appearing as a value', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    const out = redact({ evidence: jwt }) as Record<string, string>;
    expect(out.evidence).not.toContain(jwt);
  });

  it('applies value redaction inside arrays', () => {
    const out = redact(['redis://u:p@h:6379', 'safe-string']) as string[];
    expect(out[0]).not.toContain('p@');
    expect(out[1]).toBe('safe-string');
  });
});

describe('redact — non-plain objects', () => {
  it('preserves Date as an ISO string rather than flattening to {}', () => {
    const when = new Date('2026-08-09T10:30:00.000Z');
    expect(redact({ when }) as Record<string, unknown>).toEqual({
      when: '2026-08-09T10:30:00.000Z'
    });
  });

  it('serializes Map and Set legibly', () => {
    const out = redact({ m: new Map([['k', 'v']]), s: new Set([1, 2]) }) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(out.m)).toContain('k');
    expect(JSON.stringify(out.s)).toContain('1');
  });

  it('redacts a secret held in a Map value', () => {
    const out = redact({ m: new Map([['password', 'hunter2']]) });
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });

  it('passes primitives through untouched', () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
    expect(redact(true)).toBe(true);
  });

  it('redacts an array of objects (finding 14c)', () => {
    const out = redact([{ token: 'a' }, { userId: 'u' }]) as Record<string, unknown>[];
    expect(out[0].token).toBe(REDACTED);
    expect(out[1].userId).toBe('u');
  });
});

describe('createLogger', () => {
  function capture(run: (log: ReturnType<typeof createLogger>) => void, logLevel = 'debug') {
    const lines: string[] = [];
    const original = process.stdout.write;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (chunk: string) => {
      lines.push(String(chunk));
      return true;
    };
    try {
      run(createLogger({ logLevel: logLevel as 'debug' }));
    } finally {
      process.stdout.write = original;
    }
    return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  /**
   * Finding 5, root cause. `process.stdout.write` throws on EPIPE (a container whose stdout pipe
   * closes, a detached log collector, a full pipe buffer). An uncontained write therefore made
   * `logger.error` throw INTO ITS CALLER — turning every call site into a potential double fault.
   * Containment here fixes the cause; the error handler's fallback only covers the symptom.
   */
  it('does not throw into the caller when stdout.write throws (EPIPE)', () => {
    const outOriginal = process.stdout.write;
    const errOriginal = process.stderr.write;
    const fallback: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = () => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (chunk: string) => {
      fallback.push(String(chunk));
      return true;
    };
    try {
      const log = createLogger({ logLevel: 'debug' });
      expect(() => log.error('real server fault', { requestId: 'CID-1' })).not.toThrow();
      expect(() => log.warn('w')).not.toThrow();
      expect(() => log.info('i')).not.toThrow();
      expect(() => log.debug('d')).not.toThrow();
      expect(() =>
        log.audit({
          actor: 'a',
          action: 'b',
          target: 'c',
          outcome: 'failure',
          correlationId: 'CID-1'
        })
      ).not.toThrow();
    } finally {
      process.stdout.write = outOriginal;
      process.stderr.write = errOriginal;
    }
    // Best effort, not silence: the record is retried on stderr rather than dropped.
    expect(fallback.join('')).toContain('real server fault');
    expect(fallback.join('')).toContain('CID-1');
  });

  it('does not throw into the caller when BOTH stdout and stderr throw', () => {
    const outOriginal = process.stdout.write;
    const errOriginal = process.stderr.write;
    const boom = () => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = boom;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = boom;
    try {
      const log = createLogger({ logLevel: 'debug' });
      expect(() => log.error('fault', { a: 1 })).not.toThrow();
    } finally {
      process.stdout.write = outOriginal;
      process.stderr.write = errOriginal;
    }
  });

  it('emits structured JSON with the required fields', () => {
    const [entry] = capture((log) => log.info('hello', { userId: 'u1' }));
    expect(entry.level).toBe('INFO');
    expect(entry.service).toBe('bff');
    expect(entry.message).toBe('hello');
    expect(typeof entry.timestamp).toBe('string');
  });

  it('applies redaction at the logger layer, not the call site', () => {
    const [entry] = capture((log) => log.info('login', { password: 'hunter2' }));
    expect(JSON.stringify(entry)).not.toContain('hunter2');
  });

  it('respects the level threshold', () => {
    const entries = capture((log) => {
      log.debug('noisy');
      log.error('important');
    }, 'error');
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('important');
  });

  it('never throws when handed a circular context (H-1 at the logger boundary)', () => {
    const ctx: Record<string, unknown> = { a: 1 };
    ctx.self = ctx;
    expect(() => capture((log) => log.error('circular', ctx))).not.toThrow();
  });

  it('logs an Error context with a usable message (H-2 at the logger boundary)', () => {
    const [entry] = capture((log) => log.error('failed', new Error('kaboom')));
    expect(JSON.stringify(entry)).toContain('kaboom');
  });
});
