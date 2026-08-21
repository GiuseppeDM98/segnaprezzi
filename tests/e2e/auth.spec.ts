import { expect, test } from '@playwright/test';

import { signUpViaApi } from './helpers/auth';
import { deleteUserByEmail } from './helpers/db';

/*
 * Auth E2E suite. Authenticates by calling Better Auth's
 * own /api/auth/* routes directly instead of driving the /login form — the
 * form itself is a thin client over the same routes, so testing
 * through it would mean re-testing form plumbing, not auth behavior, on
 * every run. See global-setup.ts for the cached seed-user sessions this
 * suite reuses via storageState.
 */

test.describe('anonymous visitors', () => {
  test('should create an account, get a session cookie, and provision default settings', async ({
    page,
  }) => {
    const email = `e2e-signup-${Date.now()}@segnaprezzi.local`;
    try {
      const signUpResponse = await signUpViaApi(page, {
        email,
        password: 'e2e-signup-password',
        name: 'E2E Signup',
      });
      expect(signUpResponse.ok()).toBe(true);

      const exportResponse = await page.request.get('/api/export');
      expect(exportResponse.status()).toBe(200);
      const payload = await exportResponse.json();
      expect(payload.settings).toEqual({ includePromosInIndex: true, carryForwardMonths: 2 });
    } finally {
      await deleteUserByEmail(email);
    }
  });

  test('should redirect an anonymous visitor to the locale-correct login page', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/(en\/)?login/);
  });

  test('should return 401 from GET /api/export when anonymous', async ({ page }) => {
    const response = await page.request.get('/api/export');
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});

test.describe('seed user (dev@segnaprezzi.local)', () => {
  test.use({ storageState: 'playwright/.auth/dev.json' });

  test('should reach a protected page without hitting /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should see only its own data via /api/export', async ({ page }) => {
    const response = await page.request.get('/api/export');
    expect(response.status()).toBe(200);
    const payload = await response.json();
    const storeNames = payload.stores.map((store: { name: string }) => store.name);
    expect(storeNames).toContain('Esselunga Viale Papiniano');
    expect(storeNames).not.toContain('Coop Via Roma');
  });

  test('should clear the session and redirect protected routes to /login again after logout', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);

    // Why the Origin header: unlike sign-in/sign-up, Better Auth's sign-out
    // route enforces its trusted-origin CSRF check (it operates on an
    // existing authenticated session). page.request.post() is a raw API
    // call, not a real in-page fetch(), so it doesn't send Origin on its
    // own — verified with a plain curl call, which got a 403
    // MISSING_OR_NULL_ORIGIN without it.
    const signOutResponse = await page.request.post('/api/auth/sign-out', {
      headers: { Origin: new URL(page.url()).origin },
      data: {},
    });
    expect(signOutResponse.ok()).toBe(true);

    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('second seed user (dev2@segnaprezzi.local)', () => {
  test.use({ storageState: 'playwright/.auth/dev2.json' });

  test('should see only its own data via /api/export', async ({ page }) => {
    const response = await page.request.get('/api/export');
    expect(response.status()).toBe(200);
    const payload = await response.json();
    const storeNames = payload.stores.map((store: { name: string }) => store.name);
    expect(storeNames).toContain('Coop Via Roma');
    expect(storeNames).not.toContain('Esselunga Viale Papiniano');
  });
});
