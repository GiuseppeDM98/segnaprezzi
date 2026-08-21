import { expect, test } from '@playwright/test';

import { SEED_USER_2 } from './fixtures/users';
import { deleteProductsByName } from './helpers/db';

/*
 * Quick-entry E2E suite (Spec 03 §10, §11).
 *
 * These two forms are online-only and single-shot, so the interesting part is
 * the arithmetic the browser does while the user types — the g→kg conversion
 * and the fuel two-of-three derivation — and whether the integers that reach
 * the database are the right ones. Both are asserted against GET /api/export,
 * never against the page alone.
 */

test.use({ storageState: 'playwright/.auth/dev2.json' });
test.describe.configure({ mode: 'serial' });

const MANUAL_PRODUCT_NAME = 'Passata di pomodoro E2E';
const FUEL_PRODUCT_NAMES = ['Diesel', 'Benzina', 'GPL', 'Metano'];
const CREATED_PRODUCTS = [MANUAL_PRODUCT_NAME, ...FUEL_PRODUCT_NAMES];

test.beforeEach(async () => {
  await deleteProductsByName(SEED_USER_2.email, CREATED_PRODUCTS);
});

test.afterAll(async () => {
  await deleteProductsByName(SEED_USER_2.email, CREATED_PRODUCTS);
});

test('should convert grams to kilos and store integer money from the manual form', async ({
  page,
}) => {
  await page.goto('/add/manual');

  await page.getByLabel('Nuovo prodotto').check();
  await page.getByPlaceholder('Nome del prodotto').fill(MANUAL_PRODUCT_NAME);
  await page.getByPlaceholder('Marca').fill('Mutti');

  await page.getByLabel('Prezzo pagato (€)').fill('1,29');
  await page.getByLabel('Quantità', { exact: true }).fill('700');
  await page.getByLabel('Unità').selectOption('g');

  // 700 g is 0.7 kg, so €1,29 is €1,843/kg — derived live, before submitting.
  await expect(page.getByLabel('Prezzo unitario (€)')).toHaveValue('1.843');

  await page.getByRole('button', { name: 'Salva rilevazione' }).click();
  await expect(page).toHaveURL('/');

  const payload = await (await page.request.get('/api/export')).json();
  const product = payload.products.find(
    (candidate: { name: string }) => candidate.name === MANUAL_PRODUCT_NAME,
  );
  expect(product).toMatchObject({ brand: 'Mutti', unitKind: 'weight' });

  const entry = payload.entries.find(
    (candidate: { productId: string }) => candidate.productId === product.id,
  );
  expect(entry).toMatchObject({
    source: 'manual',
    totalPriceCents: 129,
    packageSize: 0.7,
    unitPriceMilli: 1843,
    sessionId: null,
    photoUrl: null,
  });
});

test('should derive the total from €/L and litres and store it as the fuel entry', async ({
  page,
}) => {
  await page.goto('/add/fuel');

  await page.getByRole('button', { name: 'Diesel' }).click();
  await page.getByTestId('fuel-unit-price').fill('1,799');
  await page.getByTestId('fuel-quantity').fill('38,2');

  // €1,799/L x 38,2 L = €68,72 — the third field follows the two just typed.
  await expect(page.getByTestId('fuel-total')).toHaveValue('68.72');

  await page.getByRole('button', { name: 'Salva rifornimento' }).click();
  await expect(page).toHaveURL('/');

  const payload = await (await page.request.get('/api/export')).json();
  const product = payload.products.find(
    (candidate: { name: string }) => candidate.name === 'Diesel',
  );
  expect(product).toMatchObject({ category: 'fuel', unitKind: 'volume', brand: null });

  const entry = payload.entries.find(
    (candidate: { productId: string }) => candidate.productId === product.id,
  );
  expect(entry).toMatchObject({
    source: 'fuel',
    unitPriceMilli: 1799,
    packageSize: 38.2,
    totalPriceCents: 6872,
    isPromo: false,
  });
});

test('should price methane per kilogram, not per litre', async ({ page }) => {
  await page.goto('/add/fuel');

  // Petrol first: its labels must be the litre ones.
  await page.getByRole('button', { name: 'Benzina' }).click();
  await expect(page.getByText('€/L')).toBeVisible();
  await expect(page.getByText('Litri')).toBeVisible();

  // Methane is dispensed and priced by weight in Italy, so the form follows.
  await page.getByRole('button', { name: 'Metano' }).click();
  await expect(page.getByText('€/kg')).toBeVisible();
  await expect(page.getByText('Chili')).toBeVisible();

  await page.getByTestId('fuel-unit-price').fill('1,899');
  await page.getByTestId('fuel-quantity').fill('15');
  await expect(page.getByTestId('fuel-total')).toHaveValue('28.49');

  await page.getByRole('button', { name: 'Salva rifornimento' }).click();
  await expect(page).toHaveURL('/');

  const payload = await (await page.request.get('/api/export')).json();
  const product = payload.products.find(
    (candidate: { name: string }) => candidate.name === 'Metano',
  );
  expect(product).toMatchObject({ category: 'fuel', unitKind: 'weight' });

  const entry = payload.entries.find(
    (candidate: { productId: string }) => candidate.productId === product.id,
  );
  expect(entry).toMatchObject({
    source: 'fuel',
    unitPriceMilli: 1899,
    packageSize: 15,
    totalPriceCents: 2849,
  });
});
