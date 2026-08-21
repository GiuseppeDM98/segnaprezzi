/**
 * libSQL client + Drizzle instance, shared by the whole server side.
 *
 * Design: a module-level singleton cached on globalThis. Next.js dev HMR
 * re-evaluates modules on every edit; without the cache each reload would
 * leak a libSQL connection. In production the module is evaluated once,
 * so the cache is a no-op.
 */
import { type Client, createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

import { env } from '@/lib/env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { libsqlClient?: Client };

const isNewClient = !globalForDb.libsqlClient;
const client =
  globalForDb.libsqlClient ??
  createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN || undefined,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.libsqlClient = client;
}

// Why: a local file database defaults to SQLite's rollback-journal mode,
// which serializes readers and writers so tightly that a handful of
// concurrent requests (verified: Playwright's parallel workers hitting
// GET /api/export) throws "SQLITE_BUSY: database is locked" outright
// instead of queuing. WAL lets reads and writes proceed concurrently, and
// a busy_timeout retries briefly instead of failing immediately on the
// contention WAL doesn't eliminate. Remote Turso already runs its own
// concurrency-safe server, so this only applies to local file: URLs, and
// only once per process (the HMR-cached client would otherwise re-run it
// on every module reload).
//
// Not awaited (top-level await breaks tsx's CJS transform for scripts/*
// that import this module): safe because @libsql/client's local driver
// executes synchronously under the hood (a native binding, not real async
// I/O), so these two calls run to completion before this module finishes
// evaluating and control returns to any caller — before any other query
// on this client can be issued. journal_mode=WAL is also persisted in the
// database file itself, so even in the worst case this races, the file is
// permanently switched to WAL after the first successful run.
if (isNewClient && env.TURSO_DATABASE_URL.startsWith('file:')) {
  void client.execute('PRAGMA journal_mode = WAL');
  void client.execute('PRAGMA busy_timeout = 5000');
}

export const db = drizzle(client, { schema });

/** The concrete Drizzle database type; repositories accept it as their first parameter. */
export type Db = typeof db;

/** A Drizzle transaction object; repositories that run inside db.transaction() accept this too. */
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
