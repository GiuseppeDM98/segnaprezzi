import { expect, test } from '@playwright/test';

import { loginViaApi, signUpViaApi } from './helpers/auth';
import { deleteUserByEmail, insertPriceObservations } from './helpers/db';

/*
 * What the dashboard admits about its own data: how many products have no
 * price this month, which categories nothing was compared in, and that a
 * price found dearer this month is a mover wherever it was seen. The figures come from the engine, already covered
 * numerically; this suite pins that the screen says them.
 *
 * A throwaway account rather than a seed user: the second seed user must stay
 * in the thin state (docs/guide/e2e.md §4.67), and the first has a full history. Spy
 * words of its own, "pangolino" and "tapiro" (docs/guide/e2e.md §4.60).
 */

// Why serial: with fullyParallel every worker runs beforeAll, and each one would
// delete the account another worker is logged in to.
test.describe.configure({ mode: 'serial' });

const USER = {
  email: 'e2e-coverage-pangolino@segnaprezzi.local',
  password: 'e2e-coverage-pangolino',
  name: 'E2E Pangolino',
};

test.beforeAll(async ({ browser }) => {
  await deleteUserByEmail(USER.email);
  const page = await browser.newPage();
  const response = await signUpViaApi(page, USER);
  expect(response.ok()).toBe(true);
  await page.close();
  await insertPriceObservations(USER.email, [
    { product: 'GPL pangolino', category: 'fuel', ym: '2026-03', milli: 1000 },
    { product: 'GPL pangolino', category: 'fuel', ym: '2026-04', milli: 1100 },
    { product: 'Banane tapiro', category: 'food', ym: '2026-03', milli: 1500 },
    { product: 'Banane tapiro', category: 'food', ym: '2026-04', milli: 1800 },
    { product: 'Sale tapiro', category: 'household', ym: '2026-03', milli: 500 },
  ]);
});

test.afterAll(async () => {
  await deleteUserByEmail(USER.email);
});

test('should say which prices are missing and which categories were not measured', async ({
  page,
}) => {
  await loginViaApi(page, USER);
  await page.goto('/');

  await expect(page.getByTestId('coverage-line')).toHaveText(
    'Basato su 3 prodotti in 3 categorie · 1 ancora senza prezzo di apr 2026',
  );
  // The list, not the section: the screen-reader table repeats every label.
  const categories = page.locator('section[aria-labelledby="categories-heading"] ol');
  await expect(categories.getByText('non rilevata', { exact: true })).toHaveCount(1);
  // A regular expression because «+10,0%» contains the characters of «0,0%».
  await expect(categories).not.toContainText(/(^|[^\d])0,0%/);
  await expect(categories).toContainText('+10,0%');
  await expect(categories).toContainText('+20,0%');
});

test('should list every product whose price moved, wherever it was seen', async ({ page }) => {
  await loginViaApi(page, USER);
  await page.goto('/');

  const movers = page.locator('section[aria-labelledby="movers-heading"]');
  await expect(movers).toContainText('GPL pangolino');
  await expect(movers).toContainText('Banane tapiro');
});

test('should say the same in English', async ({ page }) => {
  await loginViaApi(page, USER);
  await page.goto('/en');

  await expect(page.getByTestId('coverage-line')).toHaveText(
    'Based on 3 products in 3 categories · 1 still without a price for Apr 2026',
  );
  const categories = page.locator('section[aria-labelledby="categories-heading"] ol');
  await expect(categories.getByText('not measured', { exact: true })).toHaveCount(1);
});
