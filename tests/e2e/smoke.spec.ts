import { expect, test } from '@playwright/test';

// '/' lives under the (app) route group and requires a
// session (src/middleware.ts + the (app) layout) — this authenticates
// as the seed user via global-setup.ts's cached storageState instead of
// hitting the anonymous root path, which redirects to /login.
test.use({ storageState: 'playwright/.auth/dev.json' });

test('should serve the Italian dashboard shell at the root path', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'La tua inflazione' })).toBeVisible();
});

test('should serve the English dashboard shell under the /en prefix', async ({ page }) => {
  await page.goto('/en');

  await expect(page.getByRole('heading', { name: 'Your inflation' })).toBeVisible();
});
