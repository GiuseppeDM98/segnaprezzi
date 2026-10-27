/**
 * The catalog screen's derivations, kept out of its components so they can
 * be tested without rendering: which products the current search and chips
 * leave visible, the trend of a row's last price, and the shape the delete
 * confirmation asks for. Pure: type imports only.
 */
import type { DeletableProduct } from '@/components/products/delete-products-sheet';
import type { CategoryId } from '@/lib/domain/categories';
import type { CatalogProduct } from '@/lib/services/catalog';

/** The catalog's client-side filters, as the header sets them. */
export interface CatalogFilters {
  /** Raw search text; matched trimmed and case-insensitively against name and brand. */
  query: string;
  /** Null for every category. */
  category: CategoryId | null;
  /** Whether archived products are listed alongside the active ones. */
  isArchivedVisible: boolean;
}

/**
 * The products the filters leave visible, in catalog order. A product
 * passes when it is active (or archived ones are shown), in the chosen
 * category (if any), and its name or brand contains the search text (if any).
 */
export function filterCatalogProducts(
  products: CatalogProduct[],
  { query, category, isArchivedVisible }: CatalogFilters,
): CatalogProduct[] {
  const normalizedQuery = query.trim().toLowerCase();
  return products.filter((product) => {
    if (!isArchivedVisible && product.isArchived) {
      return false;
    }
    if (category && product.category !== category) {
      return false;
    }
    if (
      normalizedQuery &&
      !product.name.toLowerCase().includes(normalizedQuery) &&
      !product.brand?.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * How the last unit price moved against the one before it, as a ratio
 * minus one (0.1 = 10% dearer), or null when the product has fewer than two
 * observations to compare.
 */
export function lastPriceChange(product: CatalogProduct): number | null {
  return product.last && product.previousUnitPriceMilli
    ? product.last.unitPriceMilli / product.previousUnitPriceMilli - 1
    : null;
}

/** The fields of a catalog product the delete confirmation names and counts. */
export function toDeletableProduct(product: CatalogProduct): DeletableProduct {
  return { id: product.id, name: product.name, entryCount: product.entryCount };
}
