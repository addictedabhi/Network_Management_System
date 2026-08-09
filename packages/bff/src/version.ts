import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Single source of truth for the BFF version (finding 19).
 *
 * The version was previously triplicated: a hardcoded `'0.1.0'` for `/health`, a
 * `SHARED_PACKAGE_VERSION` constant in the shared package, and the real value in each
 * `package.json`. Three copies drift, and a `/health` endpoint reporting a stale version
 * misleads exactly during an incident, when it is used to confirm what is deployed.
 *
 * Read from the manifest at startup. A hard failure here is preferable to serving traffic
 * that misreports its own version, so this deliberately does not swallow the error.
 */
function readVersion(): string {
  // dist/version.js -> package root is two levels up; src/version.ts resolves the same way
  // under vitest, which serves TypeScript directly from src/.
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = join(here, '..', 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('BFF package.json is missing a usable "version" field');
  }
  return manifest.version;
}

export const BFF_VERSION = readVersion();
