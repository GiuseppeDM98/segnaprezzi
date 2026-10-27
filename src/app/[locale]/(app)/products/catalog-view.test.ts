import { describe, expect, test } from 'vitest';

import type { CatalogProduct } from '@/lib/services/catalog';
import {
  type CatalogFilters,
  filterCatalogProducts,
  lastPriceChange,
  toDeletableProduct,
} from './catalog-view';

function product(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id,
    name: `Product ${id}`,
    brand: null,
    category: 'other',
    unitKind: 'count',
    isArchived: false,
    last: null,
    previousUnitPriceMilli: null,
    entryCount: 0,
    ...overrides,
  };
}

const NO_FILTERS: CatalogFilters = { query: '', category: null, isArchivedVisible: false };

describe('filterCatalogProducts', () => {
  test('should hide archived products unless they are asked for', () => {
    // Arrange
    const active = product('a');
    const archived = product('b', { isArchived: true });

    // Act
    const hidden = filterCatalogProducts([active, archived], NO_FILTERS);
    const shown = filterCatalogProducts([active, archived], {
      ...NO_FILTERS,
      isArchivedVisible: true,
    });

    // Assert
    expect(hidden).toEqual([active]);
    expect(shown).toEqual([active, archived]);
  });

  test('should keep only the chosen category', () => {
    const milk = product('a', { category: 'food' });
    const fuel = product('b', { category: 'fuel' });

    expect(filterCatalogProducts([milk, fuel], { ...NO_FILTERS, category: 'food' })).toEqual([
      milk,
    ]);
  });

  test('should match the search text against name or brand, trimmed and case-insensitively', () => {
    // Arrange
    const byName = product('a', { name: 'Latte intero' });
    const byBrand = product('b', { name: 'Yogurt', brand: 'Granarolo' });
    const neither = product('c', { name: 'Pasta', brand: 'Barilla' });

    // Act
    const byNameResult = filterCatalogProducts([byName, byBrand, neither], {
      ...NO_FILTERS,
      query: '  LATTE ',
    });
    const byBrandResult = filterCatalogProducts([byName, byBrand, neither], {
      ...NO_FILTERS,
      query: 'granarolo',
    });

    // Assert
    expect(byNameResult).toEqual([byName]);
    expect(byBrandResult).toEqual([byBrand]);
  });

  test('should treat blank search text as no search', () => {
    const products = [product('a'), product('b')];

    expect(filterCatalogProducts(products, { ...NO_FILTERS, query: '   ' })).toEqual(products);
  });
});

describe('lastPriceChange', () => {
  test('should compare the last unit price with the one before it', () => {
    const dearer = product('a', {
      last: { unitPriceMilli: 1100, recordedAt: 0 },
      previousUnitPriceMilli: 1000,
    });

    expect(lastPriceChange(dearer)).toBeCloseTo(0.1);
  });

  test('should have no trend for a product with fewer than two observations', () => {
    const once = product('a', { last: { unitPriceMilli: 1100, recordedAt: 0 } });

    expect(lastPriceChange(once)).toBeNull();
    expect(lastPriceChange(product('b'))).toBeNull();
  });
});

describe('toDeletableProduct', () => {
  test('should carry the id, the name and the entry count the confirmation shows', () => {
    const subject = product('a', { name: 'Latte', entryCount: 3, brand: 'Granarolo' });

    expect(toDeletableProduct(subject)).toEqual({ id: 'a', name: 'Latte', entryCount: 3 });
  });
});
