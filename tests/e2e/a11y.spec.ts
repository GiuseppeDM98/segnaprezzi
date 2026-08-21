import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';

import { seedId } from '../../scripts/seed-ids';
import { deleteUserByEmail } from './helpers/db';

/*
 * Accessibility suite (Spec 05 §10): axe reports zero violations on every
 * route, in both themes. The theme is forced through the `theme` cookie the
 * root layout's pre-paint script reads, so the dark palette is the one
 * actually audited — not a media query the headless browser may ignore.
 *
 * Routes are audited in the state the seed produces: the primary user's
 * dashboard is the full data state, the second user's is the thin-data
 * state, and a throwaway signup covers the first-run empty state.
 */

const THEMES = ['light', 'dark'] as const;

const AUTHENTICATED_ROUTES = [
  '/',
  '/products',
  `/products/${seedId('seed-prod-spaghetti')}`,
  '/history',
  '/stores',
  '/settings',
  '/add/manual',
  '/add/fuel',
  '/scan/review',
  '/scan',
];

const PUBLIC_ROUTES = ['/login', '/signup', '/en/login'];

async function setTheme(context: BrowserContext, theme: (typeof THEMES)[number]): Promise<void> {
  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3000';
  await context.addCookies([{ name: 'theme', value: theme, url: baseURL }]);
}

async function expectNoViolations(page: Page): Promise<void> {
  // The route cross-fade (150 ms) must finish first: axe measures contrast
  // on the rendered pixels, and a half-faded page fails every text node.
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('main')).every(
      (main) => getComputedStyle(main).opacity === '1',
    ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // The Next.js dev overlay is not part of the app.
    .exclude('nextjs-portal')
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5),
    })),
  ).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.describe('seed user', () => {
      test.use({ storageState: 'playwright/.auth/dev.json' });

      for (const route of AUTHENTICATED_ROUTES) {
        test(`should have no axe violations on ${route}`, async ({ page, context }) => {
          await setTheme(context, theme);
          await page.goto(route);
          // Hydration must settle before auditing: the camera fallback and
          // the Dexie-backed review screen only reach their final state on
          // the client.
          if (route === '/scan') {
            await expect(page.getByTestId('camera-fallback')).toBeVisible();
          }
          if (route === '/scan/review') {
            await expect(page.getByTestId('review-empty')).toBeVisible();
          }
          await page.waitForLoadState('networkidle');
          await expectNoViolations(page);
        });
      }
    });

    test.describe('second seed user (thin-data dashboard)', () => {
      test.use({ storageState: 'playwright/.auth/dev2.json' });

      test('should have no axe violations on the thin-data dashboard', async ({
        page,
        context,
      }) => {
        await setTheme(context, theme);
        await page.goto('/');
        await expect(page.getByTestId('dashboard-thin')).toBeVisible();
        await expectNoViolations(page);
      });
    });

    test.describe('anonymous', () => {
      for (const route of PUBLIC_ROUTES) {
        test(`should have no axe violations on ${route}`, async ({ page, context }) => {
          await setTheme(context, theme);
          await page.goto(route);
          await page.waitForLoadState('networkidle');
          await expectNoViolations(page);
        });
      }

      test('should have no axe violations on the first-run dashboard', async ({
        page,
        context,
      }) => {
        const email = `e2e-a11y-${theme}-${Date.now()}@segnaprezzi.local`;
        try {
          const signUp = await page.request.post('/api/auth/sign-up/email', {
            data: { email, password: 'e2e-a11y-password', name: 'E2E A11y' },
          });
          expect(signUp.ok()).toBe(true);
          await setTheme(context, theme);
          await page.goto('/');
          await expect(page.getByTestId('dashboard-empty')).toBeVisible();
          await expectNoViolations(page);
        } finally {
          await deleteUserByEmail(email);
        }
      });
    });
  });
}
