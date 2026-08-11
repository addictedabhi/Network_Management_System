/**
 * Nonce-based Content-Security-Policy (NFR-09 / AC-F#33).
 *
 * The security floor forbids `'unsafe-inline'` for scripts. Next's App Router injects inline
 * bootstrap scripts, so a bare `script-src 'self'` blocks hydration. The correct answer is NOT to
 * add `'unsafe-inline'` — it is a per-request NONCE: we mint a random nonce, put it in the CSP as
 * `script-src 'self' 'nonce-…'`, and Next automatically stamps that nonce onto the scripts it
 * emits (it reads the nonce from the CSP header on the request). Inline scripts without the nonce
 * are still blocked — so an injected `<script>` cannot run, which is the property the floor wants.
 *
 * `'strict-dynamic'` lets nonce-trusted scripts load their own chunks without each needing a
 * nonce. In development Next also needs `'unsafe-eval'` for HMR; that is gated to dev only and
 * never ships to production.
 */
import { NextResponse, type NextRequest } from 'next/server';

export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV !== 'production';
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next reads the CSP from the REQUEST headers to know which nonce to stamp onto its scripts.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Run on documents, not on static assets / the image optimizer.
  matcher: [
    // The index route. With `basePath: /app` baked in, this matches the actual landing URL the
    // operator opens (`/app`). The catch-all `.*` matcher below requires a path SEGMENT after the
    // basePath, so without this entry the landing page — the one that shows "Loading…" — would run
    // with NO CSP nonce and its inline bootstrap would be CSP-blocked on a cold load.
    { source: '/', missing: [{ type: 'header', key: 'next-router-prefetch' }] },
    {
      source: '/((?!_next/static|_next/image|favicon.ico|airnms_logo.png).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }]
    }
  ]
};
