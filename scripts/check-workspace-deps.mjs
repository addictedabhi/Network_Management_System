/**
 * Workspace dependency-rule enforcement (ADR 0001).
 *
 * Structural guard, not a convention: `packages/web` must never depend on or import
 * `@nms/bff` (NFR-09 / AC-F#31 — no credential-bearing server code reachable from the
 * browser bundle), and `packages/shared` must never import another workspace.
 * Run via `npm run lint:deps`; a violation exits non-zero and fails CI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FORBIDDEN_DEPS = { '@nms/web': ['@nms/bff', '@nms/simulator'] };
const IMPORT_RE = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

export function findViolations({ manifests, imports }) {
  const violations = [];
  for (const [name, manifest] of Object.entries(manifests)) {
    for (const forbidden of FORBIDDEN_DEPS[name] ?? []) {
      if (manifest.dependencies?.[forbidden] || manifest.devDependencies?.[forbidden]) {
        violations.push(`${name} must not depend on ${forbidden} (ADR 0001)`);
      }
    }
  }
  for (const [file, specifiers] of Object.entries(imports)) {
    for (const spec of specifiers) {
      if (file.startsWith('packages/web/') && /(^@nms\/(bff|simulator)|\.\.\/bff)/.test(spec)) {
        violations.push(`${file} must not import ${spec} (ADR 0001)`);
      }
      if (file.startsWith('packages/shared/') && /^@nms\/(bff|web|simulator)/.test(spec)) {
        violations.push(`${file} must not import ${spec} (ADR 0001)`);
      }
    }
  }
  return violations;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Scans the workspace tree for manifests and import specifiers.
 *
 * The source scan is deliberately INDEPENDENT of manifest parsing: a missing or malformed
 * `package.json` must never suppress the import scan, or the guard fails open exactly when
 * a package is half-scaffolded (NFR-09 / AC-F#31). Violations are keyed by directory path,
 * which is what the rules in `findViolations` match on, so an unparsed manifest costs us
 * only the declared-dependency check for that package — never the import check.
 */
export function collect() {
  const manifests = {};
  const imports = {};
  let packageDirs;
  try {
    packageDirs = readdirSync('packages');
  } catch {
    return { manifests, imports };
  }
  for (const pkg of packageDirs) {
    const manifestPath = join('packages', pkg, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.name === 'string') manifests[manifest.name] = manifest;
    } catch {
      // Missing or malformed manifest: fall through and still scan this package's sources.
    }
    for (const file of walk(join('packages', pkg, 'src'))) {
      const source = readFileSync(file, 'utf8');
      const specs = [];
      for (const match of source.matchAll(IMPORT_RE)) specs.push(match[1] ?? match[2]);
      imports[relative('.', file).split('\\').join('/')] = specs;
    }
  }
  return { manifests, imports };
}

if (process.argv[1]?.endsWith('check-workspace-deps.mjs')) {
  const violations = findViolations(collect());
  if (violations.length) {
    console.error('Workspace dependency rule violations (ADR 0001):');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log('Workspace dependency rule: OK');
}
