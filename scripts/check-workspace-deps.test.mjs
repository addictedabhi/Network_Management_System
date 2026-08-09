import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findViolations, collect } from './check-workspace-deps.mjs';

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

test('collect() scans sources even when the package manifest is missing', () => {
  withFixture(
    (root) => {
      const dir = join(root, 'packages', 'web', 'src');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'x.ts'), "import { a } from '@nms/bff';\n");
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
      const dir = join(root, 'packages', 'web', 'src');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(root, 'packages', 'web', 'package.json'), '{ not valid json');
      writeFileSync(join(dir, 'x.ts'), "import { a } from '@nms/bff';\n");
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
      const dir = join(root, 'packages', 'web', 'src');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(root, 'packages', 'web', 'package.json'),
        JSON.stringify({ name: '@nms/web', dependencies: { '@nms/shared': '*' } })
      );
      writeFileSync(join(dir, 'x.ts'), "import { a } from '@nms/shared';\n");
    },
    () => {
      assert.deepEqual(findViolations(collect()), []);
    }
  );
});
