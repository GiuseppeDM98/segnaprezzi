import { describe, expect, it } from 'vitest';

import { addMonthsToYm, bucketEntries, computeObservedMeans } from './bucketing';
import { computePersonalCpi } from './chain';
import { buildEntry, buildProduct, DEFAULT_SETTINGS, midMonth } from './fixtures';
import { computeMovers } from './movers';
import type { IndexEntry, IndexProduct } from './types';

/** Two observations for one product: `fromMilli` in March, `toMilli` in April. */
function buildPair(productId: string, fromMilli: number, toMilli: number): IndexEntry[] {
  return [
    buildEntry({ productId, recordedAt: midMonth('2026-03'), unitPriceMilli: fromMilli }),
    buildEntry({ productId, recordedAt: midMonth('2026-04'), unitPriceMilli: toMilli }),
  ];
}

describe('computeMovers', () => {
  it('should rank movers by percent change and cap at five risers and five fallers', () => {
    // Arrange: 8 risers (+1% … +8%) and 7 fallers (−1% … −7%).
    const entries: IndexEntry[] = [];
    const products: IndexProduct[] = [];
    for (let step = 1; step <= 8; step += 1) {
      entries.push(...buildPair(`up-${step}`, 1000, 1000 + step * 10));
      products.push(buildProduct({ id: `up-${step}`, name: `Riser ${step}` }));
    }
    for (let step = 1; step <= 7; step += 1) {
      entries.push(...buildPair(`down-${step}`, 1000, 1000 - step * 10));
      products.push(buildProduct({ id: `down-${step}`, name: `Faller ${step}` }));
    }

    // Act
    const { movers } = computePersonalCpi({ entries, products, settings: DEFAULT_SETTINGS });

    // Assert: the five largest risers, then the five most negative fallers,
    // as one array sorted by pct descending.
    expect(movers.map((mover) => mover.productId)).toEqual([
      'up-8',
      'up-7',
      'up-6',
      'up-5',
      'up-4',
      'down-3',
      'down-4',
      'down-5',
      'down-6',
      'down-7',
    ]);
    expect(movers[0].pct).toBeCloseTo(8, 10);
    expect(movers[9].pct).toBeCloseTo(-7, 10);
  });

  it('should exclude products with fewer than two observed months from movers', () => {
    // Arrange: one observation plus carry-forward, next to a real mover.
    const entries = [
      buildEntry({ productId: 'once', recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      ...buildPair('mover', 1000, 1100),
    ];
    const products = [buildProduct({ id: 'once' }), buildProduct({ id: 'mover' })];

    // Act
    const { movers } = computePersonalCpi({ entries, products, settings: DEFAULT_SETTINGS });

    // Assert: 'once' has an imputed April price, but no second observation.
    expect(movers.map((mover) => mover.productId)).toEqual(['mover']);
  });

  it('should compare movers against the observation closest to twelve months back', () => {
    // Arrange: 15 consecutive observed months, price 1000 + offset.
    const firstYm = '2025-04';
    const buildSeries = (skippedOffset: number | null) =>
      Array.from({ length: 15 }, (_, offset) => offset)
        .filter((offset) => offset !== skippedOffset)
        .map((offset) =>
          buildEntry({
            recordedAt: midMonth(addMonthsToYm(firstYm, offset)),
            unitPriceMilli: 1000 + offset,
          }),
        );
    const products = [buildProduct()];

    // Act
    const full = computePersonalCpi({
      entries: buildSeries(null),
      products,
      settings: DEFAULT_SETTINGS,
    });
    const withGap = computePersonalCpi({
      entries: buildSeries(2),
      products,
      settings: DEFAULT_SETTINGS,
    });

    // Assert: exactly toYm − 12 when observed; otherwise the earliest month
    // inside the window.
    expect(full.movers[0]).toMatchObject({
      fromYm: '2025-06',
      toYm: '2026-06',
      fromMilli: 1002,
      toMilli: 1014,
    });
    expect(withGap.movers[0]).toMatchObject({
      fromYm: '2025-07',
      toYm: '2026-06',
      fromMilli: 1003,
      toMilli: 1014,
    });
  });

  it('should exclude products whose price did not move', () => {
    const entries = [...buildPair('flat', 1000, 1000), ...buildPair('mover', 1000, 900)];
    const products = [buildProduct({ id: 'flat' }), buildProduct({ id: 'mover' })];

    const movers = computeMovers(computeObservedMeans(bucketEntries(entries), true), products);

    expect(movers.map((mover) => mover.productId)).toEqual(['mover']);
    expect(movers[0].pct).toBeCloseTo(-10, 10);
  });

  it('should break percentage ties by productId so the order is deterministic', () => {
    const entries = [...buildPair('b', 1000, 1100), ...buildPair('a', 2000, 2200)];
    const products = [buildProduct({ id: 'b' }), buildProduct({ id: 'a' })];

    const movers = computeMovers(computeObservedMeans(bucketEntries(entries), true), products);

    expect(movers.map((mover) => mover.productId)).toEqual(['a', 'b']);
  });

  it('should skip a product with no observation inside the twelve-month window', () => {
    // Two observations, but the earlier one is older than twelve months.
    const entries = [
      buildEntry({ recordedAt: midMonth('2024-01'), unitPriceMilli: 1000 }),
      buildEntry({ recordedAt: midMonth('2026-06'), unitPriceMilli: 1500 }),
    ];

    const movers = computeMovers(computeObservedMeans(bucketEntries(entries), true), [
      buildProduct(),
    ]);

    expect(movers).toEqual([]);
  });

  it('should skip a product missing from the projection instead of throwing', () => {
    const entries = buildPair('ghost', 1000, 1100);

    const movers = computeMovers(computeObservedMeans(bucketEntries(entries), true), []);

    expect(movers).toEqual([]);
  });

  it('should take the display fields from the product projection', () => {
    const entries = buildPair('pasta', 2280, 2580);
    const products = [buildProduct({ id: 'pasta', name: 'Spaghetti n.5 500g', category: 'food' })];

    const movers = computeMovers(computeObservedMeans(bucketEntries(entries), true), products);

    expect(movers).toEqual([
      {
        productId: 'pasta',
        name: 'Spaghetti n.5 500g',
        category: 'food',
        fromYm: '2026-03',
        toYm: '2026-04',
        fromMilli: 2280,
        toMilli: 2580,
        pct: (2580 / 2280 - 1) * 100,
      },
    ]);
  });
});
