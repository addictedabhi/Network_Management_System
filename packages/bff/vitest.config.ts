import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// CI invariant: `npm ci && npm test` must pass with NO prior build step. The `@nms/shared`
// workspace package resolves via its built `dist/` (its `main`/`types`), which does not exist on a
// clean checkout — so BFF tests that import `@nms/shared` would fail to resolve it until
// `npm run build` built the shared package. Alias the package to its TypeScript SOURCE so vitest
// (which transpiles TS on the fly) resolves it directly from the workspace, making the test command
// self-contained. This affects the TEST resolver only; the BFF build still consumes the built
// package via its published entry points.
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@nms/shared': sharedSrc
    }
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
});
