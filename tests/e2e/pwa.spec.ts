import { expect, type Page, test } from '@playwright/test';

/*
 * Service worker E2E suite (Spec 06 §9.1, scenarios 5–6).
 *
 * This project runs with the worker ENABLED and no route mocks — the whole
 * point is what the worker does on its own. It therefore asserts nothing
 * about /api/extract, which is offline.spec.ts's territory.
 *
 * It runs against the production server: `next dev` ships no service worker
 * at all (next.config.ts disables Serwist in development).
 */

/** Load the app and wait until the service worker is driving this page. */
async function installServiceWorker(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  });
}

test('should serve the Italian offline fallback for an uncached route', async ({
  page,
  context,
}) => {
  await installServiceWorker(page, '/');

  await context.setOffline(true);
  await page.goto('/history');

  await expect(page.getByTestId('offline-fallback')).toBeVisible();
  await expect(page.getByTestId('offline-fallback')).toContainText('Sei offline');
});

test('should serve the English offline fallback under /en', async ({ page, context }) => {
  await installServiceWorker(page, '/en');

  await context.setOffline(true);
  await page.goto('/en/history');

  await expect(page.getByTestId('offline-fallback')).toBeVisible();
  await expect(page.getByTestId('offline-fallback')).toContainText("You're offline");
});

test('should serve a manifest that meets the install criteria', async ({ page }) => {
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'segnaprezzi',
    short_name: 'segnaprezzi',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'it',
  });

  // Chrome's installability bar: a 192 px and a 512 px icon, plus a maskable
  // one so the launcher does not letterbox the mark.
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  const maskable = manifest.icons.filter(
    (icon: { purpose?: string }) => icon.purpose === 'maskable',
  );
  expect(maskable).toHaveLength(2);

  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(icon.src);
    expect(iconResponse.status(), `${icon.src} is served`).toBe(200);
  }
});

test('should keep every /api response out of the caches', async ({ page }) => {
  await installServiceWorker(page, '/');

  // Authenticated, per-user data. A cached copy would survive into the next
  // person's session on a shared device — hence NetworkOnly (§2.3).
  const exportResponse = await page.request.get('/api/export');
  expect(exportResponse.status()).toBe(200);
  await page.goto('/history');

  const cachedApiUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        urls.push(request.url);
      }
    }
    return urls.filter((url) => new URL(url).pathname.startsWith('/api/'));
  });

  expect(cachedApiUrls).toEqual([]);
});

test('should serve the generated service worker and both theme-color metas', async ({ page }) => {
  const swResponse = await page.request.get('/sw.js');
  expect(swResponse.status()).toBe(200);

  await page.goto('/');
  await expect(page.locator('meta[name="theme-color"][media*="light"]')).toHaveAttribute(
    'content',
    '#faf5eb',
  );
  await expect(page.locator('meta[name="theme-color"][media*="dark"]')).toHaveAttribute(
    'content',
    '#121017',
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
});
