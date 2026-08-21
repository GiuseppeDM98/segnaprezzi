/**
 * Price entry repository (Spec 02 §6.4). Every function is scoped by
 * userId — see the security rule in §6.1: no cross-user read or write is
 * representable through this layer.
 */
import { and, asc, desc, eq, gte, lt, lte, or } from 'drizzle-orm';

import type { Db } from '@/lib/db/client';
import {
  type NewPriceEntry,
  type PriceEntry,
  type Product,
  priceEntries,
  products,
} from '@/lib/db/schema/app';
import type { CategoryId } from '@/lib/domain/categories';
import { ValidationError } from '@/lib/errors';
import type { IndexEntry } from '@/lib/inflation/types';

export type CreatePriceEntryInput = Omit<
  NewPriceEntry,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
>;
export type UpdatePriceEntryPatch = Partial<
  Omit<CreatePriceEntryInput, 'source' | 'aiModel' | 'aiRawJson'>
>;

/** Insert one price entry and return the created row. */
export async function createPriceEntry(
  db: Db,
  userId: string,
  input: CreatePriceEntryInput,
): Promise<PriceEntry> {
  const [entry] = await db
    .insert(priceEntries)
    .values({ ...input, userId })
    .returning();
  return entry;
}

/**
 * Insert a batch of entries in one transaction (used by the /scan/review
 * confirm step, Spec 03). All-or-nothing.
 */
export async function createPriceEntries(
  db: Db,
  userId: string,
  inputs: CreatePriceEntryInput[],
): Promise<PriceEntry[]> {
  if (inputs.length === 0) {
    return [];
  }
  // A single multi-row INSERT is one atomic SQLite statement: if any row
  // violates a constraint (e.g. an unknown product_id), the whole
  // statement aborts and no rows are inserted.
  return db
    .insert(priceEntries)
    .values(inputs.map((input) => ({ ...input, userId })))
    .returning();
}

/** Fetch one entry by id, or null if it does not exist for this user. */
export async function getPriceEntryById(
  db: Db,
  userId: string,
  entryId: string,
): Promise<PriceEntry | null> {
  const [entry] = await db
    .select()
    .from(priceEntries)
    .where(and(eq(priceEntries.userId, userId), eq(priceEntries.id, entryId)));
  return entry ?? null;
}

/** Apply a partial correction (prices, promo flags, product/store links); null if not found. */
export async function updatePriceEntry(
  db: Db,
  userId: string,
  entryId: string,
  patch: UpdatePriceEntryPatch,
): Promise<PriceEntry | null> {
  const [entry] = await db
    .update(priceEntries)
    .set(patch)
    .where(and(eq(priceEntries.userId, userId), eq(priceEntries.id, entryId)))
    .returning();
  return entry ?? null;
}

/** Delete one entry. Returns false if not found. */
export async function deletePriceEntry(db: Db, userId: string, entryId: string): Promise<boolean> {
  const deleted = await db
    .delete(priceEntries)
    .where(and(eq(priceEntries.userId, userId), eq(priceEntries.id, entryId)))
    .returning({ id: priceEntries.id });
  return deleted.length > 0;
}

export interface ListPriceEntriesOptions {
  productId?: string;
  storeId?: string;
  category?: CategoryId;
  /** Inclusive lower bound on recorded_at. */
  recordedFrom?: Date;
  /** Inclusive upper bound on recorded_at. */
  recordedTo?: Date;
  /** Opaque cursor from a previous page's nextCursor. */
  cursor?: string;
  /** Page size; default 50, clamped to [1, 100]. */
  limit?: number;
}

export interface PriceEntryWithProduct extends PriceEntry {
  product: Pick<Product, 'id' | 'name' | 'brand' | 'category' | 'unitKind'>;
}

export interface PriceEntriesPage {
  entries: PriceEntryWithProduct[];
  /** Pass back as options.cursor to fetch the next page; null on the last page. */
  nextCursor: string | null;
}

/** Encode a keyset cursor as base64url of `${recordedAtMs}:${id}`. */
function encodePriceEntriesCursor(recordedAt: Date, id: string): string {
  return Buffer.from(`${recordedAt.getTime()}:${id}`, 'utf8').toString('base64url');
}

/** Decode a keyset cursor produced by encodePriceEntriesCursor; throws ValidationError if malformed. */
function decodePriceEntriesCursor(cursor: string): { ms: number; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    throw new ValidationError('Malformed price entries cursor');
  }

  const ms = Number(decoded.slice(0, separatorIndex));
  const id = decoded.slice(separatorIndex + 1);
  if (!Number.isFinite(ms) || id.length === 0) {
    throw new ValidationError('Malformed price entries cursor');
  }

  return { ms, id };
}

/**
 * List the user's entries newest-first with keyset pagination and optional
 * filters. Joins the product summary because every consumer (the /history
 * timeline) renders product name and category next to each entry.
 *
 * Cursor: keyset over (recorded_at DESC, id DESC) — the id tie-breaker makes
 * pagination stable when many entries share a timestamp, and inserting new
 * entries never shifts or duplicates already-fetched pages. Encoding:
 * base64url of `${recordedAtMs}:${id}`. A malformed cursor throws
 * ValidationError (surfaces as HTTP 400 at the boundary).
 */
export async function listPriceEntries(
  db: Db,
  userId: string,
  options: ListPriceEntriesOptions = {},
): Promise<PriceEntriesPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  const conditions = [eq(priceEntries.userId, userId)];

  if (options.productId) {
    conditions.push(eq(priceEntries.productId, options.productId));
  }
  if (options.storeId) {
    conditions.push(eq(priceEntries.storeId, options.storeId));
  }
  if (options.category) {
    conditions.push(eq(products.category, options.category));
  }
  if (options.recordedFrom) {
    conditions.push(gte(priceEntries.recordedAt, options.recordedFrom));
  }
  if (options.recordedTo) {
    conditions.push(lte(priceEntries.recordedAt, options.recordedTo));
  }
  if (options.cursor) {
    const { ms, id } = decodePriceEntriesCursor(options.cursor);
    const cursorDate = new Date(ms);
    const keysetCondition = or(
      lt(priceEntries.recordedAt, cursorDate),
      and(eq(priceEntries.recordedAt, cursorDate), lt(priceEntries.id, id)),
    );
    if (keysetCondition) {
      conditions.push(keysetCondition);
    }
  }

  // Fetch limit + 1 rows to know whether a next page exists without a
  // separate COUNT query.
  const rows = await db
    .select({
      entry: priceEntries,
      product: {
        id: products.id,
        name: products.name,
        brand: products.brand,
        category: products.category,
        unitKind: products.unitKind,
      },
    })
    .from(priceEntries)
    // Defense in depth: both the FK join and products.userId are checked,
    // so a category filter can never leak another user's product metadata.
    .innerJoin(products, and(eq(priceEntries.productId, products.id), eq(products.userId, userId)))
    .where(and(...conditions))
    .orderBy(desc(priceEntries.recordedAt), desc(priceEntries.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page.at(-1);

  return {
    entries: page.map((row) => ({ ...row.entry, product: row.product })),
    nextCursor:
      hasMore && lastRow
        ? encodePriceEntriesCursor(lastRow.entry.recordedAt, lastRow.entry.id)
        : null,
  };
}

/**
 * Minimal projection of ALL of the user's entries for the inflation engine
 * (Spec 04): monthly bucketing needs (productId, recordedAt, unitPriceMilli,
 * isPromo); category weights need (category, totalPriceCents). The DB's
 * Date surfaces here as epoch ms — IndexEntry.recordedAt is a number, and
 * the repository does the mapping. Ordered by recorded_at ascending.
 * Deliberately unpaginated — the engine is a pure function over the full
 * series (years of personal data stay in the low tens of thousands of rows).
 */
export async function listEntriesForIndex(db: Db, userId: string): Promise<IndexEntry[]> {
  const rows = await db
    .select({
      productId: priceEntries.productId,
      category: products.category,
      recordedAt: priceEntries.recordedAt,
      unitPriceMilli: priceEntries.unitPriceMilli,
      totalPriceCents: priceEntries.totalPriceCents,
      isPromo: priceEntries.isPromo,
    })
    .from(priceEntries)
    .innerJoin(products, and(eq(priceEntries.productId, products.id), eq(products.userId, userId)))
    .where(eq(priceEntries.userId, userId))
    .orderBy(asc(priceEntries.recordedAt));

  return rows.map((row) => ({ ...row, recordedAt: row.recordedAt.getTime() }));
}
