/**
 * Shopping session repository (Spec 02 §6.5). Every function is scoped by
 * userId — see the security rule in §6.1: no cross-user read or write is
 * representable through this layer.
 */
import { and, desc, eq } from 'drizzle-orm';

import type { Db } from '@/lib/db/client';
import {
  type NewShoppingSession,
  type ShoppingSession,
  shoppingSessions,
} from '@/lib/db/schema/app';

export type CreateShoppingSessionInput = Pick<NewShoppingSession, 'storeId'>;
export type UpdateShoppingSessionPatch = Partial<
  Pick<NewShoppingSession, 'storeId' | 'status' | 'completedAt'>
>;

/** Insert a session with status 'active' and startedAt = now; return the row. */
export async function createShoppingSession(
  db: Db,
  userId: string,
  input?: CreateShoppingSessionInput,
): Promise<ShoppingSession> {
  const [session] = await db
    .insert(shoppingSessions)
    .values({ storeId: input?.storeId, userId })
    .returning();
  return session;
}

/** Fetch one session by id, or null if it does not exist for this user. */
export async function getShoppingSessionById(
  db: Db,
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
  db: Db,
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
