import type { Page } from '@playwright/test';

/**
 * Log in through Better Auth's REST route instead of the login form.
 * `page.request` shares the browser context's cookie jar with `page` itself,
 * so the Set-Cookie this call receives is immediately usable by a following
 * page.goto() — no manual storageState plumbing needed within one test.
 */
export async function loginViaApi(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email: credentials.email, password: credentials.password },
  });
  if (!response.ok()) {
    throw new Error(`loginViaApi failed: ${response.status()} ${await response.text()}`);
  }
}
