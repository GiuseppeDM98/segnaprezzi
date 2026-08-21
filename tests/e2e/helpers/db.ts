import { type Client, createClient } from '@libsql/client';

/**
 * Open the local file database with the same busy timeout the app client
 * sets (AGENTS.md §4.18): these helpers run from parallel Playwright workers
 * while the dev server writes, and a raw client without it surfaces
 * SQLITE_BUSY as a 13 ms test failure that passes on retry.
 */
async function openLocalClient(): Promise<Client> {
  const url = process.env.TURSO_DATABASE_URL ?? 'file:local.db';
  if (!url.startsWith('file:')) {
    throw new Error('E2E db helpers refuse to run against a non-local database.');
  }
  const client = createClient({ url });
  await client.execute('PRAGMA busy_timeout = 5000');
  return client;
}

/**
 * Delete a throwaway E2E signup user by email. Playwright tests assert
 * through HTTP/DB responses, never by reaching into the DB for behavior —
 * this is the one exception, and only for cleanup, so repeated local/CI runs
 * don't accumulate signup-test users that scripts/seed.ts doesn't know about.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  const client = await openLocalClient();
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
  const client = await openLocalClient();
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
  if (names.length === 0) {
    return;
  }
  const client = await openLocalClient();
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

/**
 * The products the receipt fixture's lines create when confirmed. Invented
 * names ("parole spia") so cleanup can never touch seeded or real data.
 */
const RECEIPT_FIXTURE_PRODUCT_NAMES = [
  'Pasta fenicottero n.5 500g',
  'Latte ornitorinco 1L',
  'Quokka fresco',
];

/**
 * Remove everything the receipt-import E2E suite writes for one user: the
 * entries it confirms, the products those entries created, the learned
 * aliases and the import records themselves.
 *
 * Order matters twice: price_entries.product_id blocks deleting a product
 * that still has history (Spec 02 §4.2), and price_entries.receipt_id would
 * merely be nulled by a receipt delete, leaving orphans behind.
 *
 * Called before each test, like resetCaptureFixtures, so a run that died
 * halfway cannot make the next attempt fail for the wrong reason.
 */
export async function resetReceiptFixtures(email: string): Promise<void> {
  const client = await openLocalClient();
  const owner = 'SELECT id FROM users WHERE email = ?';
  await client.execute({
    sql: `DELETE FROM price_entries
          WHERE source = 'receipt' AND user_id IN (${owner})`,
    args: [email],
  });
  await client.execute({
    sql: `DELETE FROM product_aliases WHERE user_id IN (${owner})`,
    args: [email],
  });
  await client.execute({
    sql: `DELETE FROM receipts WHERE user_id IN (${owner})`,
    args: [email],
  });
  // The products the confirm created. Guarded on "no entries left" so this
  // can never take a product that some other suite is still using, and
  // matched by the fixture's invented names so it can never take a real one.
  const placeholders = RECEIPT_FIXTURE_PRODUCT_NAMES.map(() => '?').join(', ');
  await client.execute({
    sql: `DELETE FROM products
          WHERE user_id IN (${owner})
            AND name IN (${placeholders})
            AND id NOT IN (SELECT product_id FROM price_entries)`,
    args: [email, ...RECEIPT_FIXTURE_PRODUCT_NAMES],
  });
  client.close();
}

export interface SeedReceiptInput {
  id: string;
  contentHash: string;
  purchasedAt: number;
  receiptTotalCents: number;
  extraction: unknown;
}

/**
 * Insert one receipt in status `extracted`, as POST /api/extract-receipt
 * would have.
 *
 * Why seeded rather than produced by the real route: the route's one
 * irreplaceable step is the `claude-haiku-4-5` call, which an E2E run must
 * not make (it costs money and its answer is not deterministic). Everything
 * downstream of the extraction — resolution, review, confirm, alias
 * learning — is then exercised for real against the real database.
 */
export async function seedExtractedReceipt(email: string, input: SeedReceiptInput): Promise<void> {
  const client = await openLocalClient();
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO receipts
            (id, user_id, store_id, status, purchased_at, receipt_total_cents, line_count,
             content_hash, file_kind, ai_model, ai_raw_json, confirmed_at, created_at, updated_at)
          SELECT ?, id, NULL, 'extracted', ?, ?, ?, ?, 'pdf', 'claude-haiku-4-5', ?, NULL, ?, ?
          FROM users WHERE email = ?`,
    args: [
      input.id,
      input.purchasedAt,
      input.receiptTotalCents,
      (input.extraction as { lines: unknown[] }).lines.length,
      input.contentHash,
      JSON.stringify(input.extraction),
      now,
      now,
      email,
    ],
  });
  client.close();
}
