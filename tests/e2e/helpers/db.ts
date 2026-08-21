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
