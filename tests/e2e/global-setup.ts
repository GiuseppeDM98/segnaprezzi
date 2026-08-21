import { chromium, type FullConfig } from '@playwright/test';

import { PWA_E2E_USER, SEED_USER, SEED_USER_2 } from './fixtures/users';
import { loginViaApi, signUpViaApi } from './helpers/auth';

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
 * Create (or reuse) the throwaway account the Spec 06 suites run as, and
 * cache its session.
 *
 * Sign-up 4xxs when a previous run died before its teardown; signing in is
 * then the right recovery, because the account is disposable either way.
 */
async function savePwaAuthState(baseURL: string | undefined, outFile: string): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  const signUpResponse = await signUpViaApi(page, PWA_E2E_USER);
  if (!signUpResponse.ok()) {
    await loginViaApi(page, PWA_E2E_USER);
  }
  await page.context().storageState({ path: outFile });
  await browser.close();
}

/**
 * Hit every route once, serially, before the parallel run starts.
 *
 * Originally a workaround for `next dev` compiling a route on its first
 * request, which made parallel workers race to be that request and
 * intermittently receive a truncated response. Since Spec 06 the suite runs
 * against a production build where nothing compiles on demand, but the pass
 * costs a second and still warms the server's module graph and the DB
 * connection, so a first assertion never pays for them.
 */
async function warmUpRoutes(baseURL: string | undefined): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL, storageState: 'playwright/.auth/dev.json' });
  await page.request.get('/');
  await page.request.get('/en');
  await page.request.get('/scan');
  await page.request.get('/scan/review');
  await page.request.get('/add/manual');
  await page.request.get('/add/fuel');
  await page.request.get('/products');
  await page.request.get('/history');
  await page.request.get('/stores');
  await page.request.get('/settings');
  await page.request.get('/login');
  await browser.close();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  await saveAuthState(baseURL, SEED_USER, 'playwright/.auth/dev.json');
  await saveAuthState(baseURL, SEED_USER_2, 'playwright/.auth/dev2.json');
  await savePwaAuthState(baseURL, 'playwright/.auth/pwa.json');
  await warmUpRoutes(baseURL);
}
