import { describe, expect, it } from 'vitest';

import { bucketEntries } from './bucketing';
import { computePersonalCpi } from './chain';
import { buildEntry, buildProduct, midMonth } from './fixtures';
import type { IndexEntry } from './types';
import {
  computeCategoryWeights,
  computeMonthlyExpenditure,
  computeTrailingExpenditure,
} from './weights';

describe('computeMonthlyExpenditure', () => {
  it('should sum totalPriceCents times quantity per category and month, promos included', () => {
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), category: 'food', totalPriceCents: 100 }),
      buildEntry({
        recordedAt: midMonth('2026-03'),
        category: 'food',
        totalPriceCents: 50,
        isPromo: true,
      }),
      buildEntry({
        recordedAt: midMonth('2026-03'),
        category: 'fuel',
        totalPriceCents: 30,
        quantity: 2,
      }),
      buildEntry({ recordedAt: midMonth('2026-04'), category: 'food', totalPriceCents: 7 }),
    ];

    const expenditure = computeMonthlyExpenditure(bucketEntries(entries));

    expect([...(expenditure.get('2026-03') ?? [])]).toEqual([
      ['food', 150],
      ['fuel', 60],
    ]);
    expect([...(expenditure.get('2026-04') ?? [])]).toEqual([['food', 7]]);
  });
});

describe('computeTrailingExpenditure', () => {
  it('should sum the twelve months up to and including the month, and no further back', () => {
    // Arrange: one euro per month from 2025-01 to 2026-03.
    const entries: IndexEntry[] = [];
    for (let offset = 0; offset < 15; offset += 1) {
      const year = offset < 12 ? 2025 : 2026;
      const month = (offset % 12) + 1;
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      entries.push(buildEntry({ recordedAt: midMonth(ym), totalPriceCents: 100 }));
    }
    const expenditure = computeMonthlyExpenditure(bucketEntries(entries));

    // Act: the window for 2026-03 is 2025-04 … 2026-03.
    const trailing = computeTrailingExpenditure(expenditure, '2026-03');

    // Assert: 12 × 100, not 15 × 100.
    expect(trailing.get('food')).toBe(1200);
  });
});

describe('computeCategoryWeights', () => {
  it('should renormalize over the matched categories only', () => {
    const trailing = new Map([
      ['food' as const, 210],
      ['fuel' as const, 400],
      ['household' as const, 500],
    ]);

    const weights = computeCategoryWeights(trailing, ['fuel', 'food']);

    expect([...weights]).toEqual([
      ['food', 210 / 610],
      ['fuel', 400 / 610],
    ]);
    expect([...weights.values()].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
  });

  it('should fall back to equal weights when the matched categories have no expenditure', () => {
    const weights = computeCategoryWeights(new Map(), ['fuel', 'food', 'pets']);

    expect([...weights]).toEqual([
      ['food', 1 / 3],
      ['fuel', 1 / 3],
      ['pets', 1 / 3],
    ]);
  });

  it('should return no weights when nothing matched', () => {
    expect(computeCategoryWeights(new Map([['food' as const, 10]]), []).size).toBe(0);
  });
});

describe('expenditure weighting through computePersonalCpi', () => {
  it('should weight categories by trailing 12-month expenditure renormalized over matched categories', () => {
    // Arrange: food +10%, fuel flat, household observed in March only
    // (unmatched in April with no carry-forward).
    const entries = [
      buildEntry({
        productId: 'bread',
        category: 'food',
        recordedAt: midMonth('2026-03'),
        totalPriceCents: 100,
        unitPriceMilli: 1000,
      }),
      buildEntry({
        productId: 'bread',
        category: 'food',
        recordedAt: midMonth('2026-04'),
        totalPriceCents: 110,
        unitPriceMilli: 1100,
      }),
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth('2026-03'),
        totalPriceCents: 200,
        unitPriceMilli: 2000,
      }),
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth('2026-04'),
        totalPriceCents: 200,
        unitPriceMilli: 2000,
      }),
      buildEntry({
        productId: 'soap',
        category: 'household',
        recordedAt: midMonth('2026-03'),
        totalPriceCents: 500,
        unitPriceMilli: 5000,
      }),
    ];
    const products = [
      buildProduct({ id: 'bread', category: 'food' }),
      buildProduct({ id: 'diesel', category: 'fuel' }),
      buildProduct({ id: 'soap', category: 'household' }),
    ];

    // Act
    const result = computePersonalCpi({
      entries,
      products,
      settings: { includePromosInIndex: true, carryForwardMonths: 0 },
    });

    // Assert: household's 500 cents are redistributed — weights are 210/610
    // and 400/610, not 210/1110 and 400/1110.
    const expectedRelative = (210 / 610) * 1.1 + (400 / 610) * 1.0;
    expect(result.series[1].momPct).toBeCloseTo((expectedRelative - 1) * 100, 10);
    expect(result.coverage.categoriesCovered).toBe(2);
  });

  it('should multiply expenditure by quantity without affecting price relatives', () => {
    // Arrange: same prices in both categories; only food moves (+10%).
    const buildFixture = (foodQuantity: number) => [
      buildEntry({
        productId: 'bread',
        category: 'food',
        recordedAt: midMonth('2026-03'),
        totalPriceCents: 100,
        unitPriceMilli: 1000,
        quantity: foodQuantity,
      }),
      buildEntry({
        productId: 'bread',
        category: 'food',
        recordedAt: midMonth('2026-04'),
        totalPriceCents: 100,
        unitPriceMilli: 1100,
        quantity: foodQuantity,
      }),
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth('2026-03'),
        totalPriceCents: 100,
        unitPriceMilli: 1000,
      }),
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth('2026-04'),
        totalPriceCents: 100,
        unitPriceMilli: 1000,
      }),
    ];
    const products = [
      buildProduct({ id: 'bread', category: 'food' }),
      buildProduct({ id: 'diesel', category: 'fuel' }),
    ];
    const settings = { includePromosInIndex: true, carryForwardMonths: 2 };

    // Act
    const single = computePersonalCpi({ entries: buildFixture(1), products, settings });
    const triple = computePersonalCpi({ entries: buildFixture(3), products, settings });

    // Assert: food weight goes from 200/400 to 600/800; the food relative
    // itself (and hence the food series) is identical in both runs.
    expect(single.series[1].momPct).toBeCloseTo((0.5 * 1.1 + 0.5 * 1.0 - 1) * 100, 10);
    expect(triple.series[1].momPct).toBeCloseTo((0.75 * 1.1 + 0.25 * 1.0 - 1) * 100, 10);
    expect(triple.categories).toStrictEqual(single.categories);

    const tripleExpenditure = computeMonthlyExpenditure(bucketEntries(buildFixture(3)));
    expect(tripleExpenditure.get('2026-03')?.get('food')).toBe(300);
    expect(tripleExpenditure.get('2026-03')?.get('fuel')).toBe(100);
  });
});
