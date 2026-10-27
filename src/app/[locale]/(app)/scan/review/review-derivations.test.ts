import { describe, expect, test } from 'vitest';

import type { ReviewedExtraction } from '@/lib/domain/extract-photo';
import { PRESELECT_SCORE_THRESHOLD } from '@/lib/domain/receipt-lines';
import {
  applyFieldsPatch,
  applyProductPick,
  blockingReasonOf,
  type ExtractedPhoto,
  hasExtraction,
  summarizeDrafts,
  toConfirmEntry,
  toDraft,
} from './review-derivations';

/*
 * These rules decide what the user can confirm and what reaches the
 * database: a wrong preselection files a price under someone else's product,
 * and a unit price recomputed over the user's own typing silently discards
 * a correction. They are tested here, away from the screen, because the
 * screen only wires them.
 */

const BLOB_URL = 'https://store.public.blob.vercel-storage.com/users/u/photos/p.webp';

function extraction(overrides: Partial<ReviewedExtraction> = {}): ReviewedExtraction {
  return {
    productName: 'Yogurt bianco',
    brand: 'Muller',
    category: 'food',
    unitKind: 'weight',
    totalPriceCents: 89,
    packageSize: 0.5,
    unitPriceMilli: 1780,
    isPromo: false,
    promoKind: null,
    confidence: 0.92,
    rawText: 'YOGURT BIANCO 500G 0,89',
    needsReview: false,
    reviewReasons: [],
    ...overrides,
  };
}

function photo(
  options: { score?: number; extraction?: Partial<ReviewedExtraction> } = {},
): ExtractedPhoto {
  return {
    id: 'photo000000000000001A',
    sessionId: 'sess0000000000000000A',
    blob: new Blob(),
    status: 'extracted',
    attempts: 1,
    createdAt: Date.UTC(2026, 3, 15),
    extraction: {
      blobUrl: BLOB_URL,
      extraction: extraction(options.extraction),
      suggestions:
        options.score === undefined
          ? []
          : [
              {
                productId: 'prod0000000000000001A',
                name: 'Yogurt intero',
                brand: 'Muller',
                score: options.score,
              },
            ],
      model: 'claude-test',
    },
  };
}

describe('hasExtraction', () => {
  test('tells an extracted photo from one still travelling', () => {
    const { extraction: _, ...travelling } = photo();

    expect(hasExtraction(photo())).toBe(true);
    expect(hasExtraction({ ...travelling, status: 'uploading' })).toBe(false);
  });
});

describe('toDraft', () => {
  test('preselects the top suggestion when its score reaches the threshold', () => {
    const draft = toDraft(photo({ score: PRESELECT_SCORE_THRESHOLD }));

    expect(draft.selectedProduct).toEqual({
      kind: 'existing',
      productId: 'prod0000000000000001A',
      name: 'Yogurt intero',
      brand: 'Muller',
    });
  });

  test('leaves the pick to the user below the threshold or without suggestions', () => {
    expect(toDraft(photo({ score: PRESELECT_SCORE_THRESHOLD - 0.01 })).selectedProduct).toBeNull();
    expect(toDraft(photo()).selectedProduct).toBeNull();
  });

  test('splits the review verdict off the editable fields and keeps the payload verbatim', () => {
    const source = photo({ extraction: { needsReview: true, reviewReasons: ['low-confidence'] } });

    const draft = toDraft(source);

    expect(draft.needsReview).toBe(true);
    expect(draft.reviewReasons).toEqual(['low-confidence']);
    expect(draft.fields).not.toHaveProperty('needsReview');
    expect(draft.original).toBe(source.extraction.extraction);
    expect(draft.recordedAt).toBe(source.createdAt);
    expect(draft.isUnitPriceEdited).toBe(false);
  });
});

describe('applyFieldsPatch', () => {
  test('re-derives the unit price when the total changes', () => {
    const draft = toDraft(photo());

    const next = applyFieldsPatch(draft, { totalPriceCents: 100 });

    expect(next.fields.unitPriceMilli).toBe(2000);
    expect(next.isUnitPriceEdited).toBe(false);
  });

  test('keeps a unit price the user typed, then stops recomputing it', () => {
    const draft = toDraft(photo());

    const typed = applyFieldsPatch(draft, { unitPriceMilli: 1999 });
    const afterTotal = applyFieldsPatch(typed, { totalPriceCents: 100 });

    expect(typed.fields.unitPriceMilli).toBe(1999);
    expect(afterTotal.isUnitPriceEdited).toBe(true);
    expect(afterTotal.fields.unitPriceMilli).toBe(1999);
  });

  test('does not recompute while the total or the size is still the "not legible" zero', () => {
    const draft = toDraft(photo());

    const next = applyFieldsPatch(draft, { packageSize: 0 });

    expect(next.fields.unitPriceMilli).toBe(1780);
  });
});

describe('applyProductPick', () => {
  test('names a search pick from the remembered hits', () => {
    const draft = toDraft(photo());
    const hits = new Map([['prod0000000000000009Z', { name: 'Yogurt greco', brand: 'Fage' }]]);

    const next = applyProductPick(draft, { productId: 'prod0000000000000009Z' }, hits);

    expect(next.selectedProduct).toEqual({
      kind: 'existing',
      productId: 'prod0000000000000009Z',
      name: 'Yogurt greco',
      brand: 'Fage',
    });
  });

  test('falls back to the extracted name for a product seen nowhere', () => {
    const draft = toDraft(photo());

    const next = applyProductPick(draft, { productId: 'prod0000000000000009Z' }, new Map());

    expect(next.selectedProduct).toMatchObject({ name: 'Yogurt bianco', brand: null });
  });

  test('prefills "create new" from the extraction', () => {
    const draft = toDraft(photo());

    const next = applyProductPick(draft, 'new', new Map());

    expect(next.selectedProduct).toEqual({
      kind: 'new',
      name: 'Yogurt bianco',
      brand: 'Muller',
      category: 'food',
      unitKind: 'weight',
    });
  });
});

describe('blockingReasonOf', () => {
  test('asks for the product before the values', () => {
    const draft = toDraft(photo({ extraction: { totalPriceCents: 0 } }));

    expect(blockingReasonOf(draft)).toBe('product');
  });

  test('asks for the values once a product is picked', () => {
    const picked = applyProductPick(
      toDraft(photo({ extraction: { productName: '  ' } })),
      'new',
      new Map(),
    );

    expect(blockingReasonOf(picked)).toBe('values');
  });

  test('finds nothing left on a picked card with every value', () => {
    expect(blockingReasonOf(toDraft(photo({ score: 1 })))).toBeNull();
  });
});

describe('summarizeDrafts', () => {
  test('counts flagged and incomplete cards and sums the totals', () => {
    const ready = toDraft(photo({ score: 1 }));
    const flagged = { ...ready, id: 'b', needsReview: true };
    const incomplete = { ...toDraft(photo()), id: 'c' };

    const summary = summarizeDrafts([ready, flagged, incomplete]);

    expect(summary).toEqual({ flaggedCount: 2, incompleteCount: 1, runningTotalCents: 267 });
  });
});

describe('toConfirmEntry', () => {
  test('sends an existing pick by id and the original confidence, not an edited one', () => {
    const draft = applyFieldsPatch(toDraft(photo({ score: 1 })), { confidence: 0.1 });

    const entry = toConfirmEntry(draft);

    expect(entry.product).toEqual({ kind: 'existing', productId: 'prod0000000000000001A' });
    expect(entry.aiConfidence).toBe(0.92);
    expect(entry.aiRawJson).toBe(JSON.stringify(draft.original));
    expect(entry.photoUrl).toBe(BLOB_URL);
  });

  test('sends a new pick with its category and unit kind', () => {
    const draft = applyProductPick(toDraft(photo()), 'new', new Map());

    expect(toConfirmEntry(draft).product).toEqual({
      kind: 'new',
      name: 'Yogurt bianco',
      brand: 'Muller',
      category: 'food',
      unitKind: 'weight',
    });
  });
});
