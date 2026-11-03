import { type Client, createClient } from '@libsql/client';

/**
 * Open the local file database with the same busy timeout the app client
 * sets (AGENTS.md §4.18): these helpers run from parallel Playwright workers
 * while the app server writes, and a raw client without it surfaces
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
 * Run `work` on a fresh local client and close it whatever happens: a helper
 * whose statement throws must not leak its handle, or the file stays open for
 * the rest of the Playwright worker.
 */
async function withLocalClient(work: (client: Client) => Promise<void>): Promise<void> {
  const client = await openLocalClient();
  try {
    await work(client);
  } finally {
    client.close();
  }
}

/**
 * Delete a throwaway E2E signup user by email, so repeated local/CI runs
 * don't accumulate signup-test users that scripts/seed.ts doesn't know about.
 * Playwright tests assert through HTTP responses, never by reaching into the
 * DB for behavior; the helpers in this file touch it only to clean up after a
 * suite.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  await withLocalClient(async (client) => {
    await client.execute({ sql: 'DELETE FROM users WHERE email = ?', args: [email] });
  });
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
  await withLocalClient(async (client) => {
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
  });
}

/**
 * Remove the products an E2E suite created, by name, and the entries that
 * reference them.
 *
 * Order matters: price_entries.product_id blocks deleting a product that
 * still has history, which is exactly the guarantee the app
 * relies on — so the entries go first.
 */
export async function deleteProductsByName(email: string, names: string[]): Promise<void> {
  if (names.length === 0) {
    return;
  }
  const placeholders = names.map(() => '?').join(', ');
  const selectProducts = `SELECT id FROM products
     WHERE name IN (${placeholders})
       AND user_id IN (SELECT id FROM users WHERE email = ?)`;
  await withLocalClient(async (client) => {
    await client.execute({
      sql: `DELETE FROM price_entries WHERE product_id IN (${selectProducts})`,
      args: [...names, email],
    });
    await client.execute({
      sql: `DELETE FROM products WHERE id IN (${selectProducts})`,
      args: [...names, email],
    });
  });
}

/** One observation for insertPriceObservations; figures are the suite's own. */
export interface PriceObservation {
  product: string;
  category: string;
  store: string;
  /** 'YYYY-MM'; the entry lands in the middle of that month. */
  ym: string;
  milli: number;
}

/**
 * Give a throwaway user a price history directly, products and stores included.
 *
 * Why the database and not the forms: a dated history across months is the
 * arrangement of a dashboard test, not its subject, and the forms always record
 * today. Ids are random-shaped but stable within one call.
 */
export async function insertPriceObservations(
  email: string,
  observations: PriceObservation[],
): Promise<void> {
  const now = Date.now();
  const idOf = (kind: string, name: string) =>
    `e2e${kind}${name.replace(/\W/g, '')}`.padEnd(21, '0').slice(0, 21);
  await withLocalClient(async (client) => {
    const users = await client.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email],
    });
    const userId = String(users.rows[0].id);
    for (const [index, observation] of observations.entries()) {
      const productId = idOf('p', observation.product);
      const storeId = idOf('s', observation.store);
      await client.execute({
        sql: `INSERT OR IGNORE INTO products (id, user_id, name, category, unit_kind, is_archived, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'weight', 0, ?, ?)`,
        args: [productId, userId, observation.product, observation.category, now, now],
      });
      await client.execute({
        sql: `INSERT OR IGNORE INTO stores (id, user_id, name, kind, created_at, updated_at)
              VALUES (?, ?, ?, 'supermarket', ?, ?)`,
        args: [storeId, userId, observation.store, now, now],
      });
      await client.execute({
        sql: `INSERT INTO price_entries (id, user_id, product_id, store_id, recorded_at, total_price_cents, quantity, package_size, unit_price_milli, is_promo, source, currency, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 0, 'manual', 'EUR', ?, ?)`,
        args: [
          idOf('e', `${index}${observation.product}`),
          userId,
          productId,
          storeId,
          Date.parse(`${observation.ym}-15T10:00:00Z`),
          Math.round(observation.milli / 10),
          observation.milli,
          now,
          now,
        ],
      });
    }
  });
}
