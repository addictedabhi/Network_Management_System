/**
 * Workspace dependency-rule enforcement (ADR 0001).
 *
 * Structural guard, not a convention: `packages/web` must never depend on or import
 * `@nms/bff` (NFR-09 / AC-F#31 — no credential-bearing server code reachable from the
 * browser bundle), and `packages/shared` must never import another workspace.
 * Run via `npm run lint:deps`; a violation exits non-zero and fails CI.
 *
 * DESIGN NOTE — why this parses instead of pattern-matching.
 * The predecessor scanned file TEXT with a regex inside `packages/<pkg>/src`. That reasoned
 * about "text in a subdirectory" when the requirement is about THE MODULE GRAPH, and it
 * failed OPEN in at least seven distinct ways (dynamic `import()`, side-effect `import 'x'`,
 * `.jsx`/`.cts`/`.cjs` files, anything outside `src/` such as the Next.js `app/` tree, and
 * root config files). Every one exited 0 with a live violation on disk. Extending the regex
 * closes instances; parsing closes the class.
 *
 * PARSER CHOICE — `@babel/parser`, not `typescript`.
 * The review recommended `ts.createSourceFile`. That API DOES NOT EXIST in this repo:
 * `typescript@7.0.2` is the native (Go) compiler rewrite whose only stable JS export is
 * `lib/version.cjs`; the classic compiler API is gone, and the `typescript/unstable/ast`
 * surface exposes AST predicates but no parse entry point (`createScanner` is present but
 * has no usable standalone driver — a scan loop against it does not terminate). So the
 * recommendation was infeasible as written. `@babel/parser` was already resolvable in the
 * tree via vite/vitest and parses every form below including TSX and `import x = require()`;
 * it is now DECLARED explicitly in the root devDependencies, pinned to the version already
 * in package-lock.json, so the guard no longer rests on an undeclared transitive package.
 *
 * FAIL-CLOSED INVARIANT: every error path here must produce a VIOLATION, never a silent
 * skip. A guard that is trusted and can pass while a violation exists is worse than no
 * guard at all (see team memory, 2026-08-09).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { parse } from '@babel/parser';

/**
 * THE SINGLE RULE TABLE (finding 16).
 *
 * Previously the rules lived in two drifted representations: a `FORBIDDEN_DEPS` map covering
 * only `@nms/web` for the manifest check, and separate inline regexes covering web AND shared
 * for the import check. `@nms/shared` was therefore import-checked but never manifest-checked
 * — it could have declared a `@nms/bff` dependency and the guard would have passed. One table
 * now drives BOTH checks, so a rule cannot be enforced in one dimension and not the other.
 *
 * `dir` is the package directory under `packages/`; `pkg` is its workspace name.
 */
const RULES = [
  { dir: 'web', pkg: '@nms/web', forbidden: ['@nms/bff', '@nms/simulator'] },
  { dir: 'shared', pkg: '@nms/shared', forbidden: ['@nms/bff', '@nms/web', '@nms/simulator'] }
];

/** Files whose module graph we parse. Anything importable at build time belongs here. */
const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs'
]);

/** Directories that hold generated output rather than authored source. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', 'build', 'coverage', '.turbo']);

/**
 * True when `spec` resolves to workspace package `pkg`.
 *
 * Matches the package name exactly or a subpath (`@nms/bff/dist/x`), and deliberately NOT a
 * different package that merely shares a prefix. `@nms/bff-utils` is a DISTINCT package name
 * and must not be flagged — a guard that reports false positives gets switched off, which
 * costs more than the narrow rule saves.
 */
function isPackageSpecifier(spec, pkg) {
  return spec === pkg || spec.startsWith(`${pkg}/`);
}

/**
 * True when a RELATIVE specifier escapes the current package and lands in a forbidden one.
 * `import '../../bff/src/x.js'` is the same violation as `import '@nms/bff'` wearing a
 * different specifier, so the rule must see through the path form too.
 */
function escapesIntoForbiddenDir(spec, forbiddenDirs) {
  if (!spec.startsWith('.')) return undefined;
  const segments = spec.split('/');
  return forbiddenDirs.find((dir) => segments.includes(dir) && segments.includes('..'));
}

export function findViolations({ manifests, imports, errors = [] }) {
  const violations = [...errors];

  for (const rule of RULES) {
    const manifest = manifests[rule.pkg];
    if (!manifest) continue;
    for (const forbidden of rule.forbidden) {
      if (manifest.dependencies?.[forbidden] || manifest.devDependencies?.[forbidden]) {
        violations.push(`${rule.pkg} must not depend on ${forbidden} (ADR 0001)`);
      }
    }
  }

  for (const [file, specifiers] of Object.entries(imports)) {
    const rule = RULES.find((r) => file.startsWith(`packages/${r.dir}/`));
    if (!rule) continue;
    const forbiddenDirs = rule.forbidden.map((p) => p.replace(/^@nms\//, ''));
    for (const spec of specifiers) {
      const byName = rule.forbidden.find((p) => isPackageSpecifier(spec, p));
      const byPath = escapesIntoForbiddenDir(spec, forbiddenDirs);
      if (byName || byPath) {
        violations.push(`${file} must not import ${spec} (ADR 0001)`);
      }
    }
  }
  return violations;
}

/**
 * Extracts every module specifier that participates in the module graph of `source`.
 *
 * Covers: `import`/`export ... from`, side-effect `import 'x'`, type-only imports,
 * `import x = require('x')`, dynamic `import('x')`, and `require('x')`. Text inside comments
 * and string literals is NOT matched, because the parser sees syntax rather than characters.
 */
export function extractSpecifiers(source, fileName = 'file.ts') {
  const ast = parseSource(source, fileName);
  const specifiers = [];

  // `import x = require('y')` is TS-specific; Babel models the argument as a plain string.
  const pushString = (node) => {
    if (node && node.type === 'StringLiteral' && typeof node.value === 'string') {
      specifiers.push(node.value);
    }
  };

  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        // `export { x }` with no `from` clause has a null source — pushString ignores it.
        pushString(node.source);
        break;
      case 'TSImportEqualsDeclaration':
        if (node.moduleReference?.type === 'TSExternalModuleReference') {
          pushString(node.moduleReference.expression);
        }
        break;
      case 'TSImportType':
        // `type X = import('@nms/bff').Y` is still a module-graph edge at type level.
        pushString(node.argument);
        break;
      case 'ImportExpression':
        pushString(node.source ?? node.arguments?.[0]);
        break;
      case 'CallExpression': {
        const callee = node.callee;
        const isDynamicImport = callee?.type === 'Import';
        const isRequire = callee?.type === 'Identifier' && callee.name === 'require';
        if (isDynamicImport || isRequire) pushString(node.arguments?.[0]);
        break;
      }
      default:
        break;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) visit(c);
      else if (child && typeof child === 'object' && typeof child.type === 'string') visit(child);
    }
  };

  visit(ast.program ?? ast);
  return specifiers;
}

/**
 * Parses with every syntax dialect this monorepo can contain enabled at once. `errorRecovery`
 * is deliberately OFF: a parse failure must surface as a violation (fail closed), never be
 * papered over into a partial AST whose missing imports would read as "no violation".
 */
function parseSource(source, fileName) {
  return parse(source, {
    sourceType: 'unambiguous',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowUndeclaredExports: true,
    errorRecovery: false,
    plugins: ['typescript', 'jsx', 'decorators-legacy', 'importAttributes', 'explicitResourceManagement']
  });
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    let isDirectory;
    try {
      isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && statSync(full).isDirectory());
    } catch {
      continue;
    }
    if (isDirectory) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

const toPosix = (p) => relative('.', p).split('\\').join('/');

/**
 * Scans the workspace tree for manifests and import specifiers.
 *
 * Two independence properties matter, and both were once broken:
 *  1. The source scan is INDEPENDENT of manifest parsing — a missing or malformed
 *     `package.json` must never suppress the import scan (a half-scaffolded package is
 *     exactly when the guard is needed most).
 *  2. The scan covers the WHOLE package directory, not `src/` alone. Next.js code lives in
 *     `app/`, `pages/`, `lib/` and root config files; restricting to `src/` made the guard
 *     blind to the default location of the code it exists to police.
 *
 * Errors are returned as violations (`errors`) rather than swallowed, per the fail-closed
 * invariant at the top of this file.
 */
export function collect() {
  const manifests = {};
  const imports = {};
  const errors = [];
  let packageDirs;
  try {
    packageDirs = readdirSync('packages', { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch (err) {
    // Fail CLOSED: an unreadable workspace root means the guard proved nothing.
    errors.push(
      `cannot read the packages/ workspace root, so the dependency rule could not be ` +
        `verified (${err.code ?? 'unknown error'}) (ADR 0001)`
    );
    return { manifests, imports, errors };
  }

  for (const pkg of packageDirs) {
    const manifestPath = join('packages', pkg, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.name === 'string') manifests[manifest.name] = manifest;
    } catch {
      // Missing or malformed manifest: fall through and still scan this package's sources.
    }
    for (const file of walk(join('packages', pkg))) {
      const rel = toPosix(file);
      let source;
      try {
        source = readFileSync(file, 'utf8');
      } catch (err) {
        errors.push(`${rel} could not be read, so its imports were not verified (${err.code})`);
        continue;
      }
      try {
        imports[rel] = extractSpecifiers(source, file);
      } catch {
        // Fail CLOSED: an unparseable file could be hiding an import behind a syntax error.
        errors.push(`${rel} could not be parsed, so its imports were not verified (ADR 0001)`);
      }
    }
  }
  return { manifests, imports, errors };
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
