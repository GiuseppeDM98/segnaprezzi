import { defineConfig } from '@playwright/test';

/*
 * Design: the primary project is a 390×844 mobile viewport — the app's real
 * target is a phone held one-handed in a supermarket aisle. Spec 05 adds a
 * desktop project (the ≥ 1024 px rail) limited to the smoke and
 * accessibility suites; Spec 06 adds WebKit for iOS PWA verification.
 *
 * Why a configurable port: on a dev machine another project may already own
 * :3000, and `next dev` would silently move to :3001 while baseURL kept
 * pointing at the wrong app. PORT=3100 pnpm test:e2e pins both sides.
 */
const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
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
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        // Why: next-intl negotiates the locale from Accept-Language when no
        // cookie is set. Without pinning it, the OS/CI locale leaks into the
        // browser context and the root-path smoke test becomes flaky.
        locale: 'it-IT',
      },
    },
    {
      name: 'desktop',
      testMatch: /(smoke|a11y)\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
        locale: 'it-IT',
      },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
