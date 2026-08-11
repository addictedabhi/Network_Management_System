import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIRNMS — Network Operations',
  description: 'AIRNMS operator console — live device inventory and metrics.',
  icons: { icon: '/airnms_logo.png' }
};

/**
 * Force per-request (dynamic) rendering for the whole app.
 *
 * The security floor requires a per-request CSP nonce with NO `'unsafe-inline'` (reconciliation
 * item 21). Next only stamps that nonce onto its inline RSC bootstrap scripts when the request is
 * rendered dynamically — because the nonce is minted per request by `proxy.ts` and read from the
 * request `content-security-policy` header at render time (getScriptNonceFromHeader). A STATICALLY
 * prerendered page is baked at build time with NO nonce, so on a genuinely cold load its inline
 * bootstrap is CSP-blocked → React never hydrates → the page sticks on "Loading…". Opting the app
 * into dynamic rendering makes the middleware nonce reach the renderer, so the served scripts carry
 * the matching nonce and a strict CSP (nonce + `'strict-dynamic'`, no `'unsafe-inline'`) renders
 * cold. Every route here is an SSO-gated, client-driven view, so dynamic rendering is correct.
 */
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
