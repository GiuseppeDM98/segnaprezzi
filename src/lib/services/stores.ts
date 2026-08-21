/**
 * Store management use cases (Spec 05 §5.9). Thin by design — the rules
 * are the repository's (user scoping, FK set-null on delete); this layer
 * adds the entry counts the list shows and the not-found translation.
 */
import type { Db } from '@/lib/db/client';
import { countPriceEntriesByStore } from '@/lib/db/repositories/price-entries';
import {
  deleteStore as deleteStoreRow,
  createStore as insertStore,
  listStores,
  updateStore as updateStoreRow,
} from '@/lib/db/repositories/stores';
import type { StoreKind } from '@/lib/domain/stores';
import { StoreNotFoundError } from '@/lib/errors';

export interface StoreListItem {
  id: string;
  name: string;
  chain: string | null;
  city: string | null;
  kind: StoreKind;
  entryCount: number;
}

/** All stores with how many observations each one holds. */
export async function listStoresWithCounts(db: Db, userId: string): Promise<StoreListItem[]> {
  const [stores, counts] = await Promise.all([
    listStores(db, userId),
    countPriceEntriesByStore(db, userId),
  ]);
  return stores.map((store) => ({
    id: store.id,
    name: store.name,
    chain: store.chain,
    city: store.city,
    kind: store.kind,
    entryCount: counts.get(store.id) ?? 0,
  }));
}

export interface StoreInput {
  name: string;
  chain: string | null;
  city: string | null;
  kind: StoreKind;
}

/** Create a store and return its id. */
export async function createStore(
  db: Db,
  userId: string,
  input: StoreInput,
): Promise<{ id: string }> {
  const store = await insertStore(db, userId, input);
  return { id: store.id };
}

/** Update a store. @throws StoreNotFoundError when it is not the user's. */
export async function updateStore(
  db: Db,
  userId: string,
  storeId: string,
  input: StoreInput,
): Promise<void> {
  const updated = await updateStoreRow(db, userId, storeId, input);
  if (!updated) {
    throw new StoreNotFoundError(storeId);
  }
}

/**
 * Delete a store; its entries survive with store_id = NULL (Spec 05 §5.9:
 * "Le rilevazioni restano, ma senza negozio").
 * @throws StoreNotFoundError when it is not the user's
 */
export async function deleteStore(db: Db, userId: string, storeId: string): Promise<void> {
  const deleted = await deleteStoreRow(db, userId, storeId);
  if (!deleted) {
    throw new StoreNotFoundError(storeId);
  }
}
