import type { NextConfig } from 'next';

/**
 * The BFF origin the UI proxies `/bff/*` to. SERVER-SIDE only — it is read at build/runtime by
 * Next's rewrite engine and NEVER exposed to the browser (no `NEXT_PUBLIC_` prefix). The browser
 * only ever sees same-origin `/bff/...` requests carrying the opaque session cookie.
 */
const BFF_ORIGIN = process.env.BFF_ORIGIN ?? 'http://localhost:4000';

/**
 * Static security headers. The Content-Security-Policy is NOT here — it is emitted per-request by
 * `src/middleware.ts` with a fresh nonce so `script-src` can stay free of `'unsafe-inline'`
 * (NFR-09 / AC-F#33). These headers are the request-independent ones.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }
];

/**
 * The custom AIRNMS UI is fronted by the existing nginx TLS gateway at the subpath `/app` so the
 * working native-LibreNMS + oauth2-proxy SSO flow at the gateway ROOT is left completely untouched
 * (non-destructive routing — see the deploy evidence). `basePath` makes every page + asset live
 * under `/app`, so nginx routes `/app/` to this app and `/` to the native UI with no collision.
 *
 * `BASE_PATH` is read at build time (Next bakes basePath in). Defaults to `/app` for the deployed
 * gateway; set `BASE_PATH=''` for a root-origin local run.
 */
const BASE_PATH = process.env.BASE_PATH ?? '/app';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  // No powered-by header (framework fingerprinting).
  poweredByHeader: false,
  // Do not auto-generate AGENTS.md / CLAUDE.md scaffolding into the package.
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    // Same-origin proxy: the browser calls `/bff/...`; Next forwards to the BFF origin server-side.
    // The user's opaque session cookie rides along; no token or secret is ever in the browser.
    // `basePath: false` keeps the match at the true origin root (`/bff/...`, NOT `/app/bff/...`)
    // because bffClient issues absolute `/bff/...` fetches that basePath does not rewrite, and the
    // gateway routes `/bff/` at root.
    return [{ source: '/bff/:path*', destination: `${BFF_ORIGIN}/:path*`, basePath: false }];
  }
};

export default nextConfig;
