import { chromium, type FullConfig } from '@playwright/test';

import { SEED_USER, SEED_USER_2 } from './fixtures/users';
import { loginViaApi } from './helpers/auth';

async function saveAuthState(
  baseURL: string | undefined,
  user: { email: string; password: string },
  outFile: string,
): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await loginViaApi(page, user);
  await page.context().storageState({ path: outFile });
  await browser.close();
}

/**
 * Hit the dashboard route once per locale before the parallel test run
 * starts. Why: Next.js dev (Turbopack) compiles a route on its first
 * request; several tests request '/' and '/en' as their very first action,
 * and when multiple parallel workers race to be that first request, the
 * dev server has (verified, reproduced twice) intermittently returned a
 * truncated response ("Unexpected end of JSON input") instead of queuing
 * them. A single serial warm-up request per route avoids the race.
 */
async function warmUpRoutes(baseURL: string | undefined): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL, storageState: 'playwright/.auth/dev.json' });
  await page.request.get('/');
  await page.request.get('/en');
  await browser.close();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  await saveAuthState(baseURL, SEED_USER, 'playwright/.auth/dev.json');
  await saveAuthState(baseURL, SEED_USER_2, 'playwright/.auth/dev2.json');
  await warmUpRoutes(baseURL);
}
