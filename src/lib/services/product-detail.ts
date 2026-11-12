/**
 * Read model of the product detail screen: the product, its
 * monthly unit-price series (Europe/Rome months, mean per month, promo
 * months marked), the min/max/mean/last tiles and the full entry list. Plain JSON out — it feeds Client Components.
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
import { getProductById } from '@/lib/db/repositories/products';
import type { CategoryId } from '@/lib/domain/categories';
import type { EntrySource, PromoKind } from '@/lib/domain/entries';
import type { UnitKind } from '@/lib/domain/units';
import { NotFoundError } from '@/lib/errors';
import { computeMonthlyMeans } from '@/lib/inflation';

export interface EntrySummary {
  id: string;
  /** Epoch ms UTC. */
  recordedAt: number;
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
  entries: EntrySummary[];
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
  const rows = await listPriceEntriesForProduct(db, userId, productId);
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
    monthlySeries: computeMonthlyMeans(entries),
    promoMarkers: computeMonthlyMeans(entries, (entry) => entry.isPromo),
    stats: buildStats(entries),
    entries,
  };
}

/**
 * Project a joined entry row onto the plain-JSON summary the screens render
 * (Dates become epoch ms); shared with the timeline.
 */
export function toEntrySummary(row: PriceEntryWithProduct): EntrySummary {
  return {
    id: row.id,
    recordedAt: row.recordedAt.getTime(),
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

export interface EditEntryInput {
  recordedAt: number;
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
 */
export async function updatePriceEntry(
  db: Db,
  userId: string,
  entryId: string,
  input: EditEntryInput,
): Promise<void> {
  const updated = await updatePriceEntryRow(db, userId, entryId, {
    recordedAt: new Date(input.recordedAt),
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
export async function deletePriceEntry(db: Db, userId: string, entryId: string): Promise<void> {
  const existing = await getPriceEntryById(db, userId, entryId);
  if (!existing) {
    throw new NotFoundError('price entry', entryId);
  }
  await deletePriceEntryRow(db, userId, entryId);
  if (existing.photoUrl) {
    await deleteOwnedPhotos(userId, [existing.photoUrl]);
  }
}
