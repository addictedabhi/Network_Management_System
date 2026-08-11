import { NextResponse } from 'next/server';

/** Liveness: the web process is up. No dependency calls (mirrors the BFF contract, design §3.3). */
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'web', version: '0.1.0' }, { status: 200 });
}
