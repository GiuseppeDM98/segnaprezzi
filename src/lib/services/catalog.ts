/**
 * Read model and use cases of the product catalog screen (Spec 05 §5.6):
 * the list with each product's latest unit price and the previous one for
 * the trend badge, the category chips, and the merge flow. Everything
 * returned is plain JSON (Dates become epoch ms) because it crosses into
 * Client Components.
 */
import type { Db } from '@/lib/db/client';
import { listLatestEntriesPerProduct } from '@/lib/db/repositories/price-entries';
import {
  getProductById,
  listProducts,
  mergeProducts as mergeProductPair,
  updateProduct,
} from '@/lib/db/repositories/products';
import type { CategoryId } from '@/lib/domain/categories';
import type { UnitKind } from '@/lib/domain/units';
import { ProductNotFoundError } from '@/lib/errors';

export interface CatalogProduct {
  id: string;
  name: string;
  brand: string | null;
  category: CategoryId;
  unitKind: UnitKind;
  isArchived: boolean;
  /** Newest observation, or null for a product with no entries yet. */
  last: { unitPriceMilli: number; recordedAt: number } | null;
  /** The observation before the newest one — the trend badge's baseline. */
  previousUnitPriceMilli: number | null;
}

export interface CatalogOptions {
  search?: string;
  category?: CategoryId;
  includeArchived?: boolean;
}

export interface Catalog {
  products: CatalogProduct[];
  /** Categories that have at least one (non-archived) product, for the filter chips. */
  categoriesWithData: CategoryId[];
}

/** The catalog list plus the categories worth a filter chip. */
export async function listCatalog(
  db: Db,
  userId: string,
  options: CatalogOptions = {},
): Promise<Catalog> {
  const [products, allProducts, latest] = await Promise.all([
    listProducts(db, userId, options),
    options.category || options.search ? listProducts(db, userId, {}) : null,
    listLatestEntriesPerProduct(db, userId, 2),
  ]);

  const latestByProduct = new Map<
    string,
    { last?: (typeof latest)[number]; previous?: (typeof latest)[number] }
  >();
  for (const row of latest) {
    const slot = latestByProduct.get(row.productId) ?? {};
    if (row.rank === 1) {
      slot.last = row;
    } else if (row.rank === 2) {
      slot.previous = row;
    }
    latestByProduct.set(row.productId, slot);
  }

  const categoriesWithData = [
    ...new Set((allProducts ?? products).map((product) => product.category)),
  ];

  return {
    products: products.map((product) => {
      const slot = latestByProduct.get(product.id);
      return {
        id: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        unitKind: product.unitKind,
        isArchived: product.isArchived,
        last: slot?.last
          ? { unitPriceMilli: slot.last.unitPriceMilli, recordedAt: slot.last.recordedAt.getTime() }
          : null,
        previousUnitPriceMilli: slot?.previous?.unitPriceMilli ?? null,
      };
    }),
    categoriesWithData,
  };
}

export interface MergeProductsInput {
  survivorId: string;
  /** Products whose entries move to the survivor; each is archived afterwards. */
  mergedIds: string[];
}

export interface MergeProductsResult {
  movedEntriesCount: number;
  mergedCount: number;
}

/**
 * Merge several duplicates into one surviving product (Spec 05 §5.6). Each
 * pair is one transaction in the repository; a failure mid-way leaves the
 * already-merged pairs merged, which is safe — every intermediate state is
 * a valid catalog, and the index simply recomputes from it.
 *
 * @throws ProductNotFoundError when any id is not the user's
 */
export async function mergeProducts(
  db: Db,
  userId: string,
  input: MergeProductsInput,
): Promise<MergeProductsResult> {
  const survivor = await getProductById(db, userId, input.survivorId);
  if (!survivor) {
    throw new ProductNotFoundError(input.survivorId);
  }
  let movedEntriesCount = 0;
  for (const mergedId of input.mergedIds) {
    if (mergedId === input.survivorId) {
      continue;
    }
    const result = await mergeProductPair(db, userId, mergedId, input.survivorId);
    movedEntriesCount += result.movedEntriesCount;
  }
  return { movedEntriesCount, mergedCount: input.mergedIds.length };
}

export interface EditProductInput {
  name: string;
  brand: string | null;
  category: CategoryId;
}

/** Rename / re-brand / re-categorize a product (Spec 05 §5.7 "Modifica"). */
export async function editProduct(
  db: Db,
  userId: string,
  productId: string,
  input: EditProductInput,
): Promise<void> {
  const updated = await updateProduct(db, userId, productId, input);
  if (!updated) {
    throw new ProductNotFoundError(productId);
  }
}

/** Archive or restore a product; archived products leave suggestions, never history. */
export async function setProductArchived(
  db: Db,
  userId: string,
  productId: string,
  isArchived: boolean,
): Promise<void> {
  const updated = await updateProduct(db, userId, productId, { isArchived });
  if (!updated) {
    throw new ProductNotFoundError(productId);
  }
}

export interface ProductSearchHit {
  id: string;
  name: string;
  brand: string | null;
  category: CategoryId;
  unitKind: UnitKind;
}

/** Case-insensitive name/brand search over the non-archived catalog, for pickers. */
export async function searchProducts(
  db: Db,
  userId: string,
  query: string,
  limit = 20,
): Promise<ProductSearchHit[]> {
  const products = await listProducts(db, userId, { search: query, includeArchived: false });
  return products.slice(0, limit).map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    unitKind: product.unitKind,
  }));
}
