import { NextResponse } from 'next/server';

/**
 * Readiness: the web tier is ready only if it can reach the BFF's liveness endpoint. Uses the
 * server-side BFF origin (never exposed to the browser). A BFF outage → 503 not_ready.
 */
const BFF_ORIGIN = process.env.BFF_ORIGIN ?? 'http://localhost:4000';

export async function GET() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${BFF_ORIGIN.replace(/\/$/, '')}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('bff not ok');
    return NextResponse.json({ status: 'ready', service: 'web', checks: { bff: 'ok' } }, { status: 200 });
  } catch {
    return NextResponse.json(
      { status: 'not_ready', service: 'web', checks: { bff: 'error' } },
      { status: 503 }
    );
  }
}
