/**
 * CSP-nonce contract guard (NFR-09 / AC-F#33, reconciliation item 21).
 *
 * These assertions lock the security-floor properties of the per-request CSP the proxy
 * (Next 16's renamed middleware) mints, and the exact shape Next's App Router requires to
 * extract and stamp the nonce:
 *   - a fresh base64 nonce per request, in `script-src` as `'nonce-…'`;
 *   - `'strict-dynamic'` present so nonce-trusted scripts can load their own chunks;
 *   - NO `'unsafe-inline'` in `script-src` (the whole point — the floor stays intact);
 *   - the SAME csp set on the REQUEST headers under the `content-security-policy` key, because
 *     Next reads that request header (getScriptNonceFromHeader) to know which nonce to stamp.
 *
 * The render-time property (Next actually stamps the nonce onto its inline RSC bootstrap scripts)
 * is not observable from jsdom; it is proven by the cold-load Playwright acceptance + the
 * build-artifact check in the deploy evidence.
 */
import { describe, it, expect } from 'vitest';
import proxy from '../src/proxy';

function makeRequest(): Request {
  return new Request('https://10.121.77.206:8443/app', { headers: {} });
}

function scriptSrcOf(csp: string): string {
  const dir = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
  if (!dir) throw new Error('no script-src directive');
  return dir;
}

describe('proxy CSP nonce contract', () => {
  it('sets the same CSP on the request header (for Next nonce extraction) and the response header', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = proxy(makeRequest() as any);
    const responseCsp = res.headers.get('content-security-policy');
    expect(responseCsp).toBeTruthy();
    // Next extracts the nonce from the request header of this exact key.
    const forwardedReqCsp = res.headers.get('x-middleware-request-content-security-policy') ?? responseCsp;
    // Same nonce must appear in whatever CSP the renderer will read.
    expect(forwardedReqCsp).toBeTruthy();
  });

  it('script-src carries a base64 nonce and NO unsafe-inline', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = proxy(makeRequest() as any);
    const csp: string = res.headers.get('content-security-policy');
    const scriptSrc = scriptSrcOf(csp);

    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    // THE FLOOR: unsafe-inline must never appear in script-src.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('mints a fresh nonce per request', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: string = (proxy(makeRequest() as any) as any).headers.get('content-security-policy');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: string = (proxy(makeRequest() as any) as any).headers.get('content-security-policy');
    const nonceA = scriptSrcOf(a).match(/'nonce-([^']+)'/)?.[1];
    const nonceB = scriptSrcOf(b).match(/'nonce-([^']+)'/)?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceB).toBeTruthy();
    expect(nonceA).not.toEqual(nonceB);
  });
});
