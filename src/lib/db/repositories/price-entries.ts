/**
 * Price entry repository. Every function is scoped by userId — no
 * cross-user read or write is representable through this layer.
 */
import { and, asc, count, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';

import type { Db, DbTransaction } from '@/lib/db/client';
import {
  type NewPriceEntry,
  type PriceEntry,
  type Product,
  priceEntries,
  products,
  type Store,
  stores,
} from '@/lib/db/schema/app';
import type { CategoryId } from '@/lib/domain/categories';
import type { EntrySource } from '@/lib/domain/entries';
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
  db: Db | DbTransaction,
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
 * confirm step). All-or-nothing.
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
  /** Only promo (true) or only full-price (false) observations. */
  isPromo?: boolean;
  source?: EntrySource;
  /** Opaque cursor from a previous page's nextCursor. */
  cursor?: string;
  /** Page size; default 50, clamped to [1, 100]. */
  limit?: number;
}

export interface PriceEntryWithProduct extends PriceEntry {
  product: Pick<Product, 'id' | 'name' | 'brand' | 'category' | 'unitKind'>;
  /** The store summary, or null for generic purchases / deleted stores. */
  store: Pick<Store, 'id' | 'name'> | null;
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
  if (options.isPromo !== undefined) {
    conditions.push(eq(priceEntries.isPromo, options.isPromo));
  }
  if (options.source) {
    conditions.push(eq(priceEntries.source, options.source));
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
      storeId: stores.id,
      storeName: stores.name,
    })
    .from(priceEntries)
    // Defense in depth: both the FK join and products.userId are checked,
    // so a category filter can never leak another user's product metadata.
    .innerJoin(products, and(eq(priceEntries.productId, products.id), eq(products.userId, userId)))
    // The store is optional (generic purchases) and user-scoped the same way.
    .leftJoin(stores, and(eq(priceEntries.storeId, stores.id), eq(stores.userId, userId)))
    .where(and(...conditions))
    .orderBy(desc(priceEntries.recordedAt), desc(priceEntries.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page.at(-1);

  return {
    entries: page.map((row) => ({
      ...row.entry,
      product: row.product,
      store: row.storeId && row.storeName ? { id: row.storeId, name: row.storeName } : null,
    })),
    nextCursor:
      hasMore && lastRow
        ? encodePriceEntriesCursor(lastRow.entry.recordedAt, lastRow.entry.id)
        : null,
  };
}

/**
 * Minimal projection of ALL of the user's entries for the inflation engine:
 * monthly bucketing needs (productId, recordedAt, unitPriceMilli,
 * isPromo); category weights need (category, totalPriceCents, quantity). The
 * DB's Date surfaces here as epoch ms — IndexEntry.recordedAt is a number,
 * and the repository does the mapping. Ordered by recorded_at ascending.
 * Includes entries of archived products — archiving hides a product from
 * suggestions, never from history.
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
      // A receipt line bought twice is one observation with quantity 2 —
      // the monthly mean ignores it, the expenditure weights multiply by it.
      quantity: priceEntries.quantity,
      isPromo: priceEntries.isPromo,
    })
    .from(priceEntries)
    .innerJoin(products, and(eq(priceEntries.productId, products.id), eq(products.userId, userId)))
    .where(eq(priceEntries.userId, userId))
    .orderBy(asc(priceEntries.recordedAt));

  return rows.map((row) => ({ ...row, recordedAt: row.recordedAt.getTime() }));
}

export interface ProductDayObservation {
  productId: string;
  recordedAt: Date;
  totalPriceCents: number;
  unitPriceMilli: number;
  source: EntrySource;
}

/**
 * Observations of the given products inside a time window (the receipt
 * review screen's "already recorded today" hint).
 *
 * One query for the whole line list rather than one per line — a 40-line
 * receipt would otherwise be 40 round trips to say "no duplicates".
 */
export async function listObservationsForProductsInRange(
  db: Db | DbTransaction,
  userId: string,
  productIds: string[],
  from: Date,
  to: Date,
): Promise<ProductDayObservation[]> {
  if (productIds.length === 0) {
    return [];
  }
  return db
    .select({
      productId: priceEntries.productId,
      recordedAt: priceEntries.recordedAt,
      totalPriceCents: priceEntries.totalPriceCents,
      unitPriceMilli: priceEntries.unitPriceMilli,
      source: priceEntries.source,
    })
    .from(priceEntries)
    .where(
      and(
        eq(priceEntries.userId, userId),
        inArray(priceEntries.productId, productIds),
        gte(priceEntries.recordedAt, from),
        lte(priceEntries.recordedAt, to),
      ),
    )
    .orderBy(desc(priceEntries.recordedAt));
}

export type CreatePriceEntryWithIdInput = CreatePriceEntryInput & { id: string };

/**
 * Insert a batch of entries whose ids come from the client (the photo ids
 * assigned during capture), ignoring rows that already exist.
 *
 * Why onConflictDoNothing rather than a plain insert: the confirm step is
 * replayable by design — a dropped response, a double tap, or an offline
 * retry can submit the same batch twice, and the client-generated id is the
 * idempotency key that makes the second submission a no-op instead of a
 * duplicate observation in the index.
 *
 * @returns The rows actually inserted (already-present ids are absent)
 */
export async function createPriceEntriesIgnoringDuplicates(
  db: Db | DbTransaction,
  userId: string,
  inputs: CreatePriceEntryWithIdInput[],
): Promise<PriceEntry[]> {
  if (inputs.length === 0) {
    return [];
  }
  return db
    .insert(priceEntries)
    .values(inputs.map((input) => ({ ...input, userId })))
    .onConflictDoNothing({ target: priceEntries.id })
    .returning();
}

/** Ids of the entries already recorded for one shopping session, oldest first. */
export async function listPriceEntryIdsBySession(
  db: Db | DbTransaction,
  userId: string,
  sessionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: priceEntries.id })
    .from(priceEntries)
    .where(and(eq(priceEntries.userId, userId), eq(priceEntries.sessionId, sessionId)))
    .orderBy(asc(priceEntries.recordedAt));
  return rows.map((row) => row.id);
}

/** Ids of the entries created from one receipt, oldest first. */
export async function listPriceEntryIdsByReceipt(
  db: Db | DbTransaction,
  userId: string,
  receiptId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: priceEntries.id })
    .from(priceEntries)
    .where(and(eq(priceEntries.userId, userId), eq(priceEntries.receiptId, receiptId)))
    .orderBy(asc(priceEntries.createdAt));
  return rows.map((row) => row.id);
}

/**
 * Product ids the user has bought at one store since a given moment.
 *
 * Feeds the +0.05 store-recency bonus of the product matcher: something you
 * bought at this very supermarket last month is a far likelier match for a
 * tag photographed here than an equally-named product you bought elsewhere.
 * Deliberately one DISTINCT query for the whole catalog — never one query
 * per candidate.
 */
export async function listProductIdsWithEntriesAtStoreSince(
  db: Db,
  userId: string,
  storeId: string,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ productId: priceEntries.productId })
    .from(priceEntries)
    .where(
      and(
        eq(priceEntries.userId, userId),
        eq(priceEntries.storeId, storeId),
        gte(priceEntries.recordedAt, since),
      ),
    );
  return rows.map((row) => row.productId);
}

export interface LatestProductEntry {
  productId: string;
  /** 1 = the newest observation of the product, 2 = the one before it. */
  rank: number;
  unitPriceMilli: number;
  recordedAt: Date;
}

/**
 * The newest `perProduct` observations of every product of the user, as
 * flat rows ordered by product then rank (the catalog shows the last unit
 * price and a trend badge against the previous one).
 *
 * Why a window function rather than a correlated subquery per product: the
 * catalog lists the whole catalog at once, and one ROW_NUMBER() scan over
 * (user_id, product_id, recorded_at) — the composite index — is the only
 * way to stay at a single query regardless of catalog size.
 */
export async function listLatestEntriesPerProduct(
  db: Db,
  userId: string,
  perProduct = 2,
): Promise<LatestProductEntry[]> {
  const ranked = db
    .select({
      productId: priceEntries.productId,
      unitPriceMilli: priceEntries.unitPriceMilli,
      recordedAt: priceEntries.recordedAt,
      rank: sql<number>`row_number() over (partition by ${priceEntries.productId} order by ${priceEntries.recordedAt} desc, ${priceEntries.id} desc)`.as(
        'rank',
      ),
    })
    .from(priceEntries)
    .where(eq(priceEntries.userId, userId))
    .as('ranked');

  const rows = await db
    .select({
      productId: ranked.productId,
      rank: ranked.rank,
      unitPriceMilli: ranked.unitPriceMilli,
      recordedAt: ranked.recordedAt,
    })
    .from(ranked)
    .where(lte(ranked.rank, perProduct))
    .orderBy(asc(ranked.productId), asc(ranked.rank));

  return rows.map((row) => ({
    ...row,
    rank: Number(row.rank),
    recordedAt: row.recordedAt instanceof Date ? row.recordedAt : new Date(Number(row.recordedAt)),
  }));
}

/** Number of observations per store, keyed by store id (stores with none are absent). */
export async function countPriceEntriesByStore(
  db: Db,
  userId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ storeId: priceEntries.storeId, total: count() })
    .from(priceEntries)
    .where(eq(priceEntries.userId, userId))
    .groupBy(priceEntries.storeId);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.storeId) {
      counts.set(row.storeId, Number(row.total));
    }
  }
  return counts;
}

/**
 * Number of observations per product, keyed by product id (products with
 * none are absent, so a missing key reads as zero).
 *
 * The catalog needs this to tell the user how much history a delete is about
 * to destroy, before they confirm it.
 */
export async function countPriceEntriesByProduct(
  db: Db,
  userId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ productId: priceEntries.productId, total: count() })
    .from(priceEntries)
    .where(eq(priceEntries.userId, userId))
    .groupBy(priceEntries.productId);
  return new Map(rows.map((row) => [row.productId, Number(row.total)]));
}

/**
 * Every observation of one product, newest first, with the store name —
 * the product detail screen needs the whole history for its chart, stats
 * and per-store comparison. Deliberately unpaginated: a single product
 * accumulates tens of entries a year, not thousands.
 */
export async function listPriceEntriesForProduct(
  db: Db,
  userId: string,
  productId: string,
): Promise<PriceEntryWithProduct[]> {
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
      storeId: stores.id,
      storeName: stores.name,
    })
    .from(priceEntries)
    .innerJoin(products, and(eq(priceEntries.productId, products.id), eq(products.userId, userId)))
    .leftJoin(stores, and(eq(priceEntries.storeId, stores.id), eq(stores.userId, userId)))
    .where(and(eq(priceEntries.userId, userId), eq(priceEntries.productId, productId)))
    .orderBy(desc(priceEntries.recordedAt), desc(priceEntries.id));

  return rows.map((row) => ({
    ...row.entry,
    product: row.product,
    store: row.storeId && row.storeName ? { id: row.storeId, name: row.storeName } : null,
  }));
}

/**
 * Insert-or-update entries by id for the backup import; foreign ids are
 * skipped by the user_id guard. Callers must have verified
 * that product/store/session references belong to the user first — the FK
 * only checks existence, not ownership.
 */
export async function upsertPriceEntries(
  db: Db | DbTransaction,
  userId: string,
  inputs: CreatePriceEntryWithIdInput[],
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  await db
    .insert(priceEntries)
    .values(inputs.map((input) => ({ ...input, userId })))
    .onConflictDoUpdate({
      target: priceEntries.id,
      set: {
        productId: sql`excluded.product_id`,
        storeId: sql`excluded.store_id`,
        sessionId: sql`excluded.session_id`,
        receiptId: sql`excluded.receipt_id`,
        recordedAt: sql`excluded.recorded_at`,
        totalPriceCents: sql`excluded.total_price_cents`,
        quantity: sql`excluded.quantity`,
        packageSize: sql`excluded.package_size`,
        unitPriceMilli: sql`excluded.unit_price_milli`,
        isPromo: sql`excluded.is_promo`,
        promoKind: sql`excluded.promo_kind`,
        source: sql`excluded.source`,
        currency: sql`excluded.currency`,
        photoUrl: sql`excluded.photo_url`,
        aiConfidence: sql`excluded.ai_confidence`,
        aiModel: sql`excluded.ai_model`,
        aiRawJson: sql`excluded.ai_raw_json`,
      },
      setWhere: eq(priceEntries.userId, userId),
    });
}
