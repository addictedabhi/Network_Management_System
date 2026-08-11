import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createSecureFetch } from '../../src/http/secureFetch.js';

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function listen(handler: (req: unknown, res: { statusCode: number; end: (b?: string) => void; setHeader: (k: string, v: string) => void }) => void): Promise<string> {
  server = createServer(handler as never);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (typeof addr === 'object' && addr) return `http://127.0.0.1:${addr.port}`;
  throw new Error('no address');
}

describe('createSecureFetch', () => {
  it('performs a GET and exposes ok/status/text/json (http path)', async () => {
    const base = await listen((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ hello: 'world' }));
    });
    const fetchImpl = createSecureFetch();
    const res = await fetchImpl(`${base}/x`);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('reports a non-2xx via ok/status rather than throwing', async () => {
    const base = await listen((_req, res) => {
      res.statusCode = 503;
      res.end('down');
    });
    const fetchImpl = createSecureFetch();
    const res = await fetchImpl(`${base}/x`);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('down');
  });

  it('sends method, headers, and body', async () => {
    let seenMethod = '';
    let seenHeader = '';
    let seenBody = '';
    const base = await listen((req, res) => {
      const r = req as { method: string; headers: Record<string, string>; on: (e: string, cb: (c?: Buffer) => void) => void };
      seenMethod = r.method;
      seenHeader = r.headers['x-auth-token'] ?? '';
      const chunks: Buffer[] = [];
      r.on('data', (c?: Buffer) => c && chunks.push(c));
      r.on('end', () => {
        seenBody = Buffer.concat(chunks).toString();
        res.statusCode = 200;
        res.end('ok');
      });
    });
    const fetchImpl = createSecureFetch();
    await fetchImpl(`${base}/x`, {
      method: 'PUT',
      headers: { 'X-Auth-Token': 'tok' },
      body: JSON.stringify({ a: 1 })
    });
    expect(seenMethod).toBe('PUT');
    expect(seenHeader).toBe('tok');
    expect(seenBody).toBe('{"a":1}');
  });

  it('honours an AbortSignal that is already aborted', async () => {
    const base = await listen((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    const fetchImpl = createSecureFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(fetchImpl(`${base}/x`, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    });
  });

  it('aborts an in-flight request when the signal fires', async () => {
    const base = await listen((_req, res) => {
      // Never respond within the test window.
      setTimeout(() => {
        res.statusCode = 200;
        res.end('late');
      }, 5000);
    });
    const fetchImpl = createSecureFetch();
    const controller = new AbortController();
    const p = fetchImpl(`${base}/x`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(p).rejects.toBeDefined();
  });
});
