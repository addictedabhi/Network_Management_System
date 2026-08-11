/**
 * @nms/simulator entry point — `npm run sim`.
 *
 * Two modes:
 *   (default)          start the TEST-ONLY control plane HTTP server (localhost:9001)
 *   --emit-snmprec DIR write one .snmprec file per device profile into DIR, so the
 *                      profiles are reproducible as repo/host artifacts the snmpsim
 *                      container replays (docs/design/demo-simulated-hosts-design.md).
 *
 * No fabricated metrics: this harness only makes LibreNMS POLL a simulated agent.
 * It never writes into InfluxDB/RRD. Withheld = absent, never 0 (FR-52/FR-24).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOidStore, profiles } from './profiles/index.js';
import { toSnmprec } from './agent/snmprec.js';
import { createControlServer } from './control/server.js';

export { createControlPlane } from './control/api.js';
export { createControlServer } from './control/server.js';
export { createOidStore } from './agent/oidStore.js';
export { createSnmpAgent } from './agent/snmpAgent.js';
export { profiles, buildOidStore } from './profiles/index.js';
export { toSnmprec } from './agent/snmprec.js';

export async function emitSnmprec(dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, profile] of Object.entries(profiles)) {
    const file = path.join(dir, `sim-${name}.snmprec`);
    await writeFile(file, toSnmprec(buildOidStore(profile)), 'utf8');
    written.push(file);
  }
  return written;
}

async function main(argv: string[]): Promise<void> {
  const emitIdx = argv.indexOf('--emit-snmprec');
  if (emitIdx !== -1) {
    const dir = argv[emitIdx + 1] ?? 'snmprec';
    const files = await emitSnmprec(dir);
    // eslint-disable-next-line no-console
    console.log(`[simulator] wrote ${files.length} .snmprec profiles to ${dir}`);
    return;
  }
  const server = createControlServer();
  await server.start();
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.js')) {
  main(process.argv.slice(2)).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[simulator] fatal:', err);
    process.exitCode = 1;
  });
}
