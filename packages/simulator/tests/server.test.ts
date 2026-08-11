import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createControlServer } from '../src/control/server.js';
import { profiles } from '../src/profiles/index.js';
import http from 'node:http';

let server: ReturnType<typeof createControlServer>;
let base: string;

async function req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      `${base}${path}`,
      { method, headers: data ? { 'content-type': 'application/json' } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

describe('control server HTTP (FR-51/FR-52, localhost-only)', () => {
  beforeAll(async () => {
    // Fixed localhost port for the round-trip test (test-only surface).
    server = createControlServer({ port: 4599 });
    await server.start();
    base = 'http://127.0.0.1:4599';
  });
  afterAll(async () => {
    await server.stop();
  });

  it('POST /control/devices creates devices; GET lists them', async () => {
    const created = await req('POST', '/control/devices', { profile: 'p2pRadio', count: 2 });
    expect(created.status).toBe(201);
    expect(created.json.data).toHaveLength(2);
    const list = await req('GET', '/control/devices');
    expect(list.json.data.length).toBeGreaterThanOrEqual(2);
  });

  it('withhold over HTTP yields absence, DELETE restores — the FR-52 chain', async () => {
    const created = await req('POST', '/control/devices', { profile: 'p2pRadio', count: 1 });
    const id = created.json.data[0].id;
    const rssi = profiles.p2pRadio.rf!.rssi;

    await req('POST', `/control/devices/${id}/oids/withhold`, { oid: rssi, mode: 'noSuchObject' });
    let list = await req('GET', '/control/devices');
    let dev = list.json.data.find((d: any) => d.id === id);
    expect(dev.withheld).toContainEqual({ oid: rssi, mode: 'noSuchObject' });

    await req('DELETE', `/control/devices/${id}/oids/withhold?oid=${encodeURIComponent(rssi)}`);
    list = await req('GET', '/control/devices');
    dev = list.json.data.find((d: any) => d.id === id);
    expect(dev.withheld).toHaveLength(0);
  });

  it('flap over HTTP returns the requested transitions', async () => {
    const created = await req('POST', '/control/devices', { profile: 'switch', count: 1 });
    const id = created.json.data[0].id;
    const flap = await req('POST', `/control/devices/${id}/interfaces/1/flap`, { transitions: 3 });
    expect(flap.json.data).toHaveLength(3);
  });

  it('unknown route → 404', async () => {
    const r = await req('GET', '/control/nope');
    expect(r.status).toBe(404);
  });
});
