import { expect, type Page, test } from '@playwright/test';

import { seedId } from '../../scripts/seed-ids';
import { SEED_USER_2 } from './fixtures/users';
import { resetCaptureFixtures } from './helpers/db';

/*
 * Capture E2E suite (Spec 03 §13.6).
 *
 * Two deliberate choices:
 * - The photo enters through the file-input fallback, not the camera. CI has
 *   no camera, and the fallback runs the exact same downstream pipeline
 *   (compress -> Dexie -> /api/extract -> review -> confirm).
 * - /api/extract is intercepted. The route's own job is covered by unit
 *   tests; hitting it for real here would spend Anthropic tokens, need a Blob
 *   token, and make the assertions depend on what a model happened to answer.
 *   The interception still asserts what the CLIENT uploaded — a compressed
 *   WebP well under the size cap — which is the half of the pipeline no unit
 *   test can reach.
 *
 * Outcomes are verified against GET /api/export (the database), never against
 * the page alone. The suite runs as the second seed user so it never disturbs
 * the rich dataset the other specs assert on.
 */

test.use({ storageState: 'playwright/.auth/dev2.json' });
// Serial: both tests write to the same account, and each starts from a clean
// slate that a parallel sibling would pull out from under it.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await resetCaptureFixtures(SEED_USER_2.email);
});

const YOGURT_PRODUCT_ID = seedId('seed2-prod-yogurt');
const PHOTO_FIXTURE = 'tests/e2e/fixtures/price-tag.png';

/** A realistic /api/extract response for a yogurt tag the catalog already knows. */
function extractionResponse(overrides: { needsReview?: boolean } = {}) {
  const needsReview = overrides.needsReview ?? false;
  return {
    blobUrl: 'https://store.public.blob.vercel-storage.com/users/u/photos/p.webp',
    extraction: {
      productName: 'Yogurt bianco 4x125g',
      brand: 'Coop',
      category: 'food',
      unitKind: 'count',
      totalPriceCents: 179,
      packageSize: 4,
      unitPriceMilli: needsReview ? 900 : 448,
      isPromo: false,
      promoKind: null,
      confidence: needsReview ? 0.4 : 0.95,
      rawText: 'Yogurt bianco 4x125g\n1,79 €',
      needsReview,
      reviewReasons: needsReview ? ['price-mismatch', 'low-confidence'] : [],
    },
    suggestions: [
      {
        productId: YOGURT_PRODUCT_ID,
        name: 'Yogurt bianco 4×125g',
        brand: 'Coop',
        score: 0.95,
      },
    ],
    model: 'claude-haiku-4-5',
  };
}

/**
 * Intercept /api/extract, returning the given fixture and recording what the
 * browser actually uploaded.
 */
async function stubExtraction(
  page: Page,
  body: ReturnType<typeof extractionResponse>,
): Promise<{ uploads: Array<{ contentType: string; byteLength: number }> }> {
  const uploads: Array<{ contentType: string; byteLength: number }> = [];

  await page.route('**/api/extract', async (route) => {
    const postData = route.request().postDataBuffer();
    const contentTypeMatch = postData
      ?.toString('latin1')
      .match(/Content-Type: (image\/(?:webp|jpeg))/);
    uploads.push({
      contentType: contentTypeMatch?.[1] ?? 'unknown',
      byteLength: postData?.byteLength ?? 0,
    });
    await route.fulfill({ status: 200, json: body });
  });

  return { uploads };
}

test('should capture a photo, review it and confirm it into the database', async ({ page }) => {
  const { uploads } = await stubExtraction(page, extractionResponse());

  await page.goto('/scan');
  // Wait for hydration before touching the input: the camera panel only
  // switches to its no-camera fallback once the client hook has run, so its
  // presence proves the change handler is attached.
  await expect(page.getByTestId('camera-fallback')).toBeVisible();
  await page.setInputFiles('[data-testid="photo-file-input"]', PHOTO_FIXTURE);

  // The tray reports the photo made it through upload + extraction.
  await expect(page.getByTestId('photo-status-extracted')).toBeVisible();
  await expect(page.getByTestId('tray-count')).toContainText('1');

  // What the browser uploaded is the compressed WebP, not the raw PNG.
  expect(uploads).toHaveLength(1);
  expect(uploads[0].contentType).toBe('image/webp');
  expect(uploads[0].byteLength).toBeLessThan(400 * 1024);

  await page.getByTestId('review-cta').click();

  const card = page.getByTestId('review-card');
  await expect(card).toHaveCount(1);
  // The match row names the preselected catalog product.
  await expect(card.getByTestId('match-row')).toContainText('Yogurt bianco');
  // A 0.95 suggestion is preselected, so confirming needs no product pick.
  await expect(page.getByTestId('needs-review-badge')).toHaveCount(0);

  await page.getByTestId('confirm-batch').click();
  await expect(page).toHaveURL('/');

  const exportResponse = await page.request.get('/api/export');
  expect(exportResponse.status()).toBe(200);
  const payload = await exportResponse.json();
  const photoEntries = payload.entries.filter(
    (entry: { source: string }) => entry.source === 'photo',
  );

  expect(photoEntries).toHaveLength(1);
  expect(photoEntries[0]).toMatchObject({
    productId: YOGURT_PRODUCT_ID,
    totalPriceCents: 179,
    unitPriceMilli: 448,
    aiModel: 'claude-haiku-4-5',
  });
  expect(photoEntries[0].photoUrl).toContain('public.blob.vercel-storage.com');

  const completedSessions = payload.shoppingSessions.filter(
    (session: { status: string }) => session.status === 'completed',
  );
  expect(completedSessions).toHaveLength(1);
});

test('should flag a doubtful extraction and block confirm until it is fixed', async ({ page }) => {
  await stubExtraction(page, extractionResponse({ needsReview: true }));

  await page.goto('/scan');
  // Wait for hydration before touching the input: the camera panel only
  // switches to its no-camera fallback once the client hook has run, so its
  // presence proves the change handler is attached.
  await expect(page.getByTestId('camera-fallback')).toBeVisible();
  await page.setInputFiles('[data-testid="photo-file-input"]', PHOTO_FIXTURE);
  await expect(page.getByTestId('photo-status-extracted')).toBeVisible();

  await page.getByTestId('review-cta').click();
  await expect(page.getByTestId('needs-review-badge')).toBeVisible();

  // A 0.95 suggestion is still preselected, so the only thing standing in the
  // way is the number the user must look at — clear it and the confirm bar
  // disables itself and says why (Spec 05 §5.3: "1 da completare").
  await page.getByTestId('field-total-price').fill('');
  await expect(page.getByTestId('confirm-batch')).toBeDisabled();
  await expect(page.getByText('1 da completare')).toBeVisible();
  await expect(page).toHaveURL(/\/scan\/review/);

  const exportResponse = await page.request.get('/api/export');
  const payload = await exportResponse.json();
  expect(
    payload.entries.filter((entry: { source: string }) => entry.source === 'photo'),
  ).toHaveLength(0);
});
