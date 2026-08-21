/**
 * Test database factory.
 *
 * Design: applies the exact committed migrations under drizzle/ via
 * Drizzle's programmatic migrator, so tests run against the same SQL
 * production runs — schema drift between tests and prod is impossible.
 *
 * Design note (verified empirically): the natural choice here would be
 * `createClient({ url: ':memory:' })`. With the installed @libsql/client
 * (0.17.4) + drizzle-orm (0.45.2), an anonymous `:memory:` database is torn
 * down and silently recreated empty the moment any db.transaction()
 * callback throws (verified with a minimal repro: a table created before
 * the transaction becomes "no such table" immediately after a rolled-back
 * transaction on the same connection) — which breaks exactly the
 * transactional-rollback tests this project relies on (mergeProducts).
 * `file::memory:?cache=shared` avoids that crash but shares ONE anonymous
 * database across every client in the process (verified: a second,
 * unrelated client immediately sees the first client's rows) — the opposite
 * problem, breaking "fresh isolated DB per test". @libsql/client also
 * rejects the usual SQLite named-memory-db escape hatch
 * (`file:name?mode=memory&cache=shared` — "Unsupported URL query parameter
 * 'mode'"). A uniquely-named temp file per call sidesteps all three issues
 * while keeping the same fresh-migrated-DB-per-test contract; the temp
 * directory is removed on process exit.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { nanoid } from 'nanoid';

import type { Db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { users } from '@/lib/db/schema/auth';

let testDbRoot: string | undefined;
let cleanupRegistered = false;

function getTestDbRoot(): string {
  if (!testDbRoot) {
    testDbRoot = mkdtempSync(join(tmpdir(), 'segnaprezzi-test-db-'));
  }
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.on('exit', () => {
      if (testDbRoot && existsSync(testDbRoot)) {
        rmSync(testDbRoot, { recursive: true, force: true });
      }
    });
  }
  return testDbRoot;
}

/** Create a fresh, isolated database with the real schema applied. */
export async function createTestDb(): Promise<{ db: Db; client: Client }> {
  const root = getTestDbRoot();
  mkdirSync(root, { recursive: true });
  const dbPath = join(root, `${randomUUID()}.db`);

  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema }) as unknown as Db;

  await migrate(db, { migrationsFolder: 'drizzle' });

  return { db, client };
}

/**
 * Insert a row directly into `users` for repository tests — repositories
 * only need the FK target, no real auth flow is involved.
 */
export async function createTestUser(
  db: Db,
  overrides?: Partial<typeof users.$inferInsert>,
): Promise<{ id: string }> {
  const id = overrides?.id ?? `test-user-${nanoid()}`;
  const [row] = await db
    .insert(users)
    .values({
      id,
      name: 'Test User',
      email: `${id}@example.test`,
      emailVerified: false,
      ...overrides,
    })
    .returning({ id: users.id });

  return row;
}
