import { defineConfig } from '@playwright/test';

/*
 * Design: the primary (and for now only) project is a 390×844 mobile
 * viewport — the app's real target is a phone held one-handed in a
 * supermarket aisle. Chromium mobile emulation keeps CI to a single
 * browser download; Spec 05 adds a desktop project and Spec 06 adds
 * WebKit for iOS PWA verification.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
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
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
