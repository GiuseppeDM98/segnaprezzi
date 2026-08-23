/**
 * Read model of the product detail screen: the product, its
 * monthly unit-price series (Europe/Rome months, mean per month, promo
 * months marked), the min/max/mean/last tiles, the per-store comparison and
 * the full entry list. Plain JSON out — it feeds Client Components.
 */
import { deleteOwnedPhotos } from '@/lib/blob/photo-storage';
import type { Db } from '@/lib/db/client';
import {
  deletePriceEntry as deletePriceEntryRow,
  getPriceEntryById,
  listPriceEntriesForProduct,
  type PriceEntryWithProduct,
  updatePriceEntry as updatePriceEntryRow,
} from '@/lib/db/repositories/price-entries';
import { listAliasesForProduct } from '@/lib/db/repositories/product-aliases';
import { getProductById } from '@/lib/db/repositories/products';
import { getStoreById } from '@/lib/db/repositories/stores';
import type { CategoryId } from '@/lib/domain/categories';
import type { EntrySource, PromoKind } from '@/lib/domain/entries';
import type { UnitKind } from '@/lib/domain/units';
import { NotFoundError, StoreNotFoundError } from '@/lib/errors';
import { toRomeYearMonth } from '@/lib/inflation';

export interface EntrySummary {
  id: string;
  /** Epoch ms UTC. */
  recordedAt: number;
  store: { id: string; name: string } | null;
  totalPriceCents: number;
  packageSize: number;
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
  source: EntrySource;
  photoUrl: string | null;
  product: { id: string; name: string; brand: string | null; unitKind: UnitKind };
}

export interface ProductStat {
  unitPriceMilli: number;
  /** Epoch ms of the observation (absent for the mean). */
  recordedAt?: number;
}

export interface ProductAliasSummary {
  id: string;
  alias: string;
  storeChain: string | null;
  hitCount: number;
  /** Epoch ms UTC. */
  lastSeenAt: number;
}

export interface StoreComparison {
  storeId: string;
  storeName: string;
  latestUnitPriceMilli: number;
  recordedAt: number;
}

export interface ProductDetail {
  product: {
    id: string;
    name: string;
    brand: string | null;
    category: CategoryId;
    unitKind: UnitKind;
    isArchived: boolean;
  };
  /** Monthly mean unit price, oldest first, every month with an observation. */
  monthlySeries: Array<{ month: string; value: number }>;
  /** Months containing at least one promo observation, with that month's promo mean. */
  promoMarkers: Array<{ month: string; value: number }>;
  stats: { min: ProductStat; max: ProductStat; mean: ProductStat; last: ProductStat } | null;
  /** Cheapest first; only populated when ≥ 2 stores have observations. */
  storeComparison: StoreComparison[];
  entries: EntrySummary[];
  /** Receipt lines learned for this product, most-used first. */
  aliases: ProductAliasSummary[];
}

/** Everything the product detail screen renders; null when the product is not the user's. */
export async function getProductDetail(
  db: Db,
  userId: string,
  productId: string,
): Promise<ProductDetail | null> {
  const product = await getProductById(db, userId, productId);
  if (!product) {
    return null;
  }
  const [rows, aliases] = await Promise.all([
    listPriceEntriesForProduct(db, userId, productId),
    listAliasesForProduct(db, userId, productId),
  ]);
  const entries = rows.map(toEntrySummary);

  return {
    product: {
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      unitKind: product.unitKind,
      isArchived: product.isArchived,
    },
    monthlySeries: buildMonthlySeries(entries, () => true),
    promoMarkers: buildMonthlySeries(entries, (entry) => entry.isPromo),
    stats: buildStats(entries),
    storeComparison: buildStoreComparison(entries),
    entries,
    aliases: aliases.map((alias) => ({
      id: alias.id,
      alias: alias.alias,
      storeChain: alias.storeChain,
      hitCount: alias.hitCount,
      lastSeenAt: alias.lastSeenAt.getTime(),
    })),
  };
}

export function toEntrySummary(row: PriceEntryWithProduct): EntrySummary {
  return {
    id: row.id,
    recordedAt: row.recordedAt.getTime(),
    store: row.store,
    totalPriceCents: row.totalPriceCents,
    packageSize: row.packageSize,
    unitPriceMilli: row.unitPriceMilli,
    isPromo: row.isPromo,
    promoKind: row.promoKind,
    source: row.source,
    photoUrl: row.photoUrl,
    product: {
      id: row.product.id,
      name: row.product.name,
      brand: row.product.brand,
      unitKind: row.product.unitKind,
    },
  };
}

/** Mean unit price per Europe/Rome month over the entries passing `filter`, oldest first. */
function buildMonthlySeries(
  entries: EntrySummary[],
  filter: (entry: EntrySummary) => boolean,
): Array<{ month: string; value: number }> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const entry of entries) {
    if (!filter(entry)) {
      continue;
    }
    const month = toRomeYearMonth(entry.recordedAt);
    const slot = sums.get(month) ?? { total: 0, count: 0 };
    slot.total += entry.unitPriceMilli;
    slot.count += 1;
    sums.set(month, slot);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { total, count }]) => ({ month, value: total / count }));
}

function buildStats(entries: EntrySummary[]): ProductDetail['stats'] {
  if (entries.length === 0) {
    return null;
  }
  let min = entries[0];
  let max = entries[0];
  let total = 0;
  for (const entry of entries) {
    if (entry.unitPriceMilli < min.unitPriceMilli) {
      min = entry;
    }
    if (entry.unitPriceMilli > max.unitPriceMilli) {
      max = entry;
    }
    total += entry.unitPriceMilli;
  }
  // Entries arrive newest first, so the first one is the latest observation.
  const last = entries[0];
  return {
    min: { unitPriceMilli: min.unitPriceMilli, recordedAt: min.recordedAt },
    max: { unitPriceMilli: max.unitPriceMilli, recordedAt: max.recordedAt },
    mean: { unitPriceMilli: Math.round(total / entries.length) },
    last: { unitPriceMilli: last.unitPriceMilli, recordedAt: last.recordedAt },
  };
}

/** Latest price per store, cheapest first; empty unless two or more stores compare. */
function buildStoreComparison(entries: EntrySummary[]): StoreComparison[] {
  const latestByStore = new Map<string, StoreComparison>();
  // Newest first: the first time we meet a store is its latest observation.
  for (const entry of entries) {
    if (!entry.store || latestByStore.has(entry.store.id)) {
      continue;
    }
    latestByStore.set(entry.store.id, {
      storeId: entry.store.id,
      storeName: entry.store.name,
      latestUnitPriceMilli: entry.unitPriceMilli,
      recordedAt: entry.recordedAt,
    });
  }
  if (latestByStore.size < 2) {
    return [];
  }
  return [...latestByStore.values()].sort(
    (a, b) => a.latestUnitPriceMilli - b.latestUnitPriceMilli,
  );
}

export interface EditEntryInput {
  recordedAt: number;
  storeId: string | null;
  totalPriceCents: number;
  packageSize: number;
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
}

/**
 * Correct one observation (the entry sheet). The index recomputes
 * on the next dashboard read — nothing is cached.
 *
 * @throws NotFoundError when the entry is not the user's
 * @throws StoreNotFoundError when the new store is not the user's
 */
export async function editPriceEntry(
  db: Db,
  userId: string,
  entryId: string,
  input: EditEntryInput,
): Promise<void> {
  if (input.storeId) {
    const store = await getStoreById(db, userId, input.storeId);
    if (!store) {
      throw new StoreNotFoundError(input.storeId);
    }
  }
  const updated = await updatePriceEntryRow(db, userId, entryId, {
    recordedAt: new Date(input.recordedAt),
    storeId: input.storeId,
    totalPriceCents: input.totalPriceCents,
    packageSize: input.packageSize,
    unitPriceMilli: input.unitPriceMilli,
    isPromo: input.isPromo,
    promoKind: input.isPromo ? input.promoKind : null,
  });
  if (!updated) {
    throw new NotFoundError('price entry', entryId);
  }
}

/**
 * Delete one observation, and the shelf photo that belongs to it.
 *
 * The blob is dropped after the row, best effort: a photo is stored at
 * `users/{userId}/photos/{entryId}.webp` and nothing else can reference it,
 * so once the row is gone the file is pure cost. Doing it in the other order
 * would let a failed delete leave a row whose photo no longer exists.
 *
 * @throws NotFoundError when it is not the user's.
 */
export async function removePriceEntry(db: Db, userId: string, entryId: string): Promise<void> {
  const existing = await getPriceEntryById(db, userId, entryId);
  if (!existing) {
    throw new NotFoundError('price entry', entryId);
  }
  await deletePriceEntryRow(db, userId, entryId);
  if (existing.photoUrl) {
    await deleteOwnedPhotos(userId, [existing.photoUrl]);
  }
}
