import { describe, expect, test } from 'vitest';

import { flagReceiptForReview } from './flag-receipt';
import type { ReceiptExtraction, ReceiptLine } from './receipt-schema';

/** 19 August 2026, 20:42 Rome (18:42 UTC) — inside every plausibility window. */
const NOW = Date.UTC(2026, 7, 19, 18, 42);

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

function extraction(overrides: Partial<ReceiptExtraction> = {}): ReceiptExtraction {
  return {
    storeChain: 'Coop',
    storeName: null,
    purchasedAt: '2026-08-19T18:42:00',
    receiptTotalCents: 129,
    confidence: 0.9,
    lines: [line()],
    ...overrides,
  };
}

describe('flagReceiptForReview', () => {
  test('should not flag a receipt whose lines add up to its total', () => {
    const flagged = flagReceiptForReview(extraction(), NOW);

    expect(flagged.header.needsReview).toBe(false);
    expect(flagged.header.reasons).toEqual([]);
    expect(flagged.header.linesTotalCents).toBe(129);
  });

  test('should tolerate a five-cent gap between the lines and the total', () => {
    const flagged = flagReceiptForReview(extraction({ receiptTotalCents: 134 }), NOW);

    expect(flagged.header.reasons).toEqual([]);
  });

  test('should flag a six-cent gap as a total mismatch', () => {
    const flagged = flagReceiptForReview(extraction({ receiptTotalCents: 135 }), NOW);

    expect(flagged.header.reasons).toContain('total-mismatch');
    expect(flagged.header.needsReview).toBe(true);
  });

  test('should report a missing total instead of a mismatch', () => {
    const flagged = flagReceiptForReview(extraction({ receiptTotalCents: null }), NOW);

    expect(flagged.header.reasons).toEqual(['no-total']);
  });

  test('should flag a low overall confidence', () => {
    const flagged = flagReceiptForReview(extraction({ confidence: 0.4 }), NOW);

    expect(flagged.header.reasons).toContain('low-confidence');
  });

  test('should reject a future date and fall back to now', () => {
    const flagged = flagReceiptForReview(extraction({ purchasedAt: '2030-01-05' }), NOW);

    expect(flagged.header.reasons).toContain('no-date');
    expect(flagged.header.purchasedAtMs).toBe(NOW);
  });

  test('should reject a date more than two years old', () => {
    const flagged = flagReceiptForReview(extraction({ purchasedAt: '2021-03-04' }), NOW);

    expect(flagged.header.reasons).toContain('no-date');
    expect(flagged.header.purchasedAtMs).toBe(NOW);
  });

  test('should read a legible date as a Europe/Rome wall clock', () => {
    const flagged = flagReceiptForReview(extraction({ purchasedAt: '2026-08-19T18:42:00' }), NOW);

    expect(flagged.header.reasons).not.toContain('no-date');
    // 18:42 Rome in August is 16:42 UTC (CEST, UTC+2).
    expect(flagged.header.purchasedAtMs).toBe(Date.UTC(2026, 7, 19, 16, 42));
  });

  test('should place a date-only receipt at noon Rome time', () => {
    const flagged = flagReceiptForReview(extraction({ purchasedAt: '2026-08-19' }), NOW);

    expect(flagged.header.purchasedAtMs).toBe(Date.UTC(2026, 7, 19, 10, 0));
  });

  test('should not flag a counted line whose printed arithmetic works out', () => {
    // "2 x 1,09  2,18" with a 0,40 discount: 2 x 109 = 178 + 40.
    const flagged = flagReceiptForReview(
      extraction({
        receiptTotalCents: 178,
        lines: [
          line({
            quantity: 2,
            unitPriceCentsOnReceipt: 109,
            lineTotalCents: 178,
            discountCents: 40,
          }),
        ],
      }),
      NOW,
    );

    expect(flagged.lines[0].reasons).toEqual([]);
    expect(flagged.lines[0].needsReview).toBe(false);
  });

  test('should flag a counted line whose printed arithmetic does not work out', () => {
    const flagged = flagReceiptForReview(
      extraction({
        receiptTotalCents: 178,
        lines: [
          line({
            quantity: 2,
            unitPriceCentsOnReceipt: 109,
            lineTotalCents: 178,
            discountCents: 0,
          }),
        ],
      }),
      NOW,
    );

    expect(flagged.lines[0].reasons).toContain('qty-price-mismatch');
  });

  test('should not apply the counted-line check to a weighed line', () => {
    // €/kg x kg rounds differently; deriveUnitPriceMilli owns that check.
    const flagged = flagReceiptForReview(
      extraction({
        receiptTotalCents: 121,
        lines: [
          line({
            quantity: 0.812,
            quantityKind: 'kg',
            unitPriceCentsOnReceipt: 149,
            lineTotalCents: 121,
          }),
        ],
      }),
      NOW,
    );

    expect(flagged.lines[0].reasons).toEqual([]);
  });

  test('should flag a line with no price at all', () => {
    const flagged = flagReceiptForReview(
      extraction({ receiptTotalCents: 0, lines: [line({ lineTotalCents: 0 })] }),
      NOW,
    );

    expect(flagged.lines[0].reasons).toContain('zero-price');
  });

  test('should flag a line the model was unsure about', () => {
    const flagged = flagReceiptForReview(extraction({ lines: [line({ confidence: 0.4 })] }), NOW);

    expect(flagged.lines[0].reasons).toContain('low-confidence');
  });

  test('should return one flag entry per extracted line, in order', () => {
    const flagged = flagReceiptForReview(
      extraction({
        receiptTotalCents: 258,
        lines: [line({ confidence: 0.4 }), line()],
      }),
      NOW,
    );

    expect(flagged.lines).toHaveLength(2);
    expect(flagged.lines[0].needsReview).toBe(true);
    expect(flagged.lines[1].needsReview).toBe(false);
  });
});
