import { createClient } from '@libsql/client';

/**
 * Delete a throwaway E2E signup user by email. Playwright tests assert
 * through HTTP/DB responses, never by reaching into the DB for behavior —
 * this is the one exception, and only for cleanup, so repeated local/CI runs
 * don't accumulate signup-test users that scripts/seed.ts doesn't know about.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL ?? 'file:local.db';
  if (!url.startsWith('file:')) {
    throw new Error('deleteUserByEmail refuses to run against a non-local database.');
  }
  const client = createClient({ url });
  await client.execute({ sql: 'DELETE FROM users WHERE email = ?', args: [email] });
  client.close();
}

/**
 * Remove everything the capture E2E suite writes for one user: the photo
 * entries it confirms and the shopping sessions they belong to.
 *
 * Why a reset rather than a teardown: Playwright retries a failed test, and a
 * run that died halfway would otherwise leave rows that make the next attempt
 * fail for the wrong reason. Called before each test, it makes the suite
 * idempotent no matter how the previous run ended.
 */
export async function resetCaptureFixtures(email: string): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL ?? 'file:local.db';
  if (!url.startsWith('file:')) {
    throw new Error('resetCaptureFixtures refuses to run against a non-local database.');
  }
  const client = createClient({ url });
  await client.execute({
    sql: `DELETE FROM price_entries
          WHERE source = 'photo'
            AND user_id IN (SELECT id FROM users WHERE email = ?)`,
    args: [email],
  });
  await client.execute({
    sql: `DELETE FROM shopping_sessions
          WHERE user_id IN (SELECT id FROM users WHERE email = ?)`,
    args: [email],
  });
  client.close();
}

/**
 * Remove the products a quick-entry E2E test creates, and the entries that
 * reference them.
 *
 * Order matters: price_entries.product_id blocks deleting a product that
 * still has history (Spec 02 §4.2), which is exactly the guarantee the app
 * relies on — so the entries go first.
 */
export async function deleteProductsByName(email: string, names: string[]): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL ?? 'file:local.db';
  if (!url.startsWith('file:')) {
    throw new Error('deleteProductsByName refuses to run against a non-local database.');
  }
  if (names.length === 0) {
    return;
  }
  const client = createClient({ url });
  const placeholders = names.map(() => '?').join(', ');
  const selectProducts = `SELECT id FROM products
     WHERE name IN (${placeholders})
       AND user_id IN (SELECT id FROM users WHERE email = ?)`;
  await client.execute({
    sql: `DELETE FROM price_entries WHERE product_id IN (${selectProducts})`,
    args: [...names, email],
  });
  await client.execute({
    sql: `DELETE FROM products WHERE id IN (${selectProducts})`,
    args: [...names, email],
  });
  client.close();
}
