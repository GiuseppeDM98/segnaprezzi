import { describe, expect, test } from 'vitest';

import type { ExtractionResult } from './extraction-schema';
import { flagExtractionForReview } from './flag-extraction';

/**
 * The invariant under test: unitPriceMilli × packageSize = totalPriceCents × 10.
 * With totalPriceCents 1000 the right-hand side is 10,000 milli-euros and the
 * 2% tolerance is exactly 200 — which makes the boundary cases easy to state.
 */
function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    productName: 'Spaghetti n.5 500g',
    brand: 'Barilla',
    category: 'food',
    unitKind: 'weight',
    totalPriceCents: 1000,
    packageSize: 1,
    unitPriceMilli: 10_000,
    isPromo: false,
    promoKind: null,
    confidence: 0.9,
    rawText: '',
    ...overrides,
  };
}

describe('flagExtractionForReview', () => {
  test('should not flag a tag whose prices agree exactly', () => {
    const result = flagExtractionForReview(extraction());

    expect(result.needsReview).toBe(false);
    expect(result.reviewReasons).toEqual([]);
  });

  test('should not flag a gap of exactly the 2% tolerance', () => {
    const result = flagExtractionForReview(extraction({ unitPriceMilli: 10_200 }));

    expect(result.needsReview).toBe(false);
  });

  test('should flag a gap above the 2% tolerance as a price mismatch', () => {
    const result = flagExtractionForReview(extraction({ unitPriceMilli: 10_300 }));

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual(['price-mismatch']);
  });

  test('should flag an extraction the model was unsure about', () => {
    const result = flagExtractionForReview(extraction({ confidence: 0.59 }));

    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toEqual(['low-confidence']);
  });

  test('should report both reasons when both apply', () => {
    const result = flagExtractionForReview(extraction({ unitPriceMilli: 10_300, confidence: 0.2 }));

    expect(result.reviewReasons).toEqual(['price-mismatch', 'low-confidence']);
  });

  test('should skip the cross-check on the "not legible" zero sentinels', () => {
    const result = flagExtractionForReview(
      extraction({ totalPriceCents: 0, packageSize: 0, unitPriceMilli: 0, confidence: 0.2 }),
    );

    expect(result.reviewReasons).toEqual(['low-confidence']);
  });

  test('should keep every extracted field untouched', () => {
    const input = extraction();

    const result = flagExtractionForReview(input);

    expect(result).toMatchObject(input);
  });
});
