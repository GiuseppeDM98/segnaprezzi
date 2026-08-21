/**
 * Writing one price entry — the single path every non-photo entry takes,
 * parameterized by `source`.
 *
 * Design: the product pick resolution lives here too, because "reuse the
 * product the user already has instead of creating a near-duplicate" is the
 * one rule the manual form, the fuel form and the batch confirm must apply
 * identically. Duplicates are not a cosmetic problem: the inflation engine
 * matches products month over month, so a second "Latte PS 1L" row silently
 * removes that product from every relative it should have contributed to.
 */
import type { Db, DbTransaction } from '@/lib/db/client';
import { createPriceEntry as insertPriceEntry } from '@/lib/db/repositories/price-entries';
import {
  createProduct,
  listProducts,
  listProductsByIds,
  updateDefaultPackageSizes,
} from '@/lib/db/repositories/products';
import { getStoreById } from '@/lib/db/repositories/stores';
import type { EntrySource, PromoKind } from '@/lib/domain/entries';
import { type FuelQuickPickKey, getFuelQuickPick } from '@/lib/domain/fuel-products';
import type { ProductPick } from '@/lib/domain/schemas';
import {
  InconsistentFuelPricesError,
  InvalidDateError,
  InvalidPriceError,
  InvalidSizeError,
  InvalidStoreKindError,
  ProductNotFoundError,
  StoreNotFoundError,
} from '@/lib/errors';
import { normalizeProductName } from './match-products';

/**
 * Oldest accepted observation date. Backfilling last year's receipts is
 * legitimate; a mistyped "0202" year is not, and a stray decade of history
 * would wreck the chained index's base month.
 */
const MIN_RECORDED_AT_MS = Date.UTC(2020, 0, 1);

/** Tolerated clock skew between the user's phone and the server. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const MAX_TOTAL_PRICE_CENTS = 1_000_000;
const MAX_UNIT_PRICE_MILLI = 100_000_000;
const MAX_PACKAGE_SIZE = 10_000;

export interface CreatePriceEntryInput {
  product: ProductPick;
  storeId: string | null;
  sessionId?: string | null;
  /** Epoch milliseconds UTC. */
  recordedAt: number;
  totalPriceCents: number;
  packageSize: number;
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
  source: EntrySource;
}

export interface CreatePriceEntryResult {
  entryId: string;
  productId: string;
}

/**
 * Record one price observation.
 *
 * @param db - Database or transaction
 * @param userId - Always from the server session
 * @returns The new entry id and the product it was attached to
 * @throws InvalidDateError, InvalidPriceError, InvalidSizeError on range violations
 * @throws StoreNotFoundError, ProductNotFoundError when a reference is not the user's
 */
export async function createPriceEntry(
  db: Db | DbTransaction,
  userId: string,
  input: CreatePriceEntryInput,
): Promise<CreatePriceEntryResult> {
  assertEntryValues(input);
  await assertStoreBelongsToUser(db, userId, input.storeId);

  const { productIds } = await resolveProductPicks(db, userId, [input.product]);

  const entry = await insertPriceEntry(db, userId, {
    productId: productIds[0],
    storeId: input.storeId,
    sessionId: input.sessionId ?? null,
    recordedAt: new Date(input.recordedAt),
    totalPriceCents: input.totalPriceCents,
    packageSize: input.packageSize,
    unitPriceMilli: input.unitPriceMilli,
    isPromo: input.isPromo,
    promoKind: input.promoKind,
    source: input.source,
  });

  // The newest observation's size is what a receipt line of
  // this product will most likely be, so every write path records it.
  await updateDefaultPackageSizes(db, userId, [
    { productId: productIds[0], packageSize: input.packageSize },
  ]);

  return { entryId: entry.id, productId: productIds[0] };
}

export interface ResolvedProductPicks {
  /** Product ids positionally matching the input picks. */
  productIds: string[];
  /** Ids of products this call created, in creation order. */
  createdProductIds: string[];
}

/**
 * Turn product picks into product ids, creating what does not exist yet.
 *
 * Deduplication happens on two axes, both keyed on the normalized name+brand
 * (`normalizeProductName`): against the user's catalog, so re-adding
 * "Passata Mutti" reuses the existing row, and within the batch itself, so
 * two review cards both marked "new product" for the same tag collapse into
 * one product with two entries.
 *
 * Archived products are deliberately NOT reuse candidates: they were
 * archived by a merge or by the user, and resurrecting one would undo that
 * decision behind their back.
 *
 * @throws ProductNotFoundError when an `existing` pick is not the user's
 */
export async function resolveProductPicks(
  db: Db | DbTransaction,
  userId: string,
  picks: ProductPick[],
): Promise<ResolvedProductPicks> {
  const existingIds = picks
    .filter((pick) => pick.kind === 'existing')
    .map((pick) => pick.productId);
  const ownedProducts = await listProductsByIds(db, userId, existingIds);
  const ownedIds = new Set(ownedProducts.map((product) => product.id));
  for (const id of existingIds) {
    if (!ownedIds.has(id)) {
      throw new ProductNotFoundError(id);
    }
  }

  const hasNewPicks = picks.some((pick) => pick.kind === 'new');
  const catalog = hasNewPicks ? await listProducts(db, userId, { includeArchived: false }) : [];
  const idByKey = new Map(
    catalog.map((product) => [buildProductKey(product.name, product.brand), product.id]),
  );

  const productIds: string[] = [];
  const createdProductIds: string[] = [];

  for (const pick of picks) {
    if (pick.kind === 'existing') {
      productIds.push(pick.productId);
      continue;
    }

    const key = buildProductKey(pick.name, pick.brand);
    const known = idByKey.get(key);
    if (known) {
      productIds.push(known);
      continue;
    }

    const created = await createProduct(db, userId, {
      name: pick.name,
      brand: pick.brand,
      category: pick.category,
      unitKind: pick.unitKind,
    });
    idByKey.set(key, created.id);
    productIds.push(created.id);
    createdProductIds.push(created.id);
  }

  return { productIds, createdProductIds };
}

/** Identity of a product for deduplication: normalized brand + normalized name. */
function buildProductKey(name: string, brand: string | null): string {
  return `${normalizeProductName(brand ?? '')}|${normalizeProductName(name)}`;
}

/** Throw StoreNotFoundError unless the store is absent or the user's own. */
async function assertStoreBelongsToUser(
  db: Db | DbTransaction,
  userId: string,
  storeId: string | null,
): Promise<void> {
  if (!storeId) {
    return;
  }
  const store = await getStoreById(db, userId, storeId);
  if (!store) {
    throw new StoreNotFoundError(storeId);
  }
}

/**
 * Business-rule ranges enforced here. Zod already rejected the wrong
 * shapes at the boundary; these are the rules Zod cannot express — the date
 * window depends on the current time — plus a defense-in-depth repeat of the
 * bounds for every non-HTTP caller (seeds, future imports).
 */
function assertEntryValues(input: CreatePriceEntryInput): void {
  const now = Date.now();
  if (input.recordedAt < MIN_RECORDED_AT_MS || input.recordedAt > now + FUTURE_TOLERANCE_MS) {
    throw new InvalidDateError(`recordedAt ${input.recordedAt} is outside the accepted window`);
  }
  if (
    !Number.isInteger(input.totalPriceCents) ||
    input.totalPriceCents < 1 ||
    input.totalPriceCents > MAX_TOTAL_PRICE_CENTS
  ) {
    throw new InvalidPriceError(`totalPriceCents ${input.totalPriceCents} is out of range`);
  }
  if (
    !Number.isInteger(input.unitPriceMilli) ||
    input.unitPriceMilli < 1 ||
    input.unitPriceMilli > MAX_UNIT_PRICE_MILLI
  ) {
    throw new InvalidPriceError(`unitPriceMilli ${input.unitPriceMilli} is out of range`);
  }
  if (input.packageSize <= 0 || input.packageSize > MAX_PACKAGE_SIZE) {
    throw new InvalidSizeError(`packageSize ${input.packageSize} is out of range`);
  }
}

/** Pump readings round to the cent, so the triple may disagree by that much. */
const FUEL_CROSS_CHECK_TOLERANCE_MILLI = 10;

export interface CreateFuelEntryInput {
  fuel: FuelQuickPickKey;
  storeId: string | null;
  /** Epoch milliseconds UTC. */
  recordedAt: number;
  unitPriceMilli: number;
  /** Litres, or kilograms for methane — the unit the chosen fuel is sold in. */
  quantity: number;
  totalPriceCents: number;
}

/**
 * Record a refuelling stop.
 *
 * The user enters any two of {unit price, quantity, total} and the client
 * computes the third; the server re-derives the relation rather than trusting
 * it, because a stale computed field is exactly what a fat-fingered edit at
 * the pump produces.
 *
 * @throws InvalidStoreKindError when the store is not a fuel station
 * @throws InconsistentFuelPricesError when the three numbers cannot all be true
 */
export async function createFuelEntry(
  db: Db | DbTransaction,
  userId: string,
  input: CreateFuelEntryInput,
): Promise<CreatePriceEntryResult> {
  await assertFuelStation(db, userId, input.storeId);

  const derivedMilli = input.unitPriceMilli * input.quantity;
  const totalMilli = input.totalPriceCents * 10;
  if (Math.abs(derivedMilli - totalMilli) > FUEL_CROSS_CHECK_TOLERANCE_MILLI) {
    throw new InconsistentFuelPricesError(
      `unitPriceMilli x quantity (${derivedMilli}) does not match totalPriceCents (${totalMilli})`,
    );
  }

  const pick = getFuelQuickPick(input.fuel);

  return createPriceEntry(db, userId, {
    // Fuels are lazily created per user on first use: the canonical Italian
    // name keeps the catalog stable across UI languages, and the pick's own
    // unitKind keeps methane (sold per kg) out of a litres column.
    product: {
      kind: 'new',
      name: pick.canonicalName,
      brand: null,
      category: 'fuel',
      unitKind: pick.unitKind,
    },
    storeId: input.storeId,
    recordedAt: input.recordedAt,
    totalPriceCents: input.totalPriceCents,
    packageSize: input.quantity,
    unitPriceMilli: input.unitPriceMilli,
    isPromo: false,
    promoKind: null,
    source: 'fuel',
  });
}

/** A fuel entry may only be attached to a store of kind 'fuel_station'. */
async function assertFuelStation(
  db: Db | DbTransaction,
  userId: string,
  storeId: string | null,
): Promise<void> {
  if (!storeId) {
    return;
  }
  const store = await getStoreById(db, userId, storeId);
  if (!store) {
    throw new StoreNotFoundError(storeId);
  }
  if (store.kind !== 'fuel_station') {
    throw new InvalidStoreKindError(`Store ${storeId} is a ${store.kind}, not a fuel station`);
  }
}
