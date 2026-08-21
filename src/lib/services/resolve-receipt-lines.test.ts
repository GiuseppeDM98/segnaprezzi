import { describe, expect, test } from 'vitest';

import type { ReceiptLine } from '@/lib/ai/receipt-schema';
import {
  type ResolveCandidateProduct,
  type ResolveReceiptLinesInput,
  resolveReceiptLines,
} from './resolve-receipt-lines';

const SPAGHETTI_ID = 'prod-spaghetti00000000'.slice(0, 21);
const LATTE_ID = 'prod-latte000000000000'.slice(0, 21);
const ARCHIVED_ID = 'prod-archived000000000'.slice(0, 21);

function line(overrides: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    rawLine: 'PASTA BAR SPAGH N5 500G  1,29',
    description: 'Spaghetti n.5 500g',
    brand: 'Barilla',
    category: 'food',
    quantity: 1,
    quantityKind: 'pieces',
    unitPriceCentsOnReceipt: null,
    lineTotalCents: 129,
    discountCents: 0,
    packageSizeHint: 0.5,
    unitKindHint: 'weight',
    isPromo: false,
    promoKind: null,
    confidence: 0.95,
    ...overrides,
  };
}

function product(overrides: Partial<ResolveCandidateProduct> = {}): ResolveCandidateProduct {
  return {
    id: SPAGHETTI_ID,
    name: 'Spaghetti n.5 500g',
    brand: 'Barilla',
    category: 'food',
    unitKind: 'weight',
    defaultPackageSize: 0.5,
    isArchived: false,
    hasRecentEntryAtStore: false,
    ...overrides,
  };
}

function resolve(overrides: Partial<ResolveReceiptLinesInput> = {}) {
  const lines = overrides.lines ?? [line()];
  return resolveReceiptLines({
    lines,
    lineFlags: overrides.lineFlags ?? lines.map(() => ({ reasons: [] })),
    candidates: overrides.candidates ?? [],
    aliases: overrides.aliases ?? [],
    storeChain: overrides.storeChain ?? null,
  });
}

describe('resolveReceiptLines', () => {
  test('should resolve a line through a chain-scoped alias', () => {
    const [resolved] = resolve({
      candidates: [product()],
      aliases: [{ productId: SPAGHETTI_ID, alias: 'pasta bar spagh n5 500g', storeChain: 'Coop' }],
      storeChain: 'Coop',
    });

    expect(resolved.match).toEqual({ kind: 'alias', productId: SPAGHETTI_ID, score: 1 });
    expect(resolved.selectedProduct?.productId).toBe(SPAGHETTI_ID);
    expect(resolved.status).toBe('ready');
  });

  test('should prefer the chain-scoped alias over the chain-less one', () => {
    const [resolved] = resolve({
      candidates: [product(), product({ id: LATTE_ID, name: 'Latte PS 1L', brand: 'Coop' })],
      aliases: [
        { productId: LATTE_ID, alias: 'pasta bar spagh n5 500g', storeChain: null },
        { productId: SPAGHETTI_ID, alias: 'pasta bar spagh n5 500g', storeChain: 'Coop' },
      ],
      storeChain: 'Coop',
    });

    expect(resolved.match).toMatchObject({ kind: 'alias', productId: SPAGHETTI_ID });
  });

  test('should fall back to an alias learned at another chain', () => {
    const [resolved] = resolve({
      candidates: [product()],
      aliases: [
        { productId: SPAGHETTI_ID, alias: 'pasta bar spagh n5 500g', storeChain: 'Esselunga' },
      ],
      storeChain: 'Coop',
    });

    expect(resolved.match).toMatchObject({ kind: 'alias', productId: SPAGHETTI_ID });
  });

  test('should beat a fuzzy match with an alias, even a worse-looking one', () => {
    const [resolved] = resolve({
      candidates: [product(), product({ id: LATTE_ID, name: 'Latte PS 1L', brand: 'Coop' })],
      aliases: [{ productId: LATTE_ID, alias: 'pasta bar spagh n5 500g', storeChain: null }],
    });

    expect(resolved.match).toMatchObject({ kind: 'alias', productId: LATTE_ID });
  });

  test('should fuzzy-match on the expanded description and preselect above 0.7', () => {
    const [resolved] = resolve({ candidates: [product()] });

    expect(resolved.match.kind).toBe('suggested');
    expect(resolved.selectedProduct?.productId).toBe(SPAGHETTI_ID);
  });

  test('should also fuzzy-match on the raw alias when the expansion misses', () => {
    // The catalog name is the printed abbreviation, which the model's
    // readable expansion no longer resembles.
    const [resolved] = resolve({
      lines: [
        line({
          rawLine: 'LATTE PS UHT COOP 1L  1,09',
          description: 'Latte parzialmente scremato a lunga conservazione',
          brand: null,
          packageSizeHint: 1,
          unitKindHint: 'volume',
        }),
      ],
      candidates: [
        product({
          id: LATTE_ID,
          name: 'LATTE PS UHT COOP 1L',
          brand: null,
          unitKind: 'volume',
          defaultPackageSize: 1,
        }),
      ],
    });

    expect(resolved.match).toMatchObject({ kind: 'suggested' });
    expect(resolved.selectedProduct?.productId).toBe(LATTE_ID);
  });

  test('should deduplicate the two fuzzy queries onto one suggestion per product', () => {
    const [resolved] = resolve({ candidates: [product()] });

    expect(resolved.match.kind === 'suggested' && resolved.match.suggestions).toHaveLength(1);
  });

  test('should keep archived products out of fuzzy suggestions', () => {
    const [resolved] = resolve({
      candidates: [product({ id: ARCHIVED_ID, isArchived: true })],
    });

    expect(resolved.match.kind).toBe('new');
    expect(resolved.selectedProduct).toBeNull();
  });

  test('should still resolve an archived product through its alias', () => {
    const [resolved] = resolve({
      candidates: [product({ id: ARCHIVED_ID, isArchived: true })],
      aliases: [{ productId: ARCHIVED_ID, alias: 'pasta bar spagh n5 500g', storeChain: null }],
    });

    expect(resolved.selectedProduct).toMatchObject({ productId: ARCHIVED_ID, isArchived: true });
  });

  test('should propose a new product when nothing matches', () => {
    const [resolved] = resolve({
      lines: [
        line({
          rawLine: 'QUOKKA SNACK  2,10',
          description: 'Snack al quokka',
          brand: null,
          packageSizeHint: null,
          unitKindHint: null,
          quantityKind: 'pieces',
          lineTotalCents: 210,
        }),
      ],
      candidates: [product()],
    });

    expect(resolved.match).toEqual({
      kind: 'new',
      draft: {
        name: 'Snack al quokka',
        brand: null,
        category: 'food',
        // No hint and pieces on the receipt: a countable thing.
        unitKind: 'count',
      },
    });
    // Nothing to confuse it with: a genuinely new product needs no ceremony.
    expect(resolved.status).toBe('ready');
  });

  test('should demand a decision when a suggestion is too weak to preselect', () => {
    const [resolved] = resolve({
      lines: [
        line({
          rawLine: 'PASSATA FENICOTTERO 700G  1,49',
          description: 'Passata di fenicottero 700g',
          brand: 'Mutti',
          packageSizeHint: 0.7,
        }),
      ],
      candidates: [
        product({
          id: LATTE_ID,
          name: 'Polpa di pomodoro 400g',
          brand: 'Mutti',
          unitKind: 'weight',
        }),
      ],
    });

    // The brand bonus pulls it over the 0.4 suggestion bar but nowhere near
    // the 0.7 preselect bar — the one shape that silently creates duplicates.
    expect(resolved.match.kind).toBe('suggested');
    expect(resolved.selectedProduct).toBeNull();
    expect(resolved.status).toBe('needs-product');
  });

  test('should derive a new product unit kind from a weighed quantity', () => {
    const [resolved] = resolve({
      lines: [
        line({
          rawLine: 'ORNITORINCO A PESO  0,4 kg x 9,90  3,96',
          description: 'Ornitorinco a peso',
          brand: null,
          quantity: 0.4,
          quantityKind: 'kg',
          unitPriceCentsOnReceipt: 990,
          lineTotalCents: 396,
          packageSizeHint: null,
          unitKindHint: null,
        }),
      ],
    });

    expect(resolved.match).toMatchObject({ kind: 'new', draft: { unitKind: 'weight' } });
    expect(resolved.fields).toMatchObject({
      quantity: 1,
      packageSize: 0.4,
      sizeSource: 'weighed',
    });
  });

  test('should rank needs-size above needs-product', () => {
    const [resolved] = resolve({
      lines: [
        line({
          rawLine: 'PASSATA FENICOTTERO  1,49',
          description: 'Passata di fenicottero',
          brand: 'Mutti',
          packageSizeHint: null,
          unitKindHint: 'weight',
        }),
      ],
      candidates: [
        product({
          id: LATTE_ID,
          name: 'Polpa di pomodoro 400g',
          brand: 'Mutti',
          unitKind: 'weight',
        }),
      ],
    });

    // Both a size and a product decision are missing; the size blocks harder.
    expect(resolved.status).toBe('needs-size');
  });

  test('should rank needs-product above needs-review', () => {
    const [resolved] = resolve({
      lines: [
        line({
          rawLine: 'PASSATA FENICOTTERO 700G  1,49',
          description: 'Passata di fenicottero 700g',
          brand: 'Mutti',
          packageSizeHint: 0.7,
        }),
      ],
      lineFlags: [{ reasons: ['low-confidence'] }],
      candidates: [
        product({
          id: LATTE_ID,
          name: 'Polpa di pomodoro 400g',
          brand: 'Mutti',
          unitKind: 'weight',
        }),
      ],
    });

    expect(resolved.status).toBe('needs-product');
  });

  test('should surface needs-review when the product and size are settled', () => {
    const [resolved] = resolve({
      candidates: [product()],
      lineFlags: [{ reasons: ['low-confidence'] }],
    });

    expect(resolved.status).toBe('needs-review');
    expect(resolved.reviewReasons).toEqual(['low-confidence']);
  });

  test('should add the printed-unit-price mismatch to the line reasons', () => {
    const [resolved] = resolve({
      lines: [
        line({
          rawLine: 'BANANE  0,812 kg x 2,49  1,21',
          description: 'Banane',
          brand: null,
          quantity: 0.812,
          quantityKind: 'kg',
          unitPriceCentsOnReceipt: 249,
          lineTotalCents: 121,
          packageSizeHint: 0.812,
        }),
      ],
      candidates: [product()],
    });

    expect(resolved.reviewReasons).toContain('qty-price-mismatch');
  });

  test('should take the package size from the matched product catalog entry', () => {
    const [resolved] = resolve({
      lines: [line({ packageSizeHint: null, unitKindHint: null })],
      candidates: [product()],
    });

    expect(resolved.fields).toMatchObject({
      packageSize: 0.5,
      sizeSource: 'catalog',
      unitPriceMilli: 2580,
    });
  });

  test('should keep the extraction verbatim and number the lines in receipt order', () => {
    const lines = [line(), line({ rawLine: 'LATTE 1L  1,09', description: 'Latte 1L' })];
    const resolved = resolve({ lines });

    expect(resolved.map((item) => item.index)).toEqual([0, 1]);
    expect(resolved[0].extraction).toBe(lines[0]);
    expect(resolved[1].normalizedAlias).toBe('latte 1l');
  });
});
