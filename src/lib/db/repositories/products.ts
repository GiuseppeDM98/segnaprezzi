/**
 * Product repository (Spec 02 §6.3). Every function is scoped by userId —
 * see the security rule in §6.1: no cross-user read or write is
 * representable through this layer.
 */
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';

import type { Db, DbTransaction } from '@/lib/db/client';
import { type NewProduct, type Product, priceEntries, products } from '@/lib/db/schema/app';
import type { CategoryId } from '@/lib/domain/categories';
import { NotFoundError } from '@/lib/errors';
import type { IndexProduct } from '@/lib/inflation/types';

export type CreateProductInput = Omit<NewProduct, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
export type UpdateProductPatch = Partial<CreateProductInput>;

export interface ListProductsOptions {
  category?: CategoryId;
  /** Case-insensitive substring match on name and brand. */
  search?: string;
  /** Default false: archived products are hidden from lists and suggestions. */
  includeArchived?: boolean;
}

/** Insert a product for the user and return the created row. */
export async function createProduct(
  db: Db | DbTransaction,
  userId: string,
  input: CreateProductInput,
): Promise<Product> {
  const [product] = await db
    .insert(products)
    .values({ ...input, userId })
    .returning();
  return product;
}

/** List the user's products with optional filters, ordered by name. */
export async function listProducts(
  db: Db | DbTransaction,
  userId: string,
  options: ListProductsOptions = {},
): Promise<Product[]> {
  const conditions = [eq(products.userId, userId)];

  if (!options.includeArchived) {
    conditions.push(eq(products.isArchived, false));
  }
  if (options.category) {
    conditions.push(eq(products.category, options.category));
  }
  if (options.search) {
    const pattern = `%${options.search.toLowerCase()}%`;
    const searchCondition = or(
      like(sql`lower(${products.name})`, pattern),
      like(sql`lower(${products.brand})`, pattern),
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  return db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.name));
}

/** Fetch one product by id, or null if it does not exist for this user. */
export async function getProductById(
  db: Db | DbTransaction,
  userId: string,
  productId: string,
): Promise<Product | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.userId, userId), eq(products.id, productId)));
  return product ?? null;
}

/** Apply a partial update (including is_archived); returns the row, or null if not found. */
export async function updateProduct(
  db: Db,
  userId: string,
  productId: string,
  patch: UpdateProductPatch,
): Promise<Product | null> {
  const [product] = await db
    .update(products)
    .set(patch)
    .where(and(eq(products.userId, userId), eq(products.id, productId)))
    .returning();
  return product ?? null;
}

export interface MergeProductsResult {
  movedEntriesCount: number;
}

/**
 * Merge duplicate products: move every price entry from source to target,
 * then archive the source product — all in ONE transaction, so a failure
 * leaves both products untouched.
 *
 * The source is archived rather than deleted: deletion would be blocked by
 * the FK restrict if any entry slipped in concurrently, and archiving keeps
 * the merge trivially reversible by hand.
 *
 * Throws NotFoundError if either product does not exist for this user, or
 * if sourceProductId === targetProductId (self-merge is a caller bug).
 */
export async function mergeProducts(
  db: Db,
  userId: string,
  sourceProductId: string,
  targetProductId: string,
): Promise<MergeProductsResult> {
  return await db.transaction(async (tx) => {
    // Verify both endpoints inside the transaction — user scoping included.
    const [source, target] = await Promise.all([
      getProductById(tx, userId, sourceProductId),
      getProductById(tx, userId, targetProductId),
    ]);
    if (!source) {
      throw new NotFoundError('product', sourceProductId);
    }
    if (!target || sourceProductId === targetProductId) {
      // Why: a self-merge is a caller bug; treating it as a missing target
      // aborts the transaction without inventing a dedicated error code.
      throw new NotFoundError('product', targetProductId);
    }

    // Move entries, then archive the source.
    const moved = await tx
      .update(priceEntries)
      .set({ productId: targetProductId })
      .where(and(eq(priceEntries.userId, userId), eq(priceEntries.productId, sourceProductId)))
      .returning({ id: priceEntries.id });

    await tx
      .update(products)
      .set({ isArchived: true })
      .where(and(eq(products.userId, userId), eq(products.id, sourceProductId)));

    return { movedEntriesCount: moved.length };
  });
}

/**
 * Fetch the given product ids that belong to this user, in one IN (...)
 * query. Used by the batch-confirm flow (Spec 03 §9.3 step 3) to verify a
 * whole review batch's product picks without an N+1 loop; ids that belong to
 * another user (or do not exist) are simply absent from the result.
 */
export async function listProductsByIds(
  db: Db | DbTransaction,
  userId: string,
  productIds: string[],
): Promise<Product[]> {
  if (productIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(products)
    .where(and(eq(products.userId, userId), inArray(products.id, productIds)));
}

/**
 * Minimal projection of every product of the user for the inflation engine
 * (Spec 04 §9): id, name, brand, category — archived products included,
 * because their entries stay in the index history. Ordered by id so the
 * engine's input is deterministic.
 */
export async function listProductsForIndex(db: Db, userId: string): Promise<IndexProduct[]> {
  return db
    .select({
      id: products.id,
      name: products.name,
      brand: products.brand,
      category: products.category,
    })
    .from(products)
    .where(eq(products.userId, userId))
    .orderBy(asc(products.id));
}

/**
 * Insert-or-update products by id for the backup import (Spec 05 §5.10);
 * same ownership guard as upsertStores — foreign ids are skipped.
 */
export async function upsertProducts(
  db: Db | DbTransaction,
  userId: string,
  inputs: Array<CreateProductInput & { id: string }>,
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  await db
    .insert(products)
    .values(inputs.map((input) => ({ ...input, userId })))
    .onConflictDoUpdate({
      target: products.id,
      set: {
        name: sql`excluded.name`,
        brand: sql`excluded.brand`,
        category: sql`excluded.category`,
        unitKind: sql`excluded.unit_kind`,
        notes: sql`excluded.notes`,
        isArchived: sql`excluded.is_archived`,
      },
      setWhere: eq(products.userId, userId),
    });
}

/** Ids of every product of the user (archived included), for import integrity checks. */
export async function listProductIds(db: Db | DbTransaction, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.userId, userId));
  return new Set(rows.map((row) => row.id));
}
