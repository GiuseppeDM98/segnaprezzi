/**
 * Product alias repository. Every function is scoped by userId — aliases
 * are private learned data, never shared.
 *
 * Design note on upserting: `(user_id, alias, store_chain)` is a UNIQUE
 * index, but SQLite treats NULLs as DISTINCT inside one, so two aliases
 * learned from receipts with no known chain do NOT collide and
 * `onConflictDoUpdate` never fires for them. Every write here therefore
 * looks the row up first and updates it explicitly. Both call sites run
 * inside a transaction, so the read-then-write is atomic.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Db, DbTransaction } from '@/lib/db/client';
import { type ProductAlias, productAliases } from '@/lib/db/schema/app';

export interface LearnAliasInput {
  productId: string;
  /** Already normalized by normalizeAlias — the repository never transforms it. */
  alias: string;
  storeChain: string | null;
  lastSeenAt: Date;
}

/** Every alias of the user, for the receipt line resolver. */
export async function listProductAliases(
  db: Db | DbTransaction,
  userId: string,
): Promise<ProductAlias[]> {
  return db.select().from(productAliases).where(eq(productAliases.userId, userId));
}

/** The aliases pointing at one product, most-used first. */
export async function listAliasesForProduct(
  db: Db | DbTransaction,
  userId: string,
  productId: string,
): Promise<ProductAlias[]> {
  return db
    .select()
    .from(productAliases)
    .where(and(eq(productAliases.userId, userId), eq(productAliases.productId, productId)))
    .orderBy(sql`${productAliases.hitCount} desc`, productAliases.alias);
}

/**
 * Remember (or re-confirm) a batch of receipt-line → product mappings.
 *
 * An alias already pointing at the same product has its `hit_count`
 * incremented; one pointing elsewhere is re-pointed, because the user just
 * corrected it. Returns nothing — nobody needs the rows back.
 */
export async function learnProductAliases(
  db: Db | DbTransaction,
  userId: string,
  inputs: LearnAliasInput[],
): Promise<void> {
  for (const input of inputs) {
    const [existing] = await db
      .select({ id: productAliases.id, productId: productAliases.productId })
      .from(productAliases)
      .where(aliasKeyCondition(userId, input.alias, input.storeChain));

    if (!existing) {
      await db.insert(productAliases).values({
        userId,
        productId: input.productId,
        alias: input.alias,
        storeChain: input.storeChain,
        hitCount: 1,
        lastSeenAt: input.lastSeenAt,
      });
      continue;
    }

    await db
      .update(productAliases)
      .set({
        productId: input.productId,
        hitCount: sql`${productAliases.hitCount} + 1`,
        lastSeenAt: input.lastSeenAt,
      })
      .where(and(eq(productAliases.userId, userId), eq(productAliases.id, existing.id)));
  }
}

/**
 * Move every alias of one product onto another, summing `hit_count` where
 * both products had learned the same abbreviation.
 *
 * Called inside the merge transaction: without it the survivor would lose
 * everything the archived duplicate had learned, and the next receipt would
 * fall back to fuzzy matching for lines that used to resolve instantly.
 *
 * @returns How many aliases now point at the target
 */
export async function moveProductAliases(
  db: Db | DbTransaction,
  userId: string,
  fromProductId: string,
  toProductId: string,
): Promise<number> {
  const sources = await db
    .select()
    .from(productAliases)
    .where(and(eq(productAliases.userId, userId), eq(productAliases.productId, fromProductId)));

  for (const source of sources) {
    const [conflict] = await db
      .select({
        id: productAliases.id,
        hitCount: productAliases.hitCount,
        lastSeenAt: productAliases.lastSeenAt,
      })
      .from(productAliases)
      .where(
        and(
          aliasKeyCondition(userId, source.alias, source.storeChain),
          eq(productAliases.productId, toProductId),
        ),
      );

    if (!conflict) {
      await db
        .update(productAliases)
        .set({ productId: toProductId })
        .where(and(eq(productAliases.userId, userId), eq(productAliases.id, source.id)));
      continue;
    }

    await db
      .update(productAliases)
      .set({
        hitCount: conflict.hitCount + source.hitCount,
        lastSeenAt:
          source.lastSeenAt > conflict.lastSeenAt ? source.lastSeenAt : conflict.lastSeenAt,
      })
      .where(and(eq(productAliases.userId, userId), eq(productAliases.id, conflict.id)));
    await db
      .delete(productAliases)
      .where(and(eq(productAliases.userId, userId), eq(productAliases.id, source.id)));
  }

  return sources.length;
}

/** Forget one alias. Returns false if it is not the user's. */
export async function deleteProductAlias(
  db: Db | DbTransaction,
  userId: string,
  aliasId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(productAliases)
    .where(and(eq(productAliases.userId, userId), eq(productAliases.id, aliasId)))
    .returning({ id: productAliases.id });
  return deleted.length > 0;
}

/** Insert-or-update aliases by id for the backup import. */
export async function upsertProductAliases(
  db: Db | DbTransaction,
  userId: string,
  inputs: Array<{
    id: string;
    productId: string;
    alias: string;
    storeChain: string | null;
    hitCount: number;
    lastSeenAt: Date;
  }>,
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  await db
    .insert(productAliases)
    .values(inputs.map((input) => ({ ...input, userId })))
    .onConflictDoUpdate({
      target: productAliases.id,
      set: {
        productId: sql`excluded.product_id`,
        alias: sql`excluded.alias`,
        storeChain: sql`excluded.store_chain`,
        hitCount: sql`excluded.hit_count`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
      setWhere: eq(productAliases.userId, userId),
    });
}

/** `(user_id, alias, store_chain)` with NULL compared as NULL, not as a value. */
function aliasKeyCondition(userId: string, alias: string, storeChain: string | null) {
  return and(
    eq(productAliases.userId, userId),
    eq(productAliases.alias, alias),
    storeChain === null
      ? isNull(productAliases.storeChain)
      : eq(productAliases.storeChain, storeChain),
  );
}
