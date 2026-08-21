import { describe, expect, test } from 'vitest';

import { type DeriveUnitPriceInput, deriveUnitPriceMilli, normalizeAlias } from './receipt-lines';

describe('normalizeAlias', () => {
  test.each([
    ['PASTA BAR SPAGH N5 500G  1,29', 'pasta bar spagh n5 500g'],
    ['LATTE PS UHT COOP 1L  2 x 1,09  2,18', 'latte ps uht coop 1l'],
    ['BANANE  0,812 kg x 1,49  1,21', 'banane'],
    ['CAFFÈ QUALITÀ ROSSA 250G   4,29', 'caffe qualita rossa 250g'],
    ['DETERSIVO P/PIATTI  2,49', 'detersivo p piatti'],
    // A price with three decimals is still a price column.
    ['BENZINA SP  1,799', 'benzina sp'],
  ])('should normalize %j to %j', (rawLine, expected) => {
    expect(normalizeAlias(rawLine)).toBe(expected);
  });

  test('should keep a multipack size that is part of the description', () => {
    // "6X1,5L" is what distinguishes this product from the single bottle, so
    // the multiplier stripper must not eat it (only standalone "6 x" tokens).
    expect(normalizeAlias('ACQUA NAT 6X1,5L   4,38')).toBe('acqua nat 6x1 5l');
  });

  test('should map the same product to the same key across two receipts', () => {
    expect(normalizeAlias('PASTA BAR SPAGH N5 500G  1,29')).toBe(
      normalizeAlias('PASTA BAR SPAGH N5 500G  1,35'),
    );
  });
});

function input(overrides: Partial<DeriveUnitPriceInput> = {}): DeriveUnitPriceInput {
  return {
    lineTotalCents: 129,
    quantity: 1,
    quantityKind: 'pieces',
    unitPriceCentsOnReceipt: null,
    packageSizeHint: null,
    catalogPackageSize: null,
    unitKind: 'weight',
    ...overrides,
  };
}

describe('deriveUnitPriceMilli', () => {
  test('should derive the unit price from the receipt size hint', () => {
    const derived = deriveUnitPriceMilli(input({ packageSizeHint: 0.5 }));

    expect(derived).toMatchObject({
      quantity: 1,
      packageSize: 0.5,
      sizeSource: 'receipt',
      totalPriceCents: 129,
      unitPriceMilli: 2580,
    });
  });

  test('should divide a multiplied line by its quantity before deriving', () => {
    // "2 x 1,09  2,18" minus a 0,40 loyalty discount: 178 paid for 2 litres.
    const derived = deriveUnitPriceMilli(
      input({
        lineTotalCents: 178,
        quantity: 2,
        unitPriceCentsOnReceipt: 109,
        packageSizeHint: 1,
        unitKind: 'volume',
      }),
    );

    expect(derived).toMatchObject({
      quantity: 2,
      packageSize: 1,
      totalPriceCents: 89,
      unitPriceMilli: 890,
    });
  });

  test('should treat a weighed line as one package of its own weight', () => {
    const derived = deriveUnitPriceMilli(
      input({
        lineTotalCents: 121,
        quantity: 0.812,
        quantityKind: 'kg',
        unitPriceCentsOnReceipt: 149,
      }),
    );

    expect(derived).toMatchObject({
      quantity: 1,
      packageSize: 0.812,
      sizeSource: 'weighed',
      totalPriceCents: 121,
      // The printed €/kg wins over the value re-derived from two rounded
      // numbers, and the two agree here.
      unitPriceMilli: 1490,
      hasPrintedUnitPriceMismatch: false,
    });
  });

  test('should flag a weighed line whose printed unit price contradicts the total', () => {
    const derived = deriveUnitPriceMilli(
      input({
        lineTotalCents: 121,
        quantity: 0.812,
        quantityKind: 'kg',
        unitPriceCentsOnReceipt: 249,
      }),
    );

    expect(derived.hasPrintedUnitPriceMismatch).toBe(true);
  });

  test('should fall back to the catalog size when the receipt states none', () => {
    const derived = deriveUnitPriceMilli(input({ catalogPackageSize: 0.5 }));

    expect(derived).toMatchObject({
      packageSize: 0.5,
      sizeSource: 'catalog',
      unitPriceMilli: 2580,
    });
  });

  test('should prefer the receipt size over the catalog one', () => {
    const derived = deriveUnitPriceMilli(input({ packageSizeHint: 0.4, catalogPackageSize: 0.5 }));

    expect(derived).toMatchObject({ packageSize: 0.4, sizeSource: 'receipt' });
  });

  test('should assume one piece for a count product with no size anywhere', () => {
    const derived = deriveUnitPriceMilli(input({ lineTotalCents: 450, unitKind: 'count' }));

    expect(derived).toMatchObject({
      packageSize: 1,
      sizeSource: 'assumed-one',
      unitPriceMilli: 4500,
    });
  });

  test('should report a missing size for a weighed product with no size anywhere', () => {
    const derived = deriveUnitPriceMilli(input({ unitKind: 'weight' }));

    expect(derived).toMatchObject({
      packageSize: null,
      sizeSource: 'missing',
      unitPriceMilli: null,
    });
  });

  test('should leave the unit price unset when the line has no price', () => {
    const derived = deriveUnitPriceMilli(input({ lineTotalCents: 0, packageSizeHint: 0.5 }));

    expect(derived.unitPriceMilli).toBeNull();
  });

  test('should satisfy the entry invariant for every derived line', () => {
    const derived = deriveUnitPriceMilli(
      input({ lineTotalCents: 178, quantity: 2, packageSizeHint: 0.35 }),
    );

    // unit_price_milli x package_size = total_price_cents x 10, within the
    // one cent the rounding can introduce.
    const gap = Math.abs(
      (derived.unitPriceMilli as number) * (derived.packageSize as number) -
        derived.totalPriceCents * 10,
    );
    expect(gap).toBeLessThanOrEqual(10);
  });
});
