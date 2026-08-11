import type { Metadata } from 'next';
import './globals.css';

/**
 * Browser-tab favicon. The real AIRNMS favicon assets live in `public/` and are served by our own
 * web container at `${BASE_PATH}/<asset>`. Like the navbar <img> in AppHeader, these `<link>` hrefs
 * are NOT basePath-aware automatically, so we prefix `NEXT_PUBLIC_BASE_PATH` explicitly ('/app' on
 * the deployed gateway, '' for a root-origin local run). We ship the multi-size `.ico` (16/32/48…)
 * as the primary icon and the 256×256 PNG as the high-DPI/apple-touch variant.
 */
const ICON_PREFIX = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'AIRNMS — Network Operations',
  description: 'AIRNMS operator console — live device inventory and metrics.',
  icons: {
    icon: [
      { url: `${ICON_PREFIX}/favicon.ico`, sizes: 'any' },
      { url: `${ICON_PREFIX}/icon.png`, type: 'image/png', sizes: '256x256' }
    ],
    apple: `${ICON_PREFIX}/icon.png`
  }
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
