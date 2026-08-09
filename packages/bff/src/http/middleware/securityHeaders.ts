import type { RequestHandler } from 'express';

/**
 * Security headers for the BFF (AC-F#33).
 *
 * This CSP is the API's OWN policy: the BFF serves JSON only, so `default-src 'none'` is
 * correct here. The UI's CSP is a different document with different needs and is set in the
 * web package — do not copy this policy there.
 */
export function createSecurityHeaders(isProduction: boolean): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
    // HSTS only in production (finding 17). A one-year `includeSubDomains` pin sent from a
    // plaintext dev server is a footgun: if a developer ever reaches a real hostname over
    // HTTPS even once, the browser pins that entire domain tree for a year and plain-HTTP
    // local work on any subdomain breaks with no obvious cause.
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
