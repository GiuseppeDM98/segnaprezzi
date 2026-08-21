import { expect, type Page, test } from '@playwright/test';

import { PWA_E2E_USER } from './fixtures/users';
import { resetCaptureFixtures } from './helpers/db';

/*
 * Offline queue + sync engine E2E suite (Spec 06 §9.1, scenarios 1–4).
 *
 * This project runs with `serviceWorkers: "block"` because Playwright cannot
 * intercept a request issued *through* an active worker, and every scenario
 * here needs /api/extract under the test's control. The service worker's own
 * behavior is covered by pwa.spec.ts.
 *
 * Photos enter through the file-input fallback, not the camera: CI has no
 * camera, and the fallback runs the exact same downstream pipeline
 * (compress → Dexie → sync engine → /api/extract → review → confirm).
 */

// Serial: every test drives the same account's queue, and each starts from a
// clean slate that a parallel sibling — or a retry of a run that died halfway
// — would otherwise pull out from under it.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await resetCaptureFixtures(PWA_E2E_USER.email);
});

const PHOTO_FIXTURE = 'tests/e2e/fixtures/price-tag.png';

/** A deterministic extraction: no catalog suggestion, so the review screen
 *  falls back to "new product", which needs no seeded data to resolve. */
const EXTRACTION_BODY = {
  blobUrl: 'https://store.public.blob.vercel-storage.com/users/u/photos/p.webp',
  extraction: {
    productName: 'Fenicottero passata di pomodoro 700g',
    brand: 'Ornitorinco',
    category: 'food',
    unitKind: 'weight',
    totalPriceCents: 189,
    packageSize: 0.7,
    unitPriceMilli: 2700,
    isPromo: false,
    promoKind: null,
    confidence: 0.93,
    rawText: 'Fenicottero passata 700g 1,89 €',
    needsReview: false,
    reviewReasons: [],
  },
  suggestions: [],
  model: 'claude-haiku-4-5',
};

/** Open the capture screen and wait until its client half is live: the
 *  no-camera fallback only renders once the camera hook has run, so its
 *  presence proves the file input's change handler is attached (AGENTS §4.24). */
async function openScanScreen(page: Page): Promise<void> {
  await page.goto('/scan');
  await expect(page.getByTestId('camera-fallback')).toBeVisible();
}

async function capturePhoto(page: Page): Promise<void> {
  await page.setInputFiles('[data-testid="photo-file-input"]', PHOTO_FIXTURE);
}

test('should capture while offline without ever blocking on the network', async ({
  page,
  context,
}) => {
  let extractCalls = 0;
  await page.route('**/api/extract', async (route) => {
    extractCalls += 1;
    await route.fulfill({ status: 200, json: EXTRACTION_BODY });
  });

  await openScanScreen(page);
  await context.setOffline(true);

  await capturePhoto(page);
  await capturePhoto(page);

  // Both photos are on the device, visibly queued, and the app says so
  // without a single error surface.
  await expect(page.getByTestId('tray-count')).toContainText('2');
  await expect(page.getByTestId('queue-status')).toContainText('2 in coda');
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByTestId('photo-status-failed')).toHaveCount(0);
  expect(extractCalls).toBe(0);
});

test('should keep the queue across a reload and leave no upload stuck', async ({
  page,
  context,
}) => {
  // The request fails rather than succeeding, so the photos cannot leave the
  // queue and the reload has something to preserve.
  await page.route('**/api/extract', (route) => route.abort('failed'));

  await openScanScreen(page);
  await context.setOffline(true);
  await capturePhoto(page);
  await capturePhoto(page);
  await expect(page.getByTestId('queue-status')).toContainText('2 in coda');

  // Connectivity has to come back for the navigation itself: this project
  // blocks the service worker, which is what would otherwise serve the page.
  // /api/extract stays broken, so the queue must survive the reload intact.
  await context.setOffline(false);
  await page.goto('/scan', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('camera-fallback')).toBeVisible();

  await expect(page.getByTestId('tray-count')).toContainText('2');
  // Both are back to 'queued': the engine resets interrupted uploads at
  // startup, so nothing can be stranded in 'uploading' forever.
  await expect(page.getByTestId('queue-status')).toContainText('2 in coda');
  await expect(page.getByTestId('photo-status-extracted')).toHaveCount(0);
});

test('should drain the queue on reconnect and confirm the entries', async ({ page, context }) => {
  await page.route('**/api/extract', async (route) => {
    await route.fulfill({ status: 200, json: EXTRACTION_BODY });
  });

  await openScanScreen(page);
  await context.setOffline(true);
  await capturePhoto(page);
  await capturePhoto(page);
  await expect(page.getByTestId('queue-status')).toContainText('2 in coda');

  await context.setOffline(false);

  // Reconnecting is enough: no button, no refresh.
  await expect(page.getByTestId('photo-status-extracted')).toHaveCount(2);

  await page.getByTestId('review-cta').click();
  const cards = page.getByTestId('review-card');
  await expect(cards).toHaveCount(2);

  // The stub returns no catalog suggestion, so each card needs its product
  // chosen — "create a new one" is the honest answer for a fresh account.
  for (let index = 0; index < 2; index += 1) {
    await cards.nth(index).getByTestId('match-row').click();
    await page.getByTestId('pick-new-product').click();
  }

  await page.getByTestId('confirm-batch').click();
  await expect(page).toHaveURL('/');

  const exportResponse = await page.request.get('/api/export');
  expect(exportResponse.status()).toBe(200);
  const payload = await exportResponse.json();
  const photoEntries = payload.entries.filter(
    (entry: { source: string }) => entry.source === 'photo',
  );
  expect(photoEntries).toHaveLength(2);
  expect(photoEntries[0]).toMatchObject({ totalPriceCents: 189, unitPriceMilli: 2700 });
});

test('should give up after five failures and recover through manual retry', async ({ page }) => {
  // Five attempts spaced by the 1/2/4/8 s backoff take ~15 s of real time.
  test.setTimeout(90_000);

  let shouldFail = true;
  const uploadedPhotoIds: Array<string | null> = [];
  await page.route('**/api/extract', async (route) => {
    uploadedPhotoIds.push(readPhotoId(route.request().postDataBuffer()));
    if (shouldFail) {
      await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL' } } });
      return;
    }
    await route.fulfill({ status: 200, json: EXTRACTION_BODY });
  });

  await openScanScreen(page);
  await capturePhoto(page);

  await expect(page.getByTestId('photo-status-failed')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('queue-status')).toContainText('1 non riuscita');
  expect(uploadedPhotoIds).toHaveLength(5);

  shouldFail = false;
  await page.getByTestId('retry-all').click();
  await expect(page.getByTestId('photo-status-extracted')).toBeVisible();

  // Every attempt carried the same client-generated id, which is what makes
  // a retry overwrite one blob instead of creating a second entry.
  expect(new Set(uploadedPhotoIds).size).toBe(1);
  expect(uploadedPhotoIds[0]).toMatch(/^[A-Za-z0-9_-]{21}$/);
});

/** Pull the client-generated photo id out of the multipart upload body. */
function readPhotoId(body: Buffer | null): string | null {
  const marker = 'name="photoId"';
  const text = body?.toString('latin1') ?? '';
  const start = text.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const value = text.slice(start + marker.length).match(/\s+([A-Za-z0-9_-]{21})\s/);
  return value?.[1] ?? null;
}
