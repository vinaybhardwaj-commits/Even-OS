/**
 * Vitest config for Even OS — Phase 0 test infra.
 *
 * Uses two environments via per-test override:
 *   - 'node' (default) for unit + integration tests against the DB layer
 *   - 'jsdom' / 'happy-dom' for React component tests (override at top of file)
 *
 * Test files convention:
 *   - apps/web/tests/**\/*.test.ts          unit + integration (node env)
 *   - apps/web/src/**\/*.test.ts            colocated unit (node env)
 *   - apps/web/src/components/**\/*.test.tsx React component tests (jsdom)
 *
 * E2E tests live separately at apps/web/tests/e2e/ and use Playwright (see playwright.config.ts).
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test-utils/setup.ts'],
    include: [
      'tests/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
    ],
    exclude: [
      'node_modules/**',
      'tests/e2e/**',         // Playwright owns these
      '.next/**',
      'drizzle/migrations/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'tests/**',
        'test-utils/**',
        '**/*.config.{ts,js,cjs,mjs}',
        '**/*.d.ts',
        'drizzle/migrations/**',
        '.next/**',
        'scripts/**',
        // Generated / boilerplate
        'src/app/**/loading.tsx',
        'src/app/**/error.tsx',
        'src/app/**/not-found.tsx',
        'next-env.d.ts',
      ],
      thresholds: {
        // Phase 0 baseline. Raise per phase as we add tests:
        //   Phase 1 → 30% lines on touched paths
        //   Phase 4 → 60%
        //   Phase 8 → 80% before launch
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
    testTimeout: 30_000,           // DB-touching integration tests can take a moment
    hookTimeout: 60_000,           // setup/teardown can spin up Neon branches
    pool: 'forks',                 // Process isolation per test file (DB safety)
    poolOptions: {
      forks: {
        singleFork: false,
        minForks: 1,
        maxForks: 4,
      },
    },
    sequence: {
      shuffle: false,              // Deterministic order helps when triaging cascading DB-state failures
      concurrent: false,           // Phase 0 conservative; Phase 1+ can opt-in per-file
    },
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@db': path.resolve(__dirname, './drizzle'),
      '@even-os/db': path.resolve(__dirname, '../../packages/db/src'),
      '@even-os/config': path.resolve(__dirname, '../../packages/config/src'),
      '@even-os/types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },
});
