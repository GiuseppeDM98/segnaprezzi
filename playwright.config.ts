import { defineConfig } from '@playwright/test';

/*
 * Design: the primary project is a 390×844 mobile viewport — the app's real
 * target is a phone held one-handed in a supermarket aisle. A desktop project
 * (the ≥ 1024 px rail) is limited to the smoke and accessibility suites, and
 * two more projects cover the PWA:
 *
 * - `offline-queue` blocks the service worker and mocks /api/extract, because
 *   Playwright cannot intercept a request issued *through* an active worker;
 *   it is the sync engine's suite.
 * - `pwa` runs with the worker enabled and no mocks: precache, the offline
 *   fallback page and the manifest.
 *
 * The whole suite runs against a PRODUCTION server rather than `next dev`:
 * public/sw.js is a build artifact and does not exist in development at all
 * (next.config.ts disables Serwist there). One server, not two — a dev
 * server and a build running side by side race each other inside the same
 * .next directory and corrupt its generated type files.
 *
 * Why a configurable port: on a dev machine another project may already own
 * :3000. PORT=3100 pnpm test:e2e pins the server, the baseURL and the auth
 * origin together.
 */
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

/** Shared phone emulation; every project pins the locale (see AGENTS.md §4.14). */
const mobileDevice = {
  browserName: 'chromium',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  // Why: next-intl negotiates the locale from Accept-Language when no cookie
  // is set. Without pinning it, the OS/CI locale leaks into the browser
  // context and the root-path smoke test becomes flaky.
  locale: 'it-IT',
} as const;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile',
      testIgnore: /(offline|pwa)\.spec\.ts/,
      use: { ...mobileDevice, serviceWorkers: 'block' },
    },
    {
      name: 'desktop',
      testMatch: /(smoke|a11y)\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
        locale: 'it-IT',
        serviceWorkers: 'block',
      },
    },
    {
      name: 'offline-queue',
      testMatch: /offline\.spec\.ts/,
      use: {
        ...mobileDevice,
        serviceWorkers: 'block',
        storageState: 'playwright/.auth/pwa.json',
      },
    },
    {
      name: 'pwa',
      testMatch: /pwa\.spec\.ts/,
      use: { ...mobileDevice, storageState: 'playwright/.auth/pwa.json' },
    },
  ],
  webServer: {
    // `pnpm build` is part of the command on purpose: public/sw.js is a build
    // artifact, so a server started from a stale build would test the
    // previous commit's service worker.
    command: `pnpm build && pnpm start --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // Better Auth rejects requests whose origin is not the configured one,
      // so the server has to agree with the port the tests use (§4.32).
      BETTER_AUTH_URL: baseURL,
    },
  },
});
