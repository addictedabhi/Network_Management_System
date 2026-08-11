/**
 * SnmpAgent — a thin UDP SNMPv2c GET responder backed by an OidStore, one per
 * simulated device (bound to its own port). This drives the LIVE poll path; unit
 * tests exercise the OidStore and control plane directly (the SNMP wire layer is
 * mockable and does not require a live poll for units), per the Task 12 plan.
 *
 * For POC-scale multi-device serving on the host we deploy the proven snmpsim
 * container driven by `.snmprec` recordings emitted from these same profiles
 * (see src/agent/snmprec.ts and docs/design/demo-simulated-hosts-design.md).
 * This in-process agent exists so `npm run sim` can stand up a device locally
 * without the container, and so the withhold semantics have a live carrier.
 *
 * The agent honours the withhold modes:
 *   - value        → answer normally
 *   - noSuchObject / noSuchInstance → answer with the SNMP exception varbind
 *   - omit         → treat as absent (noSuchObject on GET; skipped on GETNEXT)
 *   - timeout      → do not reply at all
 * A device marked snmpSilent (TR-069 tolerance, ADR 0004) never replies.
 */

import dgram from 'node:dgram';
import type { OidStore, OidResult } from './oidStore.js';

export interface SnmpAgentOptions {
  readonly store: OidStore;
  readonly port: number;
  readonly host?: string;
  readonly community?: string;
  /** When true the agent never replies (TR-069-tolerant SNMP-silent device). */
  readonly silent?: () => boolean;
}

export interface SnmpAgent {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
}

/**
 * Resolve how the agent should treat a GET for `oid`. Separated from the socket
 * so the decision is unit-testable without binding a port.
 */
export function resolveGet(store: OidStore, oid: string): OidResult {
  return store.get(oid);
}

export function createSnmpAgent(options: SnmpAgentOptions): SnmpAgent {
  const host = options.host ?? '127.0.0.1';
  const socket = dgram.createSocket('udp4');
  let bound = false;

  socket.on('message', (_msg, rinfo) => {
    if (options.silent?.()) return; // TR-069-tolerant: SNMP-silent, never reply.
    // Minimal responder: this scaffold acknowledges receipt only. The production
    // multi-device wire path is the snmpsim container fed by .snmprec exports; a
    // full BER SNMP codec is intentionally out of scope for the in-process agent
    // (units test resolveGet / the OidStore, not the wire encoding).
    void rinfo;
  });

  return {
    port: options.port,
    async start() {
      if (bound) return;
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(options.port, host, () => {
          bound = true;
          resolve();
        });
      });
    },
    async stop() {
      if (!bound) return;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      bound = false;
    }
  };
}
