import { describe, expect, test } from 'vitest';

import { RECEIPT_TOTAL_TOLERANCE_CENTS } from '@/lib/domain/receipts';
import {
  applyFieldsPatch,
  applyProductPick,
  type LineDraft,
  liveHeaderReasons,
  recalculateUnitPrice,
  reconcileWithReceiptTotal,
  summarizeLines,
  toConfirmLine,
} from './receipt-review-derivations';

/*
 * The receipt review's numbers are the ones the user checks against the
 * paper in their hand: the difference to the printed total must move with
 * every correction, and the "which line to check" hint must only name a line
 * when the gap is exactly that line's packages. These tests pin that, and
 * the unit-price ownership rule the corrections share with the capture
 * review.
 */

function line(overrides: Partial<LineDraft> & { index: number }): LineDraft {
  return {
    rawLine: 'M-T PESTO GEN.COOP 1,64',
    mergedLineCount: 1,
    reviewReasons: [],
    suggestions: [],
    product: { kind: 'new', label: 'Pesto genovese', brand: 'Coop', isArchived: false },
    category: 'food',
    needsProductDecision: false,
    isExcluded: false,
    shouldLearnAlias: true,
    isUnitPriceEdited: false,
    ...overrides,
    fields: {
      quantity: 1,
      packageSize: 0.19,
      sizeSource: 'receipt',
      totalPriceCents: 164,
      unitPriceMilli: 8632,
      isPromo: false,
      promoKind: null,
      unitKind: 'weight',
      ...overrides.fields,
    },
  };
}

describe('summarizeLines', () => {
  test('leaves excluded lines out of the total and the counters', () => {
    const drafts = [
      line({ index: 0, fields: { quantity: 2 } as LineDraft['fields'] }),
      line({ index: 1, isExcluded: true }),
      line({
        index: 2,
        fields: { packageSize: null, unitPriceMilli: null } as LineDraft['fields'],
      }),
    ];

    const summary = summarizeLines(drafts);

    expect(summary.includedDrafts.map((draft) => draft.index)).toEqual([0, 2]);
    expect(summary).toMatchObject({
      readyCount: 1,
      blockedCount: 1,
      excludedCount: 1,
      includedTotalCents: 164 * 2 + 164,
    });
  });
});

describe('reconcileWithReceiptTotal', () => {
  test('has nothing to say when the receipt shows no total', () => {
    expect(reconcileWithReceiptTotal(null, [line({ index: 0 })])).toEqual({
      totalDifferenceCents: null,
      hasTotalMismatch: false,
      extraPackages: null,
    });
  });

  test('signs the difference negative when the lines add up to more than the till charged', () => {
    const drafts = [line({ index: 0, fields: { quantity: 3 } as LineDraft['fields'] })];

    const result = reconcileWithReceiptTotal(328, drafts);

    expect(result.totalDifferenceCents).toBe(-164);
    expect(result.hasTotalMismatch).toBe(true);
  });

  test('names the line whose packages exactly explain the excess', () => {
    const pesto = line({ index: 4, fields: { quantity: 3 } as LineDraft['fields'] });
    const bread = line({
      index: 5,
      product: { kind: 'new', label: 'Pane', brand: null, isArchived: false },
      fields: { totalPriceCents: 250 } as LineDraft['fields'],
    });

    const result = reconcileWithReceiptTotal(164 * 2 + 250, [pesto, bread]);

    expect(result.extraPackages).toEqual({ draft: pesto, packages: 1 });
  });

  test('closes the gap once the user corrects the packages', () => {
    const corrected = [line({ index: 0, fields: { quantity: 2 } as LineDraft['fields'] })];

    const result = reconcileWithReceiptTotal(328, corrected);

    expect(result).toEqual({
      totalDifferenceCents: 0,
      hasTotalMismatch: false,
      extraPackages: null,
    });
  });

  test('tolerates a gap within the rounding tolerance', () => {
    const result = reconcileWithReceiptTotal(164 + RECEIPT_TOTAL_TOLERANCE_CENTS, [
      line({ index: 0 }),
    ]);

    expect(result.totalDifferenceCents).toBe(RECEIPT_TOTAL_TOLERANCE_CENTS);
    expect(result.hasTotalMismatch).toBe(false);
  });
});

describe('liveHeaderReasons', () => {
  test('drops the server snapshot of the total mismatch and keeps the rest', () => {
    expect(liveHeaderReasons(['total-mismatch', 'no-date', 'low-confidence'])).toEqual([
      'no-date',
      'low-confidence',
    ]);
  });
});

describe('applyFieldsPatch', () => {
  test('re-derives the unit price once the missing size is filled in', () => {
    const draft = line({
      index: 0,
      fields: { packageSize: null, unitPriceMilli: null } as LineDraft['fields'],
    });

    const next = applyFieldsPatch(draft, { packageSize: 0.4 });

    expect(next.fields.unitPriceMilli).toBe(4100);
  });

  test('keeps a unit price the user typed, then stops recomputing it', () => {
    const typed = applyFieldsPatch(line({ index: 0 }), { unitPriceMilli: 9000 });

    const afterPrice = applyFieldsPatch(typed, { totalPriceCents: 200 });

    expect(afterPrice.isUnitPriceEdited).toBe(true);
    expect(afterPrice.fields.unitPriceMilli).toBe(9000);
  });
});

describe('recalculateUnitPrice', () => {
  test('takes the unit price back from the user', () => {
    const typed = applyFieldsPatch(line({ index: 0 }), { unitPriceMilli: 9000 });

    const next = recalculateUnitPrice(typed);

    expect(next.isUnitPriceEdited).toBe(false);
    expect(next.fields.unitPriceMilli).toBe(8632);
  });

  test('leaves a line without a size unchanged', () => {
    const draft = line({ index: 0, fields: { packageSize: null } as LineDraft['fields'] });

    expect(recalculateUnitPrice(draft)).toBe(draft);
  });
});

describe('applyProductPick', () => {
  test('answers the product question with a search hit, named from the hit', () => {
    const draft = line({ index: 0, needsProductDecision: true });
    const hits = new Map([
      [
        'prod0000000000000009Z',
        { productId: 'prod0000000000000009Z', name: 'Pesto', brand: 'Barilla' },
      ],
    ]);

    const next = applyProductPick(draft, { productId: 'prod0000000000000009Z' }, hits);

    expect(next.needsProductDecision).toBe(false);
    expect(next.product).toEqual({
      kind: 'existing',
      productId: 'prod0000000000000009Z',
      label: 'Pesto',
      brand: 'Barilla',
      isArchived: false,
    });
  });

  test('keeps the line label for "create new"', () => {
    const next = applyProductPick(line({ index: 0, needsProductDecision: true }), 'new', new Map());

    expect(next.needsProductDecision).toBe(false);
    expect(next.product).toMatchObject({ kind: 'new', label: 'Pesto genovese', brand: 'Coop' });
  });
});

describe('toConfirmLine', () => {
  test('sends a new product with the line category and unit kind', () => {
    expect(toConfirmLine(line({ index: 3, shouldLearnAlias: false }))).toEqual({
      index: 3,
      product: {
        kind: 'new',
        name: 'Pesto genovese',
        brand: 'Coop',
        category: 'food',
        unitKind: 'weight',
      },
      quantity: 1,
      packageSize: 0.19,
      totalPriceCents: 164,
      unitPriceMilli: 8632,
      isPromo: false,
      promoKind: null,
      learnAlias: false,
    });
  });
});
