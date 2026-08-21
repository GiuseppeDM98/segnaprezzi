/**
 * Store repository (Spec 02 §6.2). Every function is scoped by userId —
 * see the security rule in §6.1: no cross-user read or write is
 * representable through this layer.
 */
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Db, DbTransaction } from '@/lib/db/client';
import { type NewStore, type Store, stores } from '@/lib/db/schema/app';

export type CreateStoreInput = Omit<NewStore, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
export type UpdateStorePatch = Partial<CreateStoreInput>;

/** Insert a store for the user and return the created row. */
export async function createStore(db: Db, userId: string, input: CreateStoreInput): Promise<Store> {
  const [store] = await db
    .insert(stores)
    .values({ ...input, userId })
    .returning();
  return store;
}

/** List all of the user's stores, ordered by name (case-insensitive). */
export async function listStores(db: Db | DbTransaction, userId: string): Promise<Store[]> {
  return db.select().from(stores).where(eq(stores.userId, userId)).orderBy(asc(stores.name));
}

/** Fetch one store by id, or null if it does not exist for this user. */
export async function getStoreById(
  db: Db | DbTransaction,
  userId: string,
  storeId: string,
): Promise<Store | null> {
  const [store] = await db
    .select()
    .from(stores)
    .where(and(eq(stores.userId, userId), eq(stores.id, storeId)));
  return store ?? null;
}

/** Apply a partial update; returns the updated row, or null if not found. */
export async function updateStore(
  db: Db,
  userId: string,
  storeId: string,
  patch: UpdateStorePatch,
): Promise<Store | null> {
  const [store] = await db
    .update(stores)
    .set(patch)
    .where(and(eq(stores.userId, userId), eq(stores.id, storeId)))
    .returning();
  return store ?? null;
}

/**
 * Delete a store. Entries and sessions referencing it keep existing with
 * store_id = NULL (FK action). Returns false if not found.
 */
export async function deleteStore(db: Db, userId: string, storeId: string): Promise<boolean> {
  const deleted = await db
    .delete(stores)
    .where(and(eq(stores.userId, userId), eq(stores.id, storeId)))
    .returning({ id: stores.id });
  return deleted.length > 0;
}

/**
 * Insert-or-update stores by id for the backup import (Spec 05 §5.10).
 * The conflict update is guarded by user_id, so an id that belongs to
 * another user is neither overwritten nor inserted — it is silently skipped.
 */
export async function upsertStores(
  db: Db | DbTransaction,
  userId: string,
  inputs: Array<CreateStoreInput & { id: string }>,
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  await db
    .insert(stores)
    .values(inputs.map((input) => ({ ...input, userId })))
    .onConflictDoUpdate({
      target: stores.id,
      set: {
        name: sql`excluded.name`,
        chain: sql`excluded.chain`,
        city: sql`excluded.city`,
        kind: sql`excluded.kind`,
      },
      setWhere: eq(stores.userId, userId),
    });
}
