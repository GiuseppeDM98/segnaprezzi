import { describe, expect, test } from 'vitest';

import { SIZE_UNIT_OPTIONS } from '@/lib/domain/units';
import type { ProductSummary } from '@/lib/services/capture-context';
import {
  activeUnitKindOf,
  computeManualPrice,
  filterProductHits,
  MAX_PRODUCT_HITS,
  type PriceFieldValues,
  resolveSizeUnit,
  toCreatedProduct,
  toProductInput,
} from './manual-entry-derivations';

/*
 * The manual form saves exactly the numbers these rules produce: a unit
 * price derived over the user's own typing would overwrite what the tag
 * says, and one the form failed to cross-check would let a misread digit in
 * without a word. The cases below pin the derived-versus-typed rule, the
 * size conversion the e2e quick-entry spec relies on, and the catalog search.
 */

const GRAMS = SIZE_UNIT_OPTIONS.weight[1];

function values(overrides: Partial<PriceFieldValues> = {}): PriceFieldValues {
  return {
    totalEuros: 1.29,
    sizeValue: 700,
    sizeUnit: GRAMS,
    unitPriceEuros: null,
    isUnitPriceEdited: false,
    ...overrides,
  };
}

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: 'prod0000000000000001A',
    name: 'Passata di pomodoro',
    brand: 'Mutti',
    category: 'food',
    unitKind: 'weight',
    ...overrides,
  };
}

describe('computeManualPrice', () => {
  test('derives the unit price from the total and a size typed in grams', () => {
    const price = computeManualPrice(values());

    expect(price).toEqual({
      totalPriceCents: 129,
      packageSize: 0.7,
      derivedUnitPriceMilli: 1843,
      unitPriceMilli: 1843,
      hasCrossCheckWarning: false,
    });
  });

  test('derives nothing while the total or the size is empty', () => {
    expect(computeManualPrice(values({ sizeValue: null })).unitPriceMilli).toBe(0);
    expect(computeManualPrice(values({ totalEuros: null })).unitPriceMilli).toBe(0);
  });

  test('uses a typed unit price within the tolerance without warning', () => {
    const price = computeManualPrice(values({ isUnitPriceEdited: true, unitPriceEuros: 1.85 }));

    expect(price.unitPriceMilli).toBe(1850);
    expect(price.derivedUnitPriceMilli).toBe(1843);
    expect(price.hasCrossCheckWarning).toBe(false);
  });

  test('warns, without overriding it, when a typed unit price disagrees with total and size', () => {
    const price = computeManualPrice(values({ isUnitPriceEdited: true, unitPriceEuros: 2.5 }));

    expect(price.unitPriceMilli).toBe(2500);
    expect(price.hasCrossCheckWarning).toBe(true);
  });

  test('treats a cleared typed unit price as missing, not as derived', () => {
    const price = computeManualPrice(values({ isUnitPriceEdited: true, unitPriceEuros: null }));

    expect(price.unitPriceMilli).toBe(0);
    expect(price.hasCrossCheckWarning).toBe(false);
  });
});

describe('activeUnitKindOf and resolveSizeUnit', () => {
  test('follow the picked product, then the new one, and default to weight', () => {
    expect(activeUnitKindOf({ kind: 'existing', product: product({ unitKind: 'count' }) })).toBe(
      'count',
    );
    expect(
      activeUnitKindOf({ kind: 'new', name: '', brand: '', category: 'food', unitKind: 'volume' }),
    ).toBe('volume');
    expect(activeUnitKindOf(null)).toBe('weight');
  });

  test('fall back to the first unit of the kind when the chosen one belongs to another', () => {
    expect(resolveSizeUnit('volume', 'g').unit.key).toBe('liter');
    expect(resolveSizeUnit('weight', 'g').unit).toBe(GRAMS);
  });
});

describe('filterProductHits', () => {
  const catalog = [
    product(),
    product({ id: 'prod0000000000000002A', name: 'Pelati', brand: 'Cirio' }),
    product({ id: 'prod0000000000000003A', name: 'Latte', brand: null }),
  ];

  test('matches name or brand, ignoring case and surrounding spaces', () => {
    const { normalizedQuery, hits } = filterProductHits(catalog, '  CIRIO ');

    expect(normalizedQuery).toBe('cirio');
    expect(hits.map((hit) => hit.name)).toEqual(['Pelati']);
  });

  test('lists nothing for an empty query', () => {
    expect(filterProductHits(catalog, '   ').hits).toEqual([]);
  });

  test('caps the list at MAX_PRODUCT_HITS', () => {
    const many = Array.from({ length: MAX_PRODUCT_HITS + 3 }, (_, index) =>
      product({ id: `prod${index}`, name: `Pasta ${index}` }),
    );

    expect(filterProductHits(many, 'pasta').hits).toHaveLength(MAX_PRODUCT_HITS);
  });
});

describe('toProductInput and toCreatedProduct', () => {
  const newChoice = {
    kind: 'new' as const,
    name: 'Passata',
    brand: '',
    category: 'food' as const,
    unitKind: 'weight' as const,
  };

  test('send an existing pick by id and an empty brand as no brand', () => {
    expect(toProductInput({ kind: 'existing', product: product() })).toEqual({
      kind: 'existing',
      productId: 'prod0000000000000001A',
    });
    expect(toProductInput(newChoice)).toEqual({
      kind: 'new',
      name: 'Passata',
      brand: null,
      category: 'food',
      unitKind: 'weight',
    });
  });

  test('turn a saved new product into a catalog row under its new id', () => {
    expect(toCreatedProduct(newChoice, 'prod0000000000000009Z')).toEqual({
      id: 'prod0000000000000009Z',
      name: 'Passata',
      brand: null,
      category: 'food',
      unitKind: 'weight',
    });
  });
});
