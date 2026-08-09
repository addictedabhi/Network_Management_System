/**
 * Fail-fast configuration validation (NFR-29).
 *
 * `loadConfig` throws before the server ever listens, so a misconfigured BFF never
 * serves traffic. Validation messages name only the offending KEYS — never their values —
 * because a validation error that echoes the environment is a secret leak into logs
 * (NFR-15/NFR-09).
 */
import { z } from 'zod';

/**
 * A required secret/identifier: trimmed, then required to be non-empty (finding 12).
 *
 * `.min(1)` alone accepted a WHITESPACE-ONLY value, which is the one live gap the old
 * `SECRET_KEYS` loop was reaching for. Trimming also stops a padded token from being pasted
 * straight into an Authorization header, where it produces a 401 that is painful to diagnose.
 */
const requiredSecret = () => z.string().trim().min(1);

/**
 * Environment variable namespaces owned by this application. `.strict()` is applied only to
 * keys in these namespaces, because the real `process.env` also carries PATH, HOME, CI and
 * hundreds of `npm_*` entries — rejecting those would mean the BFF could never start.
 */
const OWNED_PREFIXES = [
  'NODE_ENV',
  'PORT',
  'REDIS_',
  'LIBRENMS_',
  'OIDC_',
  'SESSION_',
  'ROLE_MAP',
  'AUTH_MODE',
  'LOG_LEVEL',
  'TSDB_'
];

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive(),
    REDIS_URL: z.string().url(),
    LIBRENMS_BASE_URL: z.string().url(),
    LIBRENMS_API_TOKEN: requiredSecret(),
    OIDC_ISSUER_URL: z.string().url(),
    OIDC_CLIENT_ID: requiredSecret(),
    OIDC_CLIENT_SECRET: requiredSecret(),
    OIDC_REDIRECT_URI: z.string().url(),
    SESSION_COOKIE_NAME: requiredSecret(),
    SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
    SESSION_ABSOLUTE_LIFETIME_SECONDS: z.coerce.number().int().positive().default(28800),
    ROLE_MAP: z.string().trim().min(1),
    AUTH_MODE: z.enum(['oidc', 'dev-local']).default('oidc'),
    LIBRENMS_UI_BASE_URL: z.string().url().optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
  })
  .strict();

export interface Config {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly redisUrl: string;
  readonly librenms: { baseUrl: string; apiToken: string; uiBaseUrl: string | undefined };
  readonly oidc: { issuerUrl: string; clientId: string; clientSecret: string; redirectUri: string };
  readonly session: {
    cookieName: string;
    idleTimeoutSeconds: number;
    absoluteLifetimeSeconds: number;
  };
  readonly roleMap: Readonly<Record<string, string>>;
  readonly authMode: 'oidc' | 'dev-local';
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Parses and SHAPE-VALIDATES the role map. Error messages name the key only, never the value
 * (NFR-15) — a role map can encode internal group names.
 */
function parseRoleMap(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid configuration: ROLE_MAP must be valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid configuration: ROLE_MAP must be a JSON object of group->role');
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error('Invalid configuration: ROLE_MAP must define at least one group->role entry');
  }
  for (const [group, role] of entries) {
    if (typeof role !== 'string' || role.trim() === '') {
      throw new Error(
        `Invalid configuration: ROLE_MAP entry for group "${group}" must map to a non-empty string role`
      );
    }
  }
  return Object.fromEntries(entries.map(([g, r]) => [g, (r as string).trim()]));
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Finding 11: this used to filter to `k in schema.shape`, which stripped unknown keys BEFORE
  // validation and made `.strict()` structurally unable to fire — an inert control. A typo'd
  // `LIBRENMS_API_TOKKEN` was silently dropped and the operator got a default where they
  // believed they had set a value. We now pass every key in THIS APPLICATION'S namespaces
  // through to the schema, so `.strict()` actually rejects the typo, while ambient machine
  // variables (PATH, HOME, npm_*) are excluded because they are not ours to police.
  const owned = Object.fromEntries(
    Object.entries(env).filter(
      ([k]) => k in schema.shape || OWNED_PREFIXES.some((prefix) => k.startsWith(prefix))
    )
  );
  const parsed = schema.safeParse(owned);
  if (!parsed.success) {
    // Report only the offending KEYS and messages — never the values (NFR-15).
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const value = parsed.data;

  if (value.NODE_ENV === 'production' && value.AUTH_MODE === 'dev-local') {
    throw new Error(
      'Invalid configuration: AUTH_MODE=dev-local is forbidden when NODE_ENV=production'
    );
  }
  // The former `SECRET_KEYS` empty-check loop is gone (finding 12). It was almost entirely
  // unreachable: two of its keys were already `.min(1)` in the schema, and the other two
  // (TSDB_TOKEN/TSDB_PASSWORD) are not in the schema at all, so they were never validated or
  // used — the loop only looked like a control. Its one real case, a whitespace-only value,
  // is now enforced at schema level by `requiredSecret()` (`.trim().min(1)`), which applies to
  // every required secret rather than a hand-maintained subset. Add the TSDB keys to the schema
  // when TSDB support lands.

  // ROLE_MAP drives AUTHORIZATION (NFR-11), so its SHAPE is validated, not merely its
  // JSON-parseability. `JSON.parse` succeeds for `123`, `[1,2]` and `null`, any of which would
  // have loaded a structurally broken role map and failed silently at authorization time.
  const roleMap = parseRoleMap(value.ROLE_MAP);

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    redisUrl: value.REDIS_URL,
    librenms: {
      baseUrl: value.LIBRENMS_BASE_URL,
      apiToken: value.LIBRENMS_API_TOKEN,
      uiBaseUrl: value.LIBRENMS_UI_BASE_URL
    },
    oidc: {
      issuerUrl: value.OIDC_ISSUER_URL,
      clientId: value.OIDC_CLIENT_ID,
      clientSecret: value.OIDC_CLIENT_SECRET,
      redirectUri: value.OIDC_REDIRECT_URI
    },
    session: {
      cookieName: value.SESSION_COOKIE_NAME,
      idleTimeoutSeconds: value.SESSION_IDLE_TIMEOUT_SECONDS,
      absoluteLifetimeSeconds: value.SESSION_ABSOLUTE_LIFETIME_SECONDS
    },
    roleMap,
    authMode: value.AUTH_MODE,
    logLevel: value.LOG_LEVEL
  };
}
