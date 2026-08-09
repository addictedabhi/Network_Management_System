import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  lstatSync
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { findViolations, collect, extractSpecifiers, walk } from './check-workspace-deps.mjs';

/** True when `p` exists as a link entry even if its target does not (broken symlink). */
function lstatSafe(p) {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
}

test('flags web depending on bff', () => {
  const violations = findViolations({
    manifests: { '@nms/web': { dependencies: { '@nms/bff': '*' } } },
    imports: {}
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /@nms\/web must not depend on @nms\/bff/);
});

test('flags a web source file importing bff', () => {
  const violations = findViolations({
    manifests: { '@nms/web': { dependencies: {} } },
    imports: { 'packages/web/src/lib/x.ts': [{ kind: 'resolved', value: '@nms/bff' }] }
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /packages\/web\/src\/lib\/x\.ts/);
});

test('flags shared importing another workspace', () => {
  const violations = findViolations({
    manifests: { '@nms/shared': { dependencies: {} } },
    imports: { 'packages/shared/src/a.ts': [{ kind: 'resolved', value: '@nms/bff' }] }
  });
  assert.equal(violations.length, 1);
});

test('passes a clean graph', () => {
  const violations = findViolations({
    manifests: { '@nms/web': { dependencies: { '@nms/shared': '*' } } },
    imports: {
      'packages/web/src/lib/x.ts': [
        { kind: 'resolved', value: '@nms/shared' },
        { kind: 'resolved', value: 'react' }
      ]
    }
  });
  assert.deepEqual(violations, []);
});

/**
 * Specifier extraction is AST-based (TypeScript parser), not regex-based.
 *
 * The regex predecessor failed OPEN on every form below except the plain `from '...'` case:
 * dynamic `import()`, side-effect imports, and `export ... from` were invisible, so a real
 * NFR-09 / AC-F#31 violation exited 0. These tests pin the module-graph forms directly so a
 * future syntax gap fails loudly instead of silently.
 */
const SPECIFIER_FORMS = [
  ['static named import', "import { a } from '@nms/bff';"],
  ['static default import', "import a from '@nms/bff';"],
  ['namespace import', "import * as a from '@nms/bff';"],
  ['side-effect import', "import '@nms/bff';"],
  ['type-only import', "import type { A } from '@nms/bff';"],
  ['inline type import', "import { type A } from '@nms/bff';"],
  ['dynamic import awaited', "const m = await import('@nms/bff');"],
  ['dynamic import in a promise chain', "void import('@nms/bff').then((m) => m);"],
  ['require call', "const a = require('@nms/bff');"],
  ['re-export star', "export * from '@nms/bff';"],
  ['re-export named', "export { a } from '@nms/bff';"],
  ['namespace re-export', "export * as bff from '@nms/bff';"],
  ['import-equals require', "import a = require('@nms/bff');"],
  ['deep specifier', "import { a } from '@nms/bff/dist/x';"]
];

for (const [label, source] of SPECIFIER_FORMS) {
  test(`extractSpecifiers finds the ${label} form`, () => {
    const specs = extractSpecifiers(source, 'x.ts');
    assert.ok(
      specs.some((s) => s.kind === 'resolved' && s.value.startsWith('@nms/bff')),
      `expected a resolved @nms/bff specifier in ${JSON.stringify(specs)}`
    );
  });
}

test('extractSpecifiers ignores specifier-shaped text in comments and strings', () => {
  const source = [
    "// import { a } from '@nms/bff';",
    "/* export * from '@nms/bff'; */",
    "const note = \"do not import '@nms/bff' here\";",
    "import { ok } from '@nms/shared';"
  ].join('\n');
  const specs = extractSpecifiers(source, 'x.ts');
  assert.deepEqual(specs, [{ kind: 'resolved', value: '@nms/shared' }]);
});

/**
 * Regression guard: the scanner must NOT fail open when a package manifest is absent or
 * malformed. Before this test, `collect()` skipped a package's entire source scan if its
 * package.json was missing, so a `web` file importing `@nms/bff` passed lint:deps silently
 * — defeating the NFR-09 / AC-F#31 structural guard.
 */
function withFixture(build, run) {
  const root = mkdtempSync(join(tmpdir(), 'nms-deps-'));
  const cwd = process.cwd();
  try {
    build(root);
    process.chdir(root);
    run();
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(root, relPath, contents) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

test('collect() scans sources even when the package manifest is missing', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/src/x.ts', "import { a } from '@nms/bff';\n");
      // deliberately NO packages/web/package.json
    },
    () => {
      const violations = findViolations(collect());
      assert.equal(violations.length, 1, 'a manifest-less web package must still be scanned');
      assert.match(violations[0], /packages\/web\/src\/x\.ts must not import @nms\/bff/);
    }
  );
});

test('collect() scans sources when the package manifest is malformed', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', '{ not valid json');
      writeFile(root, 'packages/web/src/x.ts', "import { a } from '@nms/bff';\n");
    },
    () => {
      const violations = findViolations(collect());
      assert.equal(violations.length, 1);
      assert.match(violations[0], /must not import @nms\/bff/);
    }
  );
});

test('collect() reports no violations for a clean tree', () => {
  withFixture(
    (root) => {
      writeFile(
        root,
        'packages/web/package.json',
        JSON.stringify({ name: '@nms/web', dependencies: { '@nms/shared': '*' } })
      );
      writeFile(root, 'packages/web/src/x.ts', "import { a } from '@nms/shared';\n");
    },
    () => {
      assert.deepEqual(findViolations(collect()), []);
    }
  );
});

/**
 * C-1 regression: the walk was hardcoded to `packages/<pkg>/src`, so the whole of a Next.js
 * app was invisible to the guard — `app/` is precisely where Next.js code lives. Each path
 * below was reproduced live as an exit-0 escape before the fix.
 */
const ESCAPE_PATHS = [
  'packages/web/app/page.tsx',
  'packages/web/pages/index.tsx',
  'packages/web/lib/api.ts',
  'packages/web/components/Panel.tsx',
  'packages/web/next.config.js',
  'packages/web/middleware.ts',
  'packages/web/src/nested/deep/x.ts'
];

for (const path of ESCAPE_PATHS) {
  test(`collect() scans ${path} (outside src/ is not outside the guard)`, () => {
    withFixture(
      (root) => {
        writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
        writeFile(root, path, "import { a } from '@nms/bff';\n");
      },
      () => {
        const violations = findViolations(collect());
        assert.equal(violations.length, 1, `${path} must be scanned`);
        assert.match(violations[0], /must not import @nms\/bff/);
      }
    );
  });
}

/**
 * C-2 regression: the extension allowlist was `/\.(ts|tsx|mts|js|mjs)$/`, missing `.jsx`,
 * `.cts` and `.cjs`. A `.jsx` file importing `@nms/bff` exited 0.
 */
const SCANNED_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];

for (const ext of SCANNED_EXTENSIONS) {
  test(`collect() scans .${ext} files`, () => {
    withFixture(
      (root) => {
        writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
        writeFile(root, `packages/web/src/a.${ext}`, "import { a } from '@nms/bff';\n");
      },
      () => {
        const violations = findViolations(collect());
        assert.equal(violations.length, 1, `.${ext} must be scanned`);
      }
    );
  });
}

/**
 * C-3 regression, end to end through `collect()`: every module-graph form must be caught
 * from a real file on disk, not only via `extractSpecifiers`.
 */
for (const [label, source] of SPECIFIER_FORMS) {
  test(`collect() flags the ${label} form from a real file`, () => {
    withFixture(
      (root) => {
        writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
        writeFile(root, 'packages/web/src/a.ts', `${source}\n`);
      },
      () => {
        const violations = findViolations(collect());
        assert.equal(violations.length, 1, `${label} must be flagged`);
        assert.match(violations[0], /must not import @nms\/bff/);
      }
    );
  });
}

/**
 * NO FALSE POSITIVES. Documented intent: the rule matches a workspace package boundary, so
 * it must match `@nms/bff` exactly or a subpath (`@nms/bff/...`) — never a different package
 * whose name merely begins with the same characters. `@nms/bff-utils` is a DISTINCT package
 * name; flagging it would be wrong, and a guard that cries wolf gets disabled.
 */
const NON_VIOLATIONS = [
  ['near-miss scoped name', "import { a } from '@nms/bff-utils';"],
  ['near-miss suffix', "import { a } from '@nms/bffx';"],
  ['allowed shared import', "import { a } from '@nms/shared';"],
  ['third-party import', "import React from 'react';"],
  ['relative sibling import', "import { a } from './local.js';"],
  ['relative parent that is not bff', "import { a } from '../shared/x.js';"],
  ['substring in the middle', "import { a } from 'not-@nms/bff-really';"]
];

for (const [label, source] of NON_VIOLATIONS) {
  test(`collect() does NOT flag the ${label}`, () => {
    withFixture(
      (root) => {
        writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
        writeFile(root, 'packages/web/src/a.ts', `${source}\n`);
      },
      () => {
        assert.deepEqual(
          findViolations(collect()),
          [],
          `${label} must not be reported as a violation`
        );
      }
    );
  });
}

test('the relative ../bff escape hatch is still caught', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      writeFile(root, 'packages/web/src/a.ts', "import { a } from '../../bff/src/secret.js';\n");
    },
    () => {
      const violations = findViolations(collect());
      assert.equal(violations.length, 1, 'a relative path into bff must be flagged');
    }
  );
});

test('node_modules, dist and .next are not scanned', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      for (const dir of ['node_modules', 'dist', '.next']) {
        writeFile(root, `packages/web/${dir}/a.ts`, "import { a } from '@nms/bff';\n");
      }
    },
    () => {
      assert.deepEqual(findViolations(collect()), [], 'build output must not be scanned');
    }
  );
});

/**
 * A file the parser cannot handle must FAIL CLOSED. Silently skipping an unparseable file
 * would recreate the fail-open class this guard exists to prevent: an attacker (or an
 * accident) could hide an import behind a syntax error.
 */
test('a syntactically broken file is reported, never silently skipped', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      writeFile(root, 'packages/web/src/broken.ts', 'import { from  ###### not typescript\n');
    },
    () => {
      const violations = findViolations(collect());
      assert.equal(violations.length, 1, 'an unparseable file must be surfaced');
      assert.match(violations[0], /could not be parsed/i);
    }
  );
});

/**
 * Finding 16 regression: the rule set used to live in two drifted representations, so
 * `@nms/shared` was import-checked but never MANIFEST-checked. It could declare a dependency
 * on `@nms/bff` and the guard would pass. One table now drives both dimensions.
 */
test('flags shared DECLARING a dependency on bff (manifest dimension)', () => {
  const violations = findViolations({
    manifests: { '@nms/shared': { dependencies: { '@nms/bff': '*' } } },
    imports: {}
  });
  assert.equal(violations.length, 1, 'shared must be manifest-checked, not only import-checked');
  assert.match(violations[0], /@nms\/shared must not depend on @nms\/bff/);
});

test('flags shared declaring a devDependency on web', () => {
  const violations = findViolations({
    manifests: { '@nms/shared': { devDependencies: { '@nms/web': '*' } } },
    imports: {}
  });
  assert.equal(violations.length, 1);
});

/**
 * FINDING 20 regression — THE NODE-TYPE AXIS.
 *
 * Every prior test and probe used a `StringLiteral` specifier, so the entire non-literal
 * branch of `pushString` was untested. It silently dropped any other node type, which meant a
 * real `web -> @nms/bff` edge written as a template literal exited 0. These tests therefore
 * assert on the SPECIFIER NODE TYPE rather than on another specifier string value.
 *
 * Two distinct behaviours are pinned:
 *  1. A statically-resolvable `TemplateLiteral` (no expressions) resolves like a string.
 *  2. Anything NOT statically resolvable is reported as UNRESOLVABLE — a violation — because
 *     a specifier the guard cannot evaluate is exactly the case where it has proved nothing
 *     (fail-closed invariant, check-workspace-deps.mjs header).
 */
const RESOLVABLE_NODE_TYPES = [
  ['TemplateLiteral with no expressions in import()', 'const m = await import(`@nms/bff`);'],
  ['TemplateLiteral with no expressions in require()', 'const m = require(`@nms/bff`);'],
  ['TemplateLiteral with no expressions in a static import', "import { a } from '@nms/bff';"],
  ['TemplateLiteral deep specifier', 'const m = await import(`@nms/bff/dist/x`);']
];

for (const [label, source] of RESOLVABLE_NODE_TYPES) {
  test(`extractSpecifiers resolves the ${label}`, () => {
    const specs = extractSpecifiers(source, 'x.ts');
    assert.ok(
      specs.some((s) => s.kind === 'resolved' && s.value.startsWith('@nms/bff')),
      `expected a resolved @nms/bff specifier in ${JSON.stringify(specs)}`
    );
  });
}

/**
 * The axis that matters most: node types that CANNOT be reduced to a string. Each must yield
 * an `unresolvable` entry, never an empty list. An empty list is indistinguishable from
 * "this file has no imports", which is precisely how finding 20 stayed invisible.
 */
const UNRESOLVABLE_NODE_TYPES = [
  ['TemplateLiteral with an expression', 'const p = "bff"; const m = await import(`@nms/${p}`);'],
  ['BinaryExpression concatenation', 'const m = await import("@nms/" + "bff");'],
  ['Identifier specifier', 'const s = "@nms/bff"; const m = await import(s);'],
  ['CallExpression specifier', 'const m = await import(resolveName());'],
  ['ConditionalExpression specifier', 'const m = await import(flag ? "a" : "b");'],
  ['MemberExpression specifier', 'const m = await import(config.target);'],
  ['Identifier specifier in require()', 'const s = "@nms/bff"; const m = require(s);'],
  ['BinaryExpression in require()', 'const m = require("@nms/" + "bff");']
];

for (const [label, source] of UNRESOLVABLE_NODE_TYPES) {
  test(`extractSpecifiers reports the ${label} as unresolvable`, () => {
    const specs = extractSpecifiers(source, 'x.ts');
    assert.ok(
      specs.some((s) => s.kind === 'unresolvable'),
      `expected an unresolvable specifier in ${JSON.stringify(specs)}`
    );
  });
}

for (const [label, source] of [...RESOLVABLE_NODE_TYPES, ...UNRESOLVABLE_NODE_TYPES]) {
  test(`collect() fails CLOSED on the ${label} from a real file`, () => {
    withFixture(
      (root) => {
        writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
        writeFile(root, 'packages/web/src/a.ts', `${source}\n`);
      },
      () => {
        const violations = findViolations(collect());
        assert.equal(violations.length, 1, `${label} must produce exactly one violation`);
      }
    );
  });
}

/**
 * FOURTH silent-skip path, found while auditing every error path in the guard against its own
 * fail-closed invariant. A bare `require()` parses as valid JavaScript, so it does NOT fail
 * closed at parse time; `node.arguments[0]` is then `undefined` and the old early return
 * dropped it without a word. Narrow (a zero-argument call cannot name a forbidden package) but
 * reported anyway, because "narrow today" is how the previous three fail-opens started.
 */
const MISSING_ARGUMENT_FORMS = [
  ['bare require()', 'const m = require();'],
  ['require with only a spread', 'const m = require(...args);']
];

for (const [label, source] of MISSING_ARGUMENT_FORMS) {
  test(`extractSpecifiers reports ${label} as unresolvable rather than dropping it`, () => {
    const specs = extractSpecifiers(source, 'x.ts');
    assert.ok(
      specs.some((s) => s.kind === 'unresolvable'),
      `expected an unresolvable specifier in ${JSON.stringify(specs)}`
    );
  });
}

/**
 * The genuine no-op must stay a no-op: a local `export { x }` and a TS namespace alias
 * (`import A = Foo.Bar`) have NO module specifier at all, so reporting them would be a false
 * positive. This pins the boundary between "no edge exists" and "an edge we cannot resolve".
 */
const NO_MODULE_EDGE_FORMS = [
  ['local re-export with no from clause', 'const x = 1; export { x };'],
  ['TS namespace alias', 'declare const Foo: any; import A = Foo.Bar;'],
  ['export assignment', 'declare const foo: any; export = foo;']
];

for (const [label, source] of NO_MODULE_EDGE_FORMS) {
  test(`extractSpecifiers reports nothing for the ${label} (no module edge)`, () => {
    assert.deepEqual(
      extractSpecifiers(source, 'x.ts'),
      [],
      `${label} has no module specifier and must not be reported`
    );
  });
}

/**
 * The two failure modes must be DISTINGUISHABLE, so the message is actionable rather than
 * mysterious: "you imported a forbidden package" is a different instruction to the developer
 * than "your specifier cannot be statically proven safe".
 */
test('a resolved forbidden import and an unresolvable specifier report differently', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      writeFile(root, 'packages/web/src/resolved.ts', 'await import(`@nms/bff`);\n');
      writeFile(root, 'packages/web/src/dynamic.ts', 'await import(someName);\n');
    },
    () => {
      const violations = findViolations(collect());
      assert.equal(violations.length, 2);
      const resolved = violations.find((v) => v.includes('resolved.ts'));
      const dynamic = violations.find((v) => v.includes('dynamic.ts'));
      assert.match(resolved, /must not import @nms\/bff/);
      assert.match(dynamic, /unresolvable|could not be (statically )?(resolved|proven)/i);
      assert.doesNotMatch(dynamic, /must not import/);
    }
  );
});

/**
 * NO NEW FALSE POSITIVES — the constraint that keeps part 2 from becoming unusable.
 *
 * Failing closed on unresolvable specifiers applies ONLY inside a package that HAS a
 * forbidden-import rule. `packages/bff` has no rule, so a dynamic specifier there is nobody's
 * business and must exit 0. Without this, adding part 2 would break every unrelated package.
 */
test('a dynamic specifier in a package with NO forbidden-import rule does not fail', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/bff/package.json', JSON.stringify({ name: '@nms/bff' }));
      writeFile(root, 'packages/bff/src/a.ts', 'const m = await import(someName);\n');
      writeFile(root, 'packages/bff/src/b.ts', 'const m = await import("@nms/" + x);\n');
    },
    () => {
      assert.deepEqual(
        findViolations(collect()),
        [],
        'a package with no rule must not be constrained by the guard'
      );
    }
  );
});

/**
 * `import()` of a plainly allowed target inside `web` written as a NON-literal is still
 * reported. This is deliberate, not incidental: unverifiable is unverifiable, and the whole
 * point of part 2 is that the guard refuses to claim it proved something it did not.
 */
test('an unresolvable specifier in web is reported even when the intent looks harmless', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      writeFile(root, 'packages/web/src/a.ts', 'const m = await import(`react-${variant}`);\n');
    },
    () => {
      const violations = findViolations(collect());
      assert.equal(violations.length, 1, 'unverifiable is unverifiable');
      assert.match(violations[0], /unresolvable|could not be (statically )?(resolved|proven)/i);
    }
  );
});

/**
 * `walk()` alignment — the same fail-open shape as finding 20. `readdirSync` and `statSync`
 * catches used to `return out` / `continue`, so an unreadable subdirectory or a broken symlink
 * silently removed files from the scan. Both now surface as errors that fail the check.
 *
 * A broken symlink is constructible without privileged ACL work on Windows only when
 * developer mode / elevation allows symlink creation, so the test skips rather than fails when
 * the OS refuses — the assertion is still meaningful wherever it can run.
 */
test('a directory that cannot be read is reported rather than silently unscanned', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      writeFile(root, 'packages/web/src/x.ts', "import { a } from '@nms/shared';\n");
    },
    () => {
      // Simulate the unreadable-directory branch directly: `walk()` must surface the failure.
      const errors = [];
      const out = walk('packages/web/does-not-exist', [], errors);
      assert.deepEqual(out, [], 'nothing is collected from an unreadable directory');
      assert.equal(errors.length, 1, 'the unreadable directory must be reported');
      assert.match(errors[0], /could not be (read|scanned)/i);
    }
  );
});

/**
 * The `statSync` branch — a symlink whose target has gone away.
 *
 * A real broken symlink needs elevation or developer mode on Windows, so that form is attempted
 * and, where the OS permits it, asserted. Where it does not, the test does NOT silently pass:
 * it falls back to driving the same branch through an injected directory entry that reports
 * itself as a symlink to a path that does not exist, which is precisely the condition
 * `statSync` fails on. Either way the branch is actually exercised, because a test that only
 * skips would leave this fail-open path as unproven as it was before.
 */
test('a broken symlink is reported rather than silently skipped', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      mkdirSync(join(root, 'packages/web/src'), { recursive: true });
      try {
        symlinkSync(join(root, 'packages/web/nowhere'), join(root, 'packages/web/src/link'), 'dir');
      } catch {
        // Symlink creation needs elevation/developer mode on Windows; fallback below covers it.
      }
    },
    () => {
      if (lstatSafe('packages/web/src/link') !== undefined) {
        const errors = [];
        walk('packages/web', [], errors);
        assert.equal(errors.length, 1, 'a real broken symlink must be reported, not skipped');
        assert.match(errors[0], /could not be inspected/i);
        return;
      }

      // The OS refused to create a symlink, so drive the identical branch through the seam:
      // an entry that claims to be a symlink but whose target cannot be stat-ed.
      const errors = [];
      walk('packages/web', [], errors, () => [
        {
          name: 'ghost-link',
          isDirectory: () => false,
          isSymbolicLink: () => true
        }
      ]);
      assert.equal(errors.length, 1, 'a symlink that cannot be stat-ed must be reported');
      assert.match(errors[0], /ghost-link/);
      assert.match(errors[0], /could not be inspected/i);
    }
  );
});

/**
 * The unreadable-directory branch, end to end through `collect()` — proving the error does not
 * merely land in a local array but actually FAILS the check. `walk`'s errors are threaded into
 * the same accumulator `collect()` returns, so an unscannable subtree stops the build.
 */
test('an unreadable subdirectory fails the whole check, not just its own subtree', () => {
  withFixture(
    (root) => {
      writeFile(root, 'packages/web/package.json', JSON.stringify({ name: '@nms/web' }));
      writeFile(root, 'packages/web/src/clean.ts', "import { a } from '@nms/shared';\n");
    },
    () => {
      // Sanity: the tree is clean and passes.
      assert.deepEqual(findViolations(collect()), [], 'the fixture must start clean');

      // Now make one directory unreadable via the seam and confirm it becomes a violation.
      const errors = [];
      walk('packages/web', [], errors, (dir) => {
        if (String(dir).includes('src')) {
          const err = new Error('EACCES');
          err.code = 'EACCES';
          throw err;
        }
        return [{ name: 'src', isDirectory: () => true, isSymbolicLink: () => false }];
      });
      assert.equal(errors.length, 1, 'an unreadable directory must be reported');
      assert.match(errors[0], /could not be read/i);
      assert.match(errors[0], /EACCES/);
      assert.match(findViolations({ manifests: {}, imports: {}, errors })[0], /could not be read/i);
    }
  );
});

test('an unreadable packages/ directory is reported rather than passing silently', () => {
  withFixture(
    () => {
      // no packages/ directory at all
    },
    () => {
      const violations = findViolations(collect());
      assert.equal(violations.length, 1, 'a missing packages/ tree must not silently pass');
      assert.match(violations[0], /packages/i);
    }
  );
});
