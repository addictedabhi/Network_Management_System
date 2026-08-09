/**
 * Structured JSON logging with redaction applied at the LOGGER layer, not per call site,
 * so no call site can forget it (NFR-15). Tokens, cookies, secrets, SNMP communities and
 * passwords never reach stdout.
 *
 * Redaction is DEFENCE IN DEPTH and works on two independent axes, because either alone is
 * insufficient:
 *   1. KEY names — a field called `password` is redacted whatever it holds.
 *   2. VALUE patterns — a credential is redacted whatever key it sat under. NFR-15 forbids
 *      the secret reaching output regardless of key name, and real leaks arrive as a DSN in
 *      `redisUrl` or a bearer token inside an error `message`.
 *
 * The function must also NEVER throw. It is reachable from the error handler, so a crash here
 * turns a handled error into a process-level failure and destroys the very log that would
 * explain it.
 */
import type { Config } from '../config/env.js';

/**
 * Key names whose value is always a secret. Matched case-insensitively against a NORMALIZED
 * key (non-alphanumerics stripped), so `api-key`, `api_key` and `apiKey` all collapse to
 * `apikey` and cannot be missed by a spelling variant. Treat this list as security-relevant:
 * additions are cheap, omissions leak.
 */
const SECRET_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'credential',
  'community',
  'privatekey',
  'signingkey',
  'sessionid',
  'bearer',
  'salt',
  'otp',
  'pin',
  'csrf'
];

/**
 * Keys that CONTAIN a secret fragment but hold no secret. Without this, `passwordPolicyVersion`
 * would be redacted and an operator would lose harmless diagnostics — over-redaction erodes
 * trust in the logs and pushes people to log around the logger.
 */
const KEY_ALLOWLIST = new Set([
  'passwordpolicyversion',
  'passwordpolicy',
  'tokencount',
  'tokentype',
  'authmode',
  'authenticated',
  'cookiename',
  'sessionidletimeoutseconds'
]);

export const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (KEY_ALLOWLIST.has(normalized)) return false;
  return SECRET_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Value-level secret patterns (NFR-15). Ordered most-specific first; every pattern preserves
 * enough surrounding context to stay useful for debugging (host, scheme, key type) while
 * destroying the secret itself.
 */
const VALUE_PATTERNS: ReadonlyArray<{ pattern: RegExp; replace: (m: string, ...g: string[]) => string }> = [
  // PEM private key blocks — replace the body, keep the header so the type is still visible.
  {
    pattern: /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
    replace: (_m, begin, end) => `${begin}${REDACTED}${end}`
  },
  // URL userinfo: redis://user:pass@host -> redis://user:[REDACTED]@host. Keeps host/port,
  // which is the debuggable part, and destroys the credential.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    replace: (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`
  },
  // `Bearer <token>` / `Basic <blob>` anywhere in free text.
  {
    pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, scheme) => `${scheme} ${REDACTED}`
  },
  // Bare JWT (three base64url segments) appearing as a value.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replace: () => REDACTED
  }
];

function redactString(value: string): string {
  let out = value;
  for (const { pattern, replace } of VALUE_PATTERNS) {
    out = out.replace(pattern, replace as (substring: string, ...args: unknown[]) => string);
  }
  return out;
}

function serializeError(err: Error, seen: Set<unknown>): Record<string, unknown> {
  // `name`, `message` and `stack` are non-enumerable, so Object.entries() sees NONE of them
  // and a plain walk produced `{}` — destroying diagnostics exactly when they are needed.
  const out: Record<string, unknown> = {
    name: err.name,
    message: redactString(err.message)
  };
  if (typeof err.stack === 'string') out.stack = redactString(err.stack);
  if (err.cause !== undefined) out.cause = walk(err.cause, seen);
  // Custom own-properties (e.g. an AppError's `code`, or an accidental `token`) still apply
  // the normal key/value rules.
  for (const [key, value] of Object.entries(err)) {
    if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
    out[key] = isSecretKey(key) ? REDACTED : walk(value, seen);
  }
  return out;
}

/**
 * `seen` tracks the objects on the CURRENT PATH, and entries are removed on the way out. A
 * shared-but-acyclic child (a DAG) is therefore NOT reported as circular — only a true cycle
 * is, which keeps legitimate repeated structures readable.
 */
function walk(input: unknown, seen: Set<unknown>): unknown {
  if (typeof input === 'string') return redactString(input);
  if (input === null || typeof input !== 'object') {
    return typeof input === 'bigint' ? input.toString() : input;
  }
  if (seen.has(input)) return CIRCULAR;

  seen.add(input);
  try {
    if (input instanceof Error) return serializeError(input, seen);
    if (input instanceof Date) return input.toISOString();
    if (input instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of input.entries()) {
        const k = String(key);
        out[k] = isSecretKey(k) ? REDACTED : walk(value, seen);
      }
      return out;
    }
    if (input instanceof Set) return [...input].map((v) => walk(v, seen));
    if (Array.isArray(input)) return input.map((v) => walk(v, seen));
    if (Buffer.isBuffer(input)) return `[Buffer ${input.byteLength} bytes]`;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? REDACTED : walk(value, seen);
    }
    return out;
  } finally {
    seen.delete(input);
  }
}

/** Redacts secrets from an arbitrary value. Never throws; never recurses without bound. */
export function redact(input: unknown): unknown {
  try {
    return walk(input, new Set());
  } catch {
    // Last-resort guard: redaction failing must not take the process down, and must not
    // emit the unredacted original either. Fail CLOSED.
    return '[unserializable]';
  }
}

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
  audit(entry: {
    actor: string;
    action: string;
    target: string;
    outcome: 'success' | 'denied' | 'failure';
    correlationId: string;
  }): void;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

/** Serializes a log record, degrading safely rather than throwing inside the logger. */
function writeLine(record: Record<string, unknown>): void {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({
      timestamp: record.timestamp,
      level: record.level,
      service: record.service,
      message: record.message,
      context: '[unserializable]'
    });
  }
  // `process.stdout.write` THROWS on EPIPE (test finding 5) — a container whose stdout pipe is
  // closed, a detached log collector, a full pipe buffer. Uncontained, that turned every
  // `logger.error(...)` into a throw INTO ITS CALLER, so a log failure became a second fault at
  // whichever call site was reporting the first one. The error boundary's own fallback only
  // covered the symptom; the cause is contained here, so no caller can ever be broken by the log
  // transport. Containment is only justified because it is not silence: the record is retried on
  // stderr (a different fd, commonly still open) before being dropped.
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    try {
      process.stderr.write(`${line}\n`);
    } catch {
      // Both channels are gone. There is no third place to record this and re-throwing would
      // corrupt the caller, so the record is dropped deliberately.
    }
  }
}

export function createLogger(config: Pick<Config, 'logLevel'>, service = 'bff'): Logger {
  const threshold = LEVELS[config.logLevel];
  const emit = (level: keyof typeof LEVELS, message: string, context?: unknown) => {
    if (LEVELS[level] < threshold) return;
    writeLine({
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      service,
      // The message is operator-authored, but it routinely interpolates upstream text, so it
      // gets value-level redaction too.
      message: redactString(message),
      context: context === undefined ? undefined : redact(context)
    });
  };
  return {
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    // Audit entries deliberately bypass the level threshold: an audit trail that a log-level
    // change can silence is not an audit trail (NFR-15/NFR-23).
    audit: (entry) =>
      writeLine({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        service,
        message: 'audit',
        audit: redact(entry)
      })
  };
}
