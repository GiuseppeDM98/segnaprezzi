/**
 * Receipt repository. Every function is scoped by userId — no cross-user
 * read or write is representable through this layer.
 */
import { and, desc, eq } from 'drizzle-orm';

import type { Db, DbTransaction } from '@/lib/db/client';
import { type NewReceipt, type Receipt, receipts } from '@/lib/db/schema/app';

export type CreateReceiptInput = Omit<NewReceipt, 'userId' | 'createdAt' | 'updatedAt'>;
export type UpdateReceiptPatch = Partial<Omit<CreateReceiptInput, 'id'>>;

/** Insert a receipt for the user and return the created row. */
export async function createReceipt(
  db: Db | DbTransaction,
  userId: string,
  input: CreateReceiptInput,
): Promise<Receipt> {
  const [receipt] = await db
    .insert(receipts)
    .values({ ...input, userId })
    .returning();
  return receipt;
}

/** Fetch one receipt by id, or null if it does not exist for this user. */
export async function getReceiptById(
  db: Db | DbTransaction,
  userId: string,
  receiptId: string,
): Promise<Receipt | null> {
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.userId, userId), eq(receipts.id, receiptId)));
  return receipt ?? null;
}

/**
 * Fetch the receipt this user already imported from a file with this exact
 * content. The `(user_id, content_hash)` unique index makes at most one row
 * possible.
 */
export async function getReceiptByHash(
  db: Db | DbTransaction,
  userId: string,
  contentHash: string,
): Promise<Receipt | null> {
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.userId, userId), eq(receipts.contentHash, contentHash)));
  return receipt ?? null;
}

/** Apply a partial update; returns the updated row, or null if not found. */
export async function updateReceipt(
  db: Db | DbTransaction,
  userId: string,
  receiptId: string,
  patch: UpdateReceiptPatch,
): Promise<Receipt | null> {
  const [receipt] = await db
    .update(receipts)
    .set(patch)
    .where(and(eq(receipts.userId, userId), eq(receipts.id, receiptId)))
    .returning();
  return receipt ?? null;
}

/** Every receipt of the user, newest purchase first — for the data export. */
export async function listReceipts(db: Db | DbTransaction, userId: string): Promise<Receipt[]> {
  return db
    .select()
    .from(receipts)
    .where(eq(receipts.userId, userId))
    .orderBy(desc(receipts.purchasedAt));
}
