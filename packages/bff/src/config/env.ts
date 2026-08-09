/**
 * Fail-fast configuration validation (NFR-29).
 *
 * `loadConfig` throws before the server ever listens, so a misconfigured BFF never
 * serves traffic. Validation messages name only the offending KEYS — never their values —
 * because a validation error that echoes the environment is a secret leak into logs
 * (NFR-15/NFR-09).
 */
import { z } from 'zod';

const SECRET_KEYS = ['LIBRENMS_API_TOKEN', 'OIDC_CLIENT_SECRET', 'TSDB_TOKEN', 'TSDB_PASSWORD'];

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive(),
    REDIS_URL: z.string().url(),
    LIBRENMS_BASE_URL: z.string().url(),
    LIBRENMS_API_TOKEN: z.string().min(1),
    OIDC_ISSUER_URL: z.string().url(),
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_CLIENT_SECRET: z.string().min(1),
    OIDC_REDIRECT_URI: z.string().url(),
    SESSION_COOKIE_NAME: z.string().min(1),
    SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
    SESSION_ABSOLUTE_LIFETIME_SECONDS: z.coerce.number().int().positive().default(28800),
    ROLE_MAP: z.string().min(1),
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

export function loadConfig(env: Record<string, string | undefined>): Config {
  const relevant = Object.fromEntries(Object.entries(env).filter(([k]) => k in schema.shape));
  const parsed = schema.safeParse(relevant);
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
  for (const key of SECRET_KEYS) {
    const v = env[key];
    if (v !== undefined && v.trim() === '') {
      throw new Error(`Invalid configuration: ${key} must not be empty`);
    }
  }

  let roleMap: Record<string, string>;
  try {
    roleMap = JSON.parse(value.ROLE_MAP) as Record<string, string>;
  } catch {
    throw new Error('Invalid configuration: ROLE_MAP must be valid JSON');
  }

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
