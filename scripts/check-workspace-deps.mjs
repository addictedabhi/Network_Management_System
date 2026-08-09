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

/**
 * Reduces a specifier node to its string value, or `undefined` when it cannot be proven.
 *
 * Only forms whose value is fixed at parse time are resolved:
 *  - `StringLiteral` — `import('@nms/bff')`
 *  - `TemplateLiteral` with NO expressions — ``import(`@nms/bff`)``. This is a valid ESM
 *    specifier that resolves identically to the quoted form, so treating it as unresolvable
 *    would be a false positive; `cooked` is the escape-processed value.
 *
 * Everything else returns `undefined` ON PURPOSE. A `TemplateLiteral` with expressions, a
 * `BinaryExpression`, an `Identifier`, a call, a conditional — their targets depend on runtime
 * state, so no static analysis can prove where the edge points. `cooked` can also legitimately
 * be `undefined` for an invalid escape sequence, which is likewise unprovable.
 */
function staticStringValue(node) {
  if (node.type === 'StringLiteral' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    const cooked = node.quasis[0]?.value?.cooked;
    if (typeof cooked === 'string') return cooked;
  }
  return undefined;
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
    // Packages with no forbidden-import rule are unconstrained. This scoping is what keeps the
    // unresolvable-specifier rule below from firing across the whole monorepo: `bff` may use a
    // dynamic `import()` freely, because there is no target it is forbidden to reach.
    const rule = RULES.find((r) => file.startsWith(`packages/${r.dir}/`));
    if (!rule) continue;
    const forbiddenDirs = rule.forbidden.map((p) => p.replace(/^@nms\//, ''));
    for (const spec of specifiers) {
      // FAIL CLOSED (finding 20): a specifier that cannot be reduced to a string is a module
      // edge whose target is unknown. In a package that must never reach `@nms/bff`, an
      // unverifiable edge is exactly what should stop the build — the guard cannot claim to
      // have proved something it did not evaluate. The message is deliberately distinct from
      // the forbidden-import message so the required developer action is unambiguous.
      if (spec.kind === 'unresolvable') {
        violations.push(
          `${file} has an unresolvable module specifier (${spec.nodeType}), so it cannot be ` +
            `proven safe — use a static string literal for imports in ${rule.pkg} (ADR 0001)`
        );
        continue;
      }
      const byName = rule.forbidden.find((p) => isPackageSpecifier(spec.value, p));
      const byPath = escapesIntoForbiddenDir(spec.value, forbiddenDirs);
      if (byName || byPath) {
        violations.push(`${file} must not import ${spec.value} (ADR 0001)`);
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

  /**
   * Records one specifier node, classified.
   *
   * FINDING 20 — this function used to accept ONLY `StringLiteral` and silently drop every
   * other node type, so ``import(`@nms/bff`)`` contributed nothing and the guard exited 0 with
   * a live violation on disk. Silence is not an acceptable outcome for a node we reached:
   * having found a real module-graph edge, the guard must either resolve it or declare that it
   * could not. Anything unresolved becomes `{ kind: 'unresolvable' }`, which `findViolations`
   * turns into a violation for any package carrying a forbidden-import rule.
   *
   * `required` distinguishes the two absent-node cases, which are NOT the same thing:
   *  - `required: false` — no specifier node exists because the syntax has none. `export { x }`
   *    with no `from` clause is a local re-export; there is no module edge to prove anything
   *    about, so silence is correct.
   *  - `required: true` — an import CONSTRUCT was found but its argument is missing, e.g. a
   *    bare `require()`. That parses as valid JS, so it reached here rather than failing closed
   *    at parse time. It cannot be resolved, therefore it is reported. (Found while auditing
   *    every error path in this file against the invariant above; narrow, since a
   *    zero-argument call cannot name a forbidden package — but the invariant admits no
   *    silent skips, and "narrow today" is how the previous three fail-opens began.)
   */
  const pushSpecifier = (node, { required = false } = {}) => {
    if (!node) {
      if (required) specifiers.push({ kind: 'unresolvable', nodeType: 'MissingArgument' });
      return;
    }
    const value = staticStringValue(node);
    if (value !== undefined) specifiers.push({ kind: 'resolved', value });
    else specifiers.push({ kind: 'unresolvable', nodeType: node.type });
  };

  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        // `export { x }` with no `from` clause has a null source — no module edge exists.
        pushSpecifier(node.source);
        break;
      case 'TSImportEqualsDeclaration':
        if (node.moduleReference?.type === 'TSExternalModuleReference') {
          pushSpecifier(node.moduleReference.expression);
        }
        break;
      case 'TSImportType':
        // `type X = import('@nms/bff').Y` is still a module-graph edge at type level.
        pushSpecifier(node.argument);
        break;
      case 'ImportExpression':
        // An `import()` with no argument is a real import construct with nothing to resolve.
        pushSpecifier(node.source ?? node.arguments?.[0], { required: true });
        break;
      case 'CallExpression': {
        const callee = node.callee;
        const isDynamicImport = callee?.type === 'Import';
        const isRequire = callee?.type === 'Identifier' && callee.name === 'require';
        if (isDynamicImport || isRequire) {
          pushSpecifier(node.arguments?.[0], { required: true });
        }
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

/**
 * Recursively collects scannable files under `dir`, appending any I/O failure to `errors`.
 *
 * FAIL-CLOSED (finding 20 alignment): both catches below previously swallowed the error —
 * `readdirSync` did `return out` and `statSync` did `continue`. An unreadable subdirectory or a
 * broken symlink therefore removed files from the scan with no trace, so the guard could pass
 * while an unscanned file held a real violation. That is the same fail-open shape as the
 * silent specifier drop, and it is now reported instead.
 *
 * @param dir directory to walk
 * @param out accumulator of scannable file paths
 * @param errors accumulator of violation strings for paths that could not be inspected
 * @param readDir injectable directory reader; the default is the real filesystem. This seam
 *   exists so the two fail-closed branches above can be proven by tests on any platform —
 *   a broken symlink requires elevation on Windows, and an untestable safety branch is
 *   indistinguishable from the silent skip it replaced.
 */
export function walk(dir, out = [], errors = [], readDir = defaultReadDir) {
  let entries;
  try {
    entries = readDir(dir);
  } catch (err) {
    errors.push(
      `${toPosix(dir)} could not be read, so the files beneath it were not verified ` +
        `(${err.code ?? 'unknown error'}) (ADR 0001)`
    );
    return out;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    let isDirectory;
    try {
      isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && statSync(full).isDirectory());
    } catch (err) {
      errors.push(
        `${toPosix(full)} could not be inspected, so it was not verified ` +
          `(${err.code ?? 'unknown error'}) (ADR 0001)`
      );
      continue;
    }
    if (isDirectory) walk(full, out, errors, readDir);
    else if (SCANNED_EXTENSIONS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

/**
 * The real filesystem directory reader used by `walk` in production.
 *
 * Declared as a `function` rather than a `const` arrow so it is hoisted: `walk` names it as a
 * default parameter value above this point, which would be a temporal-dead-zone error for a
 * `const` if `walk` were ever called during module initialization.
 */
function defaultReadDir(dir) {
  return readdirSync(dir, { withFileTypes: true });
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
    // `errors` is threaded in so an unreadable subdirectory or broken symlink surfaces as a
    // violation instead of quietly shrinking the scan (fail-closed invariant).
    for (const file of walk(join('packages', pkg), [], errors)) {
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
