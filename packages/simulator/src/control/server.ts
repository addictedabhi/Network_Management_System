/**
 * HTTP wrapper around the control plane (design doc §7.1). TEST-ONLY surface,
 * bound to localhost by default. Uses only node:http (no new dependency).
 *
 * Routes:
 *   POST   /control/devices                         {profile, count}
 *   GET    /control/devices
 *   PATCH  /control/devices/:id/oids                {oid, value}
 *   POST   /control/devices/:id/interfaces/:idx/flap {transitions}
 *   POST   /control/devices/:id/oids/withhold       {oid, mode}
 *   DELETE /control/devices/:id/oids/withhold       {oid}
 *   POST   /control/devices/:id/reachability        {reachable}
 *   POST   /control/devices/:id/tr069               {tolerant}
 */

import http from 'node:http';
import { createControlPlane, type ControlPlane } from './api.js';
import type { WithholdMode } from '../agent/oidStore.js';
import type { ProfileName } from '../profiles/index.js';

export interface ControlServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly plane?: ControlPlane;
}

export function createControlServer(options: ControlServerOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 9001;
  const plane = options.plane ?? createControlPlane();

  const server = http.createServer((req, res) => {
    handle(plane, req, res).catch((err) => {
      sendJson(res, 500, { success: false, error: { code: 'INTERNAL_ERROR', message: String(err) } });
    });
  });

  return {
    plane,
    async start() {
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        // eslint-disable-next-line no-console
        console.warn(
          `[simulator] WARNING: control surface bound to ${host} — this is a TEST-ONLY control plane and MUST NEVER run in production.`
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `[simulator] TEST-ONLY control plane listening on http://${host}:${port} — never expose in production.`
      );
      await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function handle(
  plane: ControlPlane,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'POST' && eq(parts, ['control', 'devices'])) {
    const body = await readJson(req);
    const created = plane.createDevices(body.profile as ProfileName, Number(body.count ?? 1));
    return sendJson(res, 201, { success: true, data: created.map(summarise) });
  }
  if (method === 'GET' && eq(parts, ['control', 'devices'])) {
    return sendJson(res, 200, { success: true, data: plane.listDevices().map(summarise) });
  }
  if (parts[0] === 'control' && parts[1] === 'devices' && parts[2]) {
    const id = parts[2];
    if (method === 'PATCH' && parts[3] === 'oids' && parts.length === 4) {
      const body = await readJson(req);
      plane.setOid(id, String(body.oid), body.value as number | string);
      return sendJson(res, 200, { success: true });
    }
    if (method === 'POST' && parts[3] === 'interfaces' && parts[5] === 'flap') {
      const body = await readJson(req);
      const out = plane.flapInterface(id, Number(parts[4]), Number(body.transitions ?? 3));
      return sendJson(res, 200, { success: true, data: out });
    }
    if (parts[3] === 'oids' && parts[4] === 'withhold') {
      const body = await readJson(req);
      if (method === 'POST') {
        plane.withholdOid(id, String(body.oid), body.mode as WithholdMode);
        return sendJson(res, 200, { success: true });
      }
      if (method === 'DELETE') {
        // DELETE carries the OID as a query param (no request body on DELETE).
        const oid = url.searchParams.get('oid') ?? String(body.oid);
        plane.restoreOid(id, oid);
        return sendJson(res, 200, { success: true });
      }
    }
    if (method === 'POST' && parts[3] === 'reachability') {
      const body = await readJson(req);
      plane.setReachability(id, Boolean(body.reachable));
      return sendJson(res, 200, { success: true });
    }
    if (method === 'POST' && parts[3] === 'tr069') {
      const body = await readJson(req);
      plane.setTr069Tolerant(id, Boolean(body.tolerant));
      return sendJson(res, 200, { success: true });
    }
  }

  return sendJson(res, 404, { success: false, error: { code: 'NOT_FOUND', message: 'no such route' } });
}

function summarise(d: ReturnType<ControlPlane['listDevices']>[number]) {
  return {
    id: d.id,
    profile: d.profile,
    reachable: d.reachable,
    snmpSilent: d.snmpSilent,
    withheld: d.store.withheldOids()
  };
}

function eq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}
