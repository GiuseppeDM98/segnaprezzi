import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // Why: the components project can be empty (before its first .test.tsx
    // lands) — an empty project must not fail the run.
    passWithNoTests: true,
    /*
     * Why fixed env values: some modules under test import
     * src/lib/env.ts, which fails fast on a missing variable. Tests must not
     * depend on a developer's .env.local (and CI has none), and an API key
     * here would be a real key in a test run — these placeholders make both
     * impossible. Every network call in the suite is mocked.
     */
    env: {
      TURSO_DATABASE_URL: 'file:vitest-unused.db',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: 'http://localhost:3000',
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
      SIGNUP_ENABLED: 'true',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          // The offline modules need an IndexedDB. Files that also need a
          // DOM opt into happy-dom with a @vitest-environment docblock.
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'happy-dom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
