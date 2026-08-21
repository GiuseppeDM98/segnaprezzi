import { expect, test } from '@playwright/test';

test('should serve the Italian dashboard shell at the root path', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'La tua inflazione' })).toBeVisible();
});

test('should serve the English dashboard shell under the /en prefix', async ({ page }) => {
  await page.goto('/en');

  await expect(page.getByRole('heading', { name: 'Your inflation' })).toBeVisible();
});
