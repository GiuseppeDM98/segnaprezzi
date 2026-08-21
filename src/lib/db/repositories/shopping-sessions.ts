/**
 * Shopping session repository (Spec 02 §6.5). Every function is scoped by
 * userId — see the security rule in §6.1: no cross-user read or write is
 * representable through this layer.
 */
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import type { Db, DbTransaction } from '@/lib/db/client';
import {
  type NewShoppingSession,
  type ShoppingSession,
  shoppingSessions,
} from '@/lib/db/schema/app';

export type CreateShoppingSessionInput = Pick<NewShoppingSession, 'storeId'> & {
  /**
   * Explicit session id. Normally ids are minted by the schema's $defaultFn,
   * but a shopping session starts on a phone with no connectivity (Spec 03
   * §2.2): the client generates the id at the first shutter press and the
   * server materializes the row under that id later. Omitted elsewhere.
   */
  id?: string;
};
export type UpdateShoppingSessionPatch = Partial<
  Pick<NewShoppingSession, 'storeId' | 'status' | 'completedAt'>
>;

/** Insert a session with status 'active' and startedAt = now; return the row. */
export async function createShoppingSession(
  db: Db | DbTransaction,
  userId: string,
  input?: CreateShoppingSessionInput,
): Promise<ShoppingSession> {
  const [session] = await db
    .insert(shoppingSessions)
    .values({ id: input?.id, storeId: input?.storeId, userId })
    .returning();
  return session;
}

/** Fetch one session by id, or null if it does not exist for this user. */
export async function getShoppingSessionById(
  db: Db | DbTransaction,
  userId: string,
  sessionId: string,
): Promise<ShoppingSession | null> {
  const [session] = await db
    .select()
    .from(shoppingSessions)
    .where(and(eq(shoppingSessions.userId, userId), eq(shoppingSessions.id, sessionId)));
  return session ?? null;
}

/**
 * The user's most recent session with status 'active', or null. The
 * "at most one active session" rule is enforced by the service layer
 * (Spec 03), not here.
 */
export async function getActiveShoppingSession(
  db: Db,
  userId: string,
): Promise<ShoppingSession | null> {
  const [session] = await db
    .select()
    .from(shoppingSessions)
    .where(and(eq(shoppingSessions.userId, userId), eq(shoppingSessions.status, 'active')))
    .orderBy(desc(shoppingSessions.startedAt))
    .limit(1);
  return session ?? null;
}

/** Apply a partial update (status transitions, store, completion time); null if not found. */
export async function updateShoppingSession(
  db: Db | DbTransaction,
  userId: string,
  sessionId: string,
  patch: UpdateShoppingSessionPatch,
): Promise<ShoppingSession | null> {
  const [session] = await db
    .update(shoppingSessions)
    .set(patch)
    .where(and(eq(shoppingSessions.userId, userId), eq(shoppingSessions.id, sessionId)))
    .returning();
  return session ?? null;
}

/** List the user's sessions newest-first; limit defaults to 20, clamped to [1, 100]. */
export async function listShoppingSessions(
  db: Db,
  userId: string,
  options?: { limit?: number },
): Promise<ShoppingSession[]> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);

  return db
    .select()
    .from(shoppingSessions)
    .where(eq(shoppingSessions.userId, userId))
    .orderBy(desc(shoppingSessions.startedAt))
    .limit(limit);
}

/** Statuses a session can still be resumed or written to (Spec 03 §2.1). */
const OPEN_SESSION_STATUSES = ['active', 'reviewing'] as const;

/**
 * The user's newest session that is still open (`active` or `reviewing`), or
 * null. Powers the /scan resume banner (Spec 03 §2.3), which must also catch
 * a spesa left mid-review on another device — hence `reviewing`, which
 * getActiveShoppingSession deliberately excludes.
 */
export async function getResumableShoppingSession(
  db: Db,
  userId: string,
): Promise<ShoppingSession | null> {
  const [session] = await db
    .select()
    .from(shoppingSessions)
    .where(
      and(
        eq(shoppingSessions.userId, userId),
        inArray(shoppingSessions.status, [...OPEN_SESSION_STATUSES]),
      ),
    )
    .orderBy(desc(shoppingSessions.startedAt))
    .limit(1);
  return session ?? null;
}

/**
 * Discard every open session of the user except `keepSessionId`.
 *
 * Enforces "one active spesa per user" (Spec 03 §2.2 rule 3) at the service
 * layer's request: starting a new shopping trip abandons an unfinished one.
 * It is not a DB constraint because libSQL partial unique indexes would
 * fight the lazy-materialization flow.
 *
 * @returns How many sessions were discarded
 */
export async function discardOtherOpenShoppingSessions(
  db: Db | DbTransaction,
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const discarded = await db
    .update(shoppingSessions)
    .set({ status: 'discarded' })
    .where(
      and(
        eq(shoppingSessions.userId, userId),
        ne(shoppingSessions.id, keepSessionId),
        inArray(shoppingSessions.status, [...OPEN_SESSION_STATUSES]),
      ),
    )
    .returning({ id: shoppingSessions.id });
  return discarded.length;
}

/**
 * Whether a session id is already taken, by anyone.
 *
 * The one deliberately unscoped query in this layer. Sessions carry
 * client-generated ids (Spec 03 §2.2), so "this id is not yours" and "this id
 * does not exist" must be told apart before inserting — otherwise the insert
 * collides with another user's row and surfaces as a raw constraint error.
 * It returns a boolean and nothing else: the caller reports both cases as
 * not-found, so no information about foreign sessions ever leaves the server.
 */
export async function isShoppingSessionIdTaken(
  db: Db | DbTransaction,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: shoppingSessions.id })
    .from(shoppingSessions)
    .where(eq(shoppingSessions.id, sessionId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Insert-or-update sessions by id for the backup import (Spec 05 §5.10);
 * foreign ids are skipped by the user_id guard.
 */
export async function upsertShoppingSessions(
  db: Db | DbTransaction,
  userId: string,
  inputs: Array<{
    id: string;
    storeId: string | null;
    status: ShoppingSession['status'];
    startedAt: Date;
    completedAt: Date | null;
  }>,
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  await db
    .insert(shoppingSessions)
    .values(inputs.map((input) => ({ ...input, userId })))
    .onConflictDoUpdate({
      target: shoppingSessions.id,
      set: {
        storeId: sql`excluded.store_id`,
        status: sql`excluded.status`,
        startedAt: sql`excluded.started_at`,
        completedAt: sql`excluded.completed_at`,
      },
      setWhere: eq(shoppingSessions.userId, userId),
    });
}

/** Ids of every session of the user, for import integrity checks. */
export async function listShoppingSessionIds(
  db: Db | DbTransaction,
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ id: shoppingSessions.id })
    .from(shoppingSessions)
    .where(eq(shoppingSessions.userId, userId));
  return new Set(rows.map((row) => row.id));
}
