import type { APIResponse, Page } from '@playwright/test';

/*
 * Authenticating from a test.
 *
 * `page.request` shares the browser context's cookie jar with `page` itself,
 * so the Set-Cookie these calls receive is immediately usable by a following
 * page.goto() — no manual storageState plumbing needed within one test.
 *
 * The suite runs against a PRODUCTION server, where Better
 * Auth's rate limiter is on: /sign-in* and /sign-up* allow three requests per
 * ten seconds per IP. Every worker is the same IP here, so the limiter fires
 * on a perfectly healthy run. It is a real protection and must not be
 * disabled for tests, so the tests wait it out instead.
 */

const MAX_RATE_LIMIT_RETRIES = 4;
const FALLBACK_RETRY_AFTER_SECONDS = 10;

/** Perform an auth request, waiting out a 429 instead of failing on it. */
async function postWithRateLimitRetry(
  page: Page,
  path: string,
  data: Record<string, string>,
): Promise<APIResponse> {
  let response = await page.request.post(path, { data });
  for (let attempt = 0; attempt < MAX_RATE_LIMIT_RETRIES && response.status() === 429; attempt++) {
    const retryAfter = Number(response.headers()['retry-after']) || FALLBACK_RETRY_AFTER_SECONDS;
    await page.waitForTimeout(retryAfter * 1000 + 250);
    response = await page.request.post(path, { data });
  }
  return response;
}

/**
 * Log in through Better Auth's REST route instead of the login form.
 *
 * @throws when the credentials are rejected — a failed login is never
 *   something a caller should have to check for.
 */
export async function loginViaApi(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  const response = await postWithRateLimitRetry(page, '/api/auth/sign-in/email', {
    email: credentials.email,
    password: credentials.password,
  });
  if (!response.ok()) {
    throw new Error(`loginViaApi failed: ${response.status()} ${await response.text()}`);
  }
}

/**
 * Register a throwaway account through Better Auth's REST route.
 *
 * @returns The raw response, so a caller testing signup itself can assert on
 *   it. A 429 has already been waited out.
 */
export function signUpViaApi(
  page: Page,
  credentials: { email: string; password: string; name: string },
): Promise<APIResponse> {
  return postWithRateLimitRetry(page, '/api/auth/sign-up/email', credentials);
}
