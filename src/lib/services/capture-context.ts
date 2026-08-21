/**
 * Read models for the Spec 03 screens (/scan, /add/manual, /add/fuel).
 *
 * Design: pages are Server Components and must not reach into repositories
 * (AGENTS.md §1.5), so the small amount of data each capture screen needs to
 * render is assembled here. Everything returned is plain JSON — Dates become
 * epoch milliseconds — because these values are handed straight to Client
 * Components, which cannot receive Date instances across the boundary in a
 * stable way.
 */
import type { Db } from '@/lib/db/client';
import { listPriceEntries } from '@/lib/db/repositories/price-entries';
import { listProducts } from '@/lib/db/repositories/products';
import { getResumableShoppingSession } from '@/lib/db/repositories/shopping-sessions';
import { listStores } from '@/lib/db/repositories/stores';
import type { CategoryId } from '@/lib/domain/categories';
import type { StoreKind } from '@/lib/domain/stores';
import type { UnitKind } from '@/lib/domain/units';

/** How many recent entries to scan when guessing the user's usual store. */
const RECENT_ENTRIES_FOR_DEFAULT_STORE = 20;

export interface StoreSummary {
  id: string;
  name: string;
  chain: string | null;
  kind: StoreKind;
}

export interface ProductSummary {
  id: string;
  name: string;
  brand: string | null;
  category: CategoryId;
  unitKind: UnitKind;
}

export interface ResumableSessionSummary {
  id: string;
  status: string;
  /** Epoch milliseconds UTC. */
  startedAt: number;
  storeId: string | null;
}

export interface ScanContext {
  resumableSession: ResumableSessionSummary | null;
  stores: StoreSummary[];
  /** Pre-selection for the capture header: the user's usual supermarket. */
  defaultStoreId: string | null;
}

/** Everything /scan needs to render the capture screen server-side. */
export async function getScanContext(db: Db, userId: string): Promise<ScanContext> {
  const [session, stores, recentStoreIds] = await Promise.all([
    getResumableShoppingSession(db, userId),
    listStores(db, userId),
    listRecentEntryStoreIds(db, userId),
  ]);

  return {
    resumableSession: session
      ? {
          id: session.id,
          status: session.status,
          startedAt: session.startedAt.getTime(),
          storeId: session.storeId,
        }
      : null,
    stores: stores.map(toStoreSummary),
    defaultStoreId: pickDefaultStoreId(
      stores.map(toStoreSummary),
      recentStoreIds,
      (store) => store.kind !== 'fuel_station',
    ),
  };
}

export interface ManualEntryContext {
  products: ProductSummary[];
  stores: StoreSummary[];
  defaultStoreId: string | null;
}

/** Catalog and stores for the manual entry form (Spec 03 §10.1). */
export async function getManualEntryContext(db: Db, userId: string): Promise<ManualEntryContext> {
  const [products, stores, recentStoreIds] = await Promise.all([
    listProducts(db, userId, { includeArchived: false }),
    listStores(db, userId),
    listRecentEntryStoreIds(db, userId),
  ]);

  const storeSummaries = stores.map(toStoreSummary);
  return {
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      unitKind: product.unitKind,
    })),
    stores: storeSummaries,
    // A hand-typed price is almost never a fill-up: prefer the last
    // supermarket over a fuel station that merely happens to be more recent.
    defaultStoreId: pickDefaultStoreId(
      storeSummaries,
      recentStoreIds,
      (store) => store.kind !== 'fuel_station',
    ),
  };
}

export interface FuelEntryContext {
  stations: StoreSummary[];
  defaultStationId: string | null;
}

/** Fuel stations only — the pump form must not offer a supermarket (§11.3). */
export async function getFuelEntryContext(db: Db, userId: string): Promise<FuelEntryContext> {
  const [stores, recentStoreIds] = await Promise.all([
    listStores(db, userId),
    listRecentEntryStoreIds(db, userId),
  ]);

  const stations = stores.map(toStoreSummary).filter((store) => store.kind === 'fuel_station');
  return {
    stations,
    defaultStationId: pickDefaultStoreId(stations, recentStoreIds, () => true),
  };
}

function toStoreSummary(store: {
  id: string;
  name: string;
  chain: string | null;
  kind: StoreKind;
}): StoreSummary {
  return { id: store.id, name: store.name, chain: store.chain, kind: store.kind };
}

/**
 * Store ids of the user's most recent entries, newest first.
 *
 * Why a page of entries rather than a dedicated aggregate query: "the store I
 * shop at" is simply the store of my last few purchases, and the entries
 * timeline index already serves this exact ordering — one indexed read beats
 * maintaining a denormalized "last used store" column.
 */
async function listRecentEntryStoreIds(db: Db, userId: string): Promise<string[]> {
  const page = await listPriceEntries(db, userId, { limit: RECENT_ENTRIES_FOR_DEFAULT_STORE });
  return page.entries
    .map((entry) => entry.storeId)
    .filter((storeId): storeId is string => storeId !== null);
}

/** First recently-used store passing `isEligible`, else the first eligible one. */
function pickDefaultStoreId(
  stores: StoreSummary[],
  recentStoreIds: string[],
  isEligible: (store: StoreSummary) => boolean,
): string | null {
  const eligible = new Map(stores.filter(isEligible).map((store) => [store.id, store] as const));
  for (const storeId of recentStoreIds) {
    if (eligible.has(storeId)) {
      return storeId;
    }
  }
  return eligible.keys().next().value ?? null;
}
