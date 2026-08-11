import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// CI invariant: `npm ci && npm test` must pass with NO prior build step. The `@nms/shared`
// workspace package resolves via its built `dist/` (its `main`/`types`), which does not exist on a
// clean checkout — so web unit tests would fail to resolve the import until `npm run build` ran.
// Alias the package to its TypeScript SOURCE so vitest (which transpiles TS on the fly) resolves it
// directly from the workspace, making the test command self-contained. This affects the TEST
// resolver only; the app build still consumes the built package via its published entry points.
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nms/shared': sharedSrc
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}']
  }
});
