import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { findViolations, collect, extractSpecifiers } from './check-workspace-deps.mjs';

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
    imports: { 'packages/web/src/lib/x.ts': ['@nms/bff'] }
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /packages\/web\/src\/lib\/x\.ts/);
});

test('flags shared importing another workspace', () => {
  const violations = findViolations({
    manifests: { '@nms/shared': { dependencies: {} } },
    imports: { 'packages/shared/src/a.ts': ['@nms/bff'] }
  });
  assert.equal(violations.length, 1);
});

test('passes a clean graph', () => {
  const violations = findViolations({
    manifests: { '@nms/web': { dependencies: { '@nms/shared': '*' } } },
    imports: { 'packages/web/src/lib/x.ts': ['@nms/shared', 'react'] }
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
      specs.some((s) => s.startsWith('@nms/bff')),
      `expected @nms/bff in [${specs.join(', ')}]`
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
  assert.deepEqual(specs, ['@nms/shared']);
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
