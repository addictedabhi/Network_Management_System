/**
 * The OIDC client for the BFF's OWN confidential client (`nms-custom-ui`) — Authorization Code +
 * PKCE against the Keycloak `nms` realm (ADR 0003, F-5 amendment; team-config §8).
 *
 * SECURITY FLOOR: the client secret, the authorization code, and every token live ONLY here and
 * in the server-side session store. Nothing token-bearing is ever returned toward the browser.
 * The token endpoint is called with the confidential client's `client_secret` server-side.
 *
 * All network calls go through the injected `fetchImpl` (the shared `secureFetch`, which trusts
 * the POC self-signed CA for `10.121.77.206:8443` without disabling TLS verification).
 *
 * The JWKS resolver is exposed via `getJwks()` so `verifyIdToken` and the `/ready` idp probe use
 * the SAME discovered JWKS URI — one source of truth for the realm's keys.
 */
import { createRemoteJWKSet, customFetch, type JWTVerifyGetKey } from 'jose';

export interface OidcConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface DiscoveryDocument {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly end_session_endpoint?: string;
  readonly issuer: string;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string;
  readonly accessTokenExpiresAt: number;
}

export interface AuthorizationUrlParams {
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

const DISCOVERY_TIMEOUT_MS = 8000;
const TOKEN_TIMEOUT_MS = 10_000;

export interface OidcClient {
  discover(): Promise<DiscoveryDocument>;
  getJwks(): Promise<JWTVerifyGetKey>;
  buildAuthorizationUrl(params: AuthorizationUrlParams): Promise<string>;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  buildEndSessionUrl(input: {
    idToken: string;
    postLogoutRedirectUri: string;
  }): Promise<string | null>;
}

function issuerBase(issuerUrl: string): string {
  return issuerUrl.replace(/\/$/, '');
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`oidc endpoint returned ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toTokenSet(raw: {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
}): TokenSet {
  if (
    typeof raw.access_token !== 'string' ||
    typeof raw.id_token !== 'string' ||
    typeof raw.refresh_token !== 'string'
  ) {
    throw new Error('oidc token response missing required fields');
  }
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 300;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    idToken: raw.id_token,
    accessTokenExpiresAt: Date.now() + expiresIn * 1000
  };
}

export function createOidcClient(config: OidcConfig, fetchImpl: typeof fetch = fetch): OidcClient {
  let discoveryCache: DiscoveryDocument | undefined;
  let jwksCache: JWTVerifyGetKey | undefined;

  async function discover(): Promise<DiscoveryDocument> {
    if (discoveryCache) return discoveryCache;
    const url = `${issuerBase(config.issuerUrl)}/.well-known/openid-configuration`;
    const doc = await fetchJson<DiscoveryDocument>(fetchImpl, url, {}, DISCOVERY_TIMEOUT_MS);
    if (
      typeof doc.authorization_endpoint !== 'string' ||
      typeof doc.token_endpoint !== 'string' ||
      typeof doc.jwks_uri !== 'string'
    ) {
      throw new Error('oidc discovery document is missing required endpoints');
    }
    discoveryCache = doc;
    return doc;
  }

  async function getJwks(): Promise<JWTVerifyGetKey> {
    if (jwksCache) return jwksCache;
    const doc = await discover();
    // createRemoteJWKSet caches keys and refreshes on unknown-kid, bounded (jose defaults).
    // The injected `fetchImpl` (the shared `secureFetch`) is used via jose's documented
    // `[customFetch]` hook, so JWKS retrieval trusts the POC self-signed CA identically to
    // discovery — TLS verification stays ON, no process-global state is touched.
    jwksCache = createRemoteJWKSet(new URL(doc.jwks_uri), {
      [customFetch]: fetchImpl
    });
    return jwksCache;
  }

  return {
    discover,
    getJwks,

    async buildAuthorizationUrl(params) {
      const doc = await discover();
      const url = new URL(doc.authorization_endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('scope', 'openid profile email');
      url.searchParams.set('state', params.state);
      url.searchParams.set('nonce', params.nonce);
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier }) {
      const doc = await discover();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: codeVerifier
      });
      const raw = await fetchJson<Record<string, unknown>>(
        fetchImpl,
        doc.token_endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        },
        TOKEN_TIMEOUT_MS
      );
      return toTokenSet(raw);
    },

    async refresh(refreshToken) {
      const doc = await discover();
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret
      });
      const raw = await fetchJson<Record<string, unknown>>(
        fetchImpl,
        doc.token_endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        },
        TOKEN_TIMEOUT_MS
      );
      return toTokenSet(raw);
    },

    async buildEndSessionUrl({ idToken, postLogoutRedirectUri }) {
      const doc = await discover();
      if (!doc.end_session_endpoint) return null;
      const url = new URL(doc.end_session_endpoint);
      url.searchParams.set('id_token_hint', idToken);
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      return url.toString();
    }
  };
}
