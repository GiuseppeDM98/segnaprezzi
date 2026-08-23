import { expect, test } from '@playwright/test';

import { SEED_USER_2 } from './fixtures/users';
import { deleteProductsByName } from './helpers/db';

/*
 * Product deletion E2E suite.
 *
 * This is the one action in the app that destroys price history on purpose,
 * so the assertions are about what is gone from the DATABASE, not about what
 * left the screen: GET /api/export must lose the product AND every entry that
 * referenced it, in the same breath. The confirmation is checked for the one
 * thing it exists to say — how many observations are about to disappear —
 * because a count that lies is worse than no count at all.
 *
 * Runs as the second seed user, whose catalog no other spec asserts on — but
 * with spy words of its own ("vombato", "axolotl"). The receipt suite shares
 * that account and fuzzy-matches its lines against the whole catalog, so
 * reusing its fenicottero/ornitorinco/quokka would have let these products
 * capture its receipt lines and change what that suite measures.
 */

test.use({ storageState: 'playwright/.auth/dev2.json' });
test.describe.configure({ mode: 'serial' });

const PRODUCT_NAME = 'Vombato in scatola E2E';
const KEPT_PRODUCT_NAME = 'Axolotl surgelato E2E';

test.beforeEach(async () => {
  await deleteProductsByName(SEED_USER_2.email, [PRODUCT_NAME, KEPT_PRODUCT_NAME]);
});

test.afterAll(async () => {
  await deleteProductsByName(SEED_USER_2.email, [PRODUCT_NAME, KEPT_PRODUCT_NAME]);
});

/** Create a product with one observation through the manual form. */
async function createProductWithEntry(
  page: import('@playwright/test').Page,
  name: string,
  priceEuros: string,
): Promise<void> {
  await page.goto('/add/manual');
  await page.getByTestId('product-search').fill(name);
  await page.getByTestId('create-product').click();
  await expect(page.getByTestId('new-product-name')).toHaveValue(name);
  await page.getByTestId('total-price').fill(priceEuros);
  await page.getByTestId('package-size').fill('1');
  await page.getByTestId('save-entry').click();
  await expect(page.getByTestId('toast-success')).toBeVisible();
}

test('should delete a product and its observations from the catalog row', async ({ page }) => {
  await createProductWithEntry(page, PRODUCT_NAME, '1,29');
  await createProductWithEntry(page, KEPT_PRODUCT_NAME, '2,49');

  await page.goto('/products');
  const row = page.getByTestId('product-row').filter({ hasText: PRODUCT_NAME });
  await row.getByTestId('delete-product-row').click();

  // The confirmation must name the cost of the decision before it is taken.
  await expect(page.getByTestId('delete-impact')).toContainText('1 rilevazione');

  await page.getByTestId('confirm-delete-products').click();
  await expect(page.getByTestId('toast-success')).toBeVisible();

  const payload = await (await page.request.get('/api/export')).json();
  const names = payload.products.map((product: { name: string }) => product.name);
  expect(names).not.toContain(PRODUCT_NAME);
  // The neighbour is untouched — a delete must not take the list with it.
  expect(names).toContain(KEPT_PRODUCT_NAME);

  // And the history went with it, rather than being orphaned.
  const keptProduct = payload.products.find(
    (product: { name: string }) => product.name === KEPT_PRODUCT_NAME,
  );
  const orphaned = payload.entries.filter(
    (entry: { productId: string }) =>
      !payload.products.some((product: { id: string }) => product.id === entry.productId),
  );
  expect(orphaned).toHaveLength(0);
  expect(
    payload.entries.filter((entry: { productId: string }) => entry.productId === keptProduct.id),
  ).toHaveLength(1);
});

test('should delete several selected products at once', async ({ page }) => {
  await createProductWithEntry(page, PRODUCT_NAME, '1,29');
  await createProductWithEntry(page, KEPT_PRODUCT_NAME, '2,49');

  await page.goto('/products');
  await page.getByTestId('start-selection').click();
  await page.getByTestId('product-row').filter({ hasText: PRODUCT_NAME }).click();
  await page.getByTestId('product-row').filter({ hasText: KEPT_PRODUCT_NAME }).click();

  await page.getByTestId('open-bulk-delete').click();
  // Two products, one observation each.
  await expect(page.getByTestId('delete-impact')).toContainText('2 rilevazioni');

  await page.getByTestId('confirm-delete-products').click();
  await expect(page.getByTestId('toast-success')).toBeVisible();

  const payload = await (await page.request.get('/api/export')).json();
  const names = payload.products.map((product: { name: string }) => product.name);
  expect(names).not.toContain(PRODUCT_NAME);
  expect(names).not.toContain(KEPT_PRODUCT_NAME);
});

test('should keep the product when the confirmation is dismissed', async ({ page }) => {
  await createProductWithEntry(page, PRODUCT_NAME, '1,29');

  await page.goto('/products');
  await page
    .getByTestId('product-row')
    .filter({ hasText: PRODUCT_NAME })
    .getByTestId('delete-product-row')
    .click();
  await expect(page.getByTestId('delete-impact')).toBeVisible();

  // Backing out of a destructive confirmation must be a true no-op.
  await page.getByRole('button', { name: 'Annulla' }).first().click();
  await expect(page.getByTestId('delete-impact')).toBeHidden();

  const payload = await (await page.request.get('/api/export')).json();
  expect(payload.products.map((product: { name: string }) => product.name)).toContain(PRODUCT_NAME);
});
