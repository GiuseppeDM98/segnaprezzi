import { describe, expect, it } from 'vitest';

import { addMonthsToYm } from './bucketing';
import { chainSeries, computeJevons, computePersonalCpi } from './chain';
import {
  buildEntry,
  buildProduct,
  buildWorkedExample,
  createSeededRandom,
  DEFAULT_SETTINGS,
  midMonth,
  shuffleWith,
} from './fixtures';
import type { IndexEntry, IndexProduct, MonthPoint } from './types';

/** A one-product series: one entry per month from `firstYm`, at the given unit prices. */
function buildSingleProductSeries(firstYm: string, unitPrices: number[]): IndexEntry[] {
  return unitPrices.map((unitPriceMilli, offset) =>
    buildEntry({ recordedAt: midMonth(addMonthsToYm(firstYm, offset)), unitPriceMilli }),
  );
}

function expectPoint(point: MonthPoint, expected: MonthPoint): void {
  expect(point.ym).toBe(expected.ym);
  expect(point.index).toBeCloseTo(expected.index, 4);
  expect(point.momPct).toBeCloseTo(expected.momPct, 4);
  if (expected.yoyPct === null) {
    expect(point.yoyPct).toBeNull();
  } else {
    expect(point.yoyPct).toBeCloseTo(expected.yoyPct, 4);
  }
}

describe('computeJevons', () => {
  it('should pass the time-reversal test that the Carli mean fails', () => {
    // A price that doubles then halves is back where it started.
    expect(computeJevons([2, 0.5])).toBeCloseTo(1, 12);
  });

  it('should equal the single relative for a one-product category', () => {
    expect(computeJevons([1.0183])).toBeCloseTo(1.0183, 12);
  });

  it('should combine symmetric moves into a geometric mean below 1', () => {
    expect(computeJevons([1.1, 0.9])).toBeCloseTo(Math.sqrt(0.99), 12);
  });
});

describe('chainSeries', () => {
  it('should start at 100, multiply relatives, and carry flat where none exists', () => {
    const months = ['2026-03', '2026-04', '2026-05', '2026-06'];
    const relatives = new Map([
      ['2026-04', 1.1],
      ['2026-06', 0.9],
    ]);

    const series = chainSeries(months, relatives);

    expect(series.map((point) => point.index)).toEqual([
      100,
      expect.closeTo(110, 10),
      expect.closeTo(110, 10),
      expect.closeTo(99, 10),
    ]);
    expect(series.map((point) => point.momPct)).toEqual([
      0,
      expect.closeTo(10, 10),
      0,
      expect.closeTo(-10, 10),
    ]);
    expect(series.every((point) => point.yoyPct === null)).toBe(true);
  });
});

describe('computePersonalCpi', () => {
  it('should return empty series and null headline when there are no entries', () => {
    const result = computePersonalCpi({ entries: [], products: [], settings: DEFAULT_SETTINGS });

    expect(result).toEqual({
      series: [],
      headline: null,
      categories: [],
      movers: [],
      coverage: {
        productsCompared: 0,
        categoriesCovered: 0,
        imputedShare: 0,
        entryCount: 0,
        monthsWithoutOverlap: [],
        outliersClamped: 0,
      },
    });
  });

  it('should return a single base point at 100 for one month of data', () => {
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 2380 }),
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 2180 }),
    ];

    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    expect(result.series).toEqual([{ ym: '2026-03', index: 100, momPct: 0, yoyPct: null }]);
    expect(result.headline).toEqual({
      latestYm: '2026-03',
      momPct: 0,
      yoyPct: null,
      sinceStartPct: 0,
    });
    expect(result.categories).toEqual([
      { category: 'food', series: [{ ym: '2026-03', index: 100, momPct: 0, yoyPct: null }] },
    ]);
    expect(result.coverage).toEqual({
      productsCompared: 0,
      categoriesCovered: 0,
      imputedShare: 0,
      entryCount: 2,
      monthsWithoutOverlap: [],
      outliersClamped: 0,
    });
    expect(result.movers).toEqual([]);
  });

  it("should compute a single-product chain equal to the product's price relatives", () => {
    const entries = buildSingleProductSeries('2026-03', [1000, 1100, 990]);

    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    expect(result.series.map((point) => point.index)).toEqual([
      100,
      expect.closeTo(110, 10),
      expect.closeTo(99, 10),
    ]);
    expect(result.series.map((point) => point.momPct)).toEqual([
      0,
      expect.closeTo(10, 10),
      expect.closeTo(-10, 10),
    ]);
    expect(result.headline?.sinceStartPct).toBeCloseTo(-1, 10);
    // One product: its category carries weight 1 after renormalization.
    expect(result.categories[0].series.map((point) => point.index)).toEqual(
      result.series.map((point) => point.index),
    );
  });

  it('should average multiple observations of a product within the same month', () => {
    // March 2380 and 2180 average to 2280; April 2280 then yields a relative of 1.
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 2380 }),
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 2180 }),
      buildEntry({ recordedAt: midMonth('2026-04'), unitPriceMilli: 2280 }),
    ];

    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    expect(result.series[1].index).toBe(100);
    expect(result.series[1].momPct).toBe(0);
  });

  it('should keep the index flat and flag months with no product overlap', () => {
    // Arrange: product A in March only, product B in April only, no imputation.
    const entries = [
      buildEntry({ productId: 'a', recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ productId: 'b', recordedAt: midMonth('2026-04'), unitPriceMilli: 5000 }),
    ];
    const products = [buildProduct({ id: 'a' }), buildProduct({ id: 'b' })];

    // Act
    const result = computePersonalCpi({
      entries,
      products,
      settings: { includePromosInIndex: true, carryForwardMonths: 0 },
    });

    // Assert
    expect(result.series).toEqual([
      { ym: '2026-03', index: 100, momPct: 0, yoyPct: null },
      { ym: '2026-04', index: 100, momPct: 0, yoyPct: null },
    ]);
    expect(result.coverage.monthsWithoutOverlap).toEqual(['2026-04']);
    expect(result.coverage.productsCompared).toBe(0);
  });

  it('should count a single-observation product in weights but not in price change', () => {
    // Arrange: a one-off expensive purchase in food, a +10% mover in fuel.
    const entries = [
      buildEntry({
        productId: 'tv',
        category: 'food',
        recordedAt: midMonth('2026-03'),
        totalPriceCents: 100000,
        unitPriceMilli: 100000,
      }),
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth('2026-03'),
        totalPriceCents: 1000,
        unitPriceMilli: 1000,
      }),
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth('2026-04'),
        totalPriceCents: 1100,
        unitPriceMilli: 1100,
      }),
    ];
    const products = [
      buildProduct({ id: 'tv', category: 'food' }),
      buildProduct({ id: 'diesel', category: 'fuel' }),
    ];

    // Act
    const result = computePersonalCpi({ entries, products, settings: DEFAULT_SETTINGS });

    // Assert: the carried-forward tv contributes a relative of 1 with weight
    // 100000/102100, damping the fuel move; nothing throws.
    const foodWeight = 100000 / 102100;
    const expectedRelative = foodWeight * 1 + (1 - foodWeight) * 1.1;
    expect(result.series[1].index).toBeCloseTo(expectedRelative * 100, 8);
    expect(result.series[1].index).toBeGreaterThan(100);
    expect(result.series[1].index).toBeLessThan(110);
    expect(result.coverage.productsCompared).toBe(2);
    expect(result.coverage.imputedShare).toBe(0.25);
  });

  it('should start a category series at 100 in the month the category first appears', () => {
    // Arrange: food for five months (+1% each), fuel from the third month.
    const foodEntries = buildSingleProductSeries('2026-01', [1000, 1010, 1020, 1030, 1040]);
    const fuelEntries = [1700, 1750, 1800].map((unitPriceMilli, offset) =>
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth(addMonthsToYm('2026-03', offset)),
        totalPriceCents: 5000,
        unitPriceMilli,
      }),
    );
    const products = [buildProduct(), buildProduct({ id: 'diesel', category: 'fuel' })];

    // Act
    const withFuel = computePersonalCpi({
      entries: [...foodEntries, ...fuelEntries],
      products,
      settings: DEFAULT_SETTINGS,
    });
    const foodOnly = computePersonalCpi({
      entries: foodEntries,
      products,
      settings: DEFAULT_SETTINGS,
    });

    // Assert: the fuel series starts in March at 100; the overall series is
    // unchanged before fuel enters the matched set (from the March→April link).
    const fuel = withFuel.categories.find((category) => category.category === 'fuel');
    expect(fuel?.series.map((point) => point.ym)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(fuel?.series[0]).toEqual({ ym: '2026-03', index: 100, momPct: 0, yoyPct: null });
    expect(fuel?.series[1].index).toBeCloseTo((1750 / 1700) * 100, 10);
    expect(withFuel.series.slice(0, 3)).toStrictEqual(foodOnly.series.slice(0, 3));
    expect(withFuel.series[3].index).not.toBeCloseTo(foodOnly.series[3].index, 6);
  });

  it('should compute the category relative as a geometric mean of product relatives', () => {
    // Arrange: two food products, +10% and −10%.
    const entries = [
      buildEntry({ productId: 'a', recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ productId: 'a', recordedAt: midMonth('2026-04'), unitPriceMilli: 1100 }),
      buildEntry({ productId: 'b', recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ productId: 'b', recordedAt: midMonth('2026-04'), unitPriceMilli: 900 }),
    ];
    const products = [buildProduct({ id: 'a' }), buildProduct({ id: 'b' })];

    // Act
    const result = computePersonalCpi({ entries, products, settings: DEFAULT_SETTINGS });

    // Assert: √(1.1 × 0.9) = 0.99499, not the Carli 1.0.
    expect(result.series[1].index).toBeCloseTo(Math.sqrt(0.99) * 100, 10);
    expect(result.series[1].momPct).toBeCloseTo((Math.sqrt(0.99) - 1) * 100, 10);
    expect(result.series[1].index).not.toBe(100);
  });

  it('should report yoyPct only from the 13th month of the series', () => {
    // Arrange: 13 months, +1% every month.
    const unitPrices = Array.from({ length: 13 }, (_, offset) => 1000 * 1.01 ** offset);
    const entries = buildSingleProductSeries('2025-06', unitPrices);

    // Act
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    // Assert
    expect(result.series).toHaveLength(13);
    expect(result.series.slice(0, 12).every((point) => point.yoyPct === null)).toBe(true);
    expect(result.series[12].yoyPct).toBeCloseTo((1.01 ** 12 - 1) * 100, 4);
    expect(result.series[12].yoyPct).toBeCloseTo(12.6825, 4);
    expect(result.headline?.yoyPct).toBeCloseTo(12.6825, 4);
  });

  it('should fall back to equal weights when matched categories have no trailing expenditure', () => {
    // Arrange (pathological carryForwardMonths > 11): both products are
    // observed in month 1 only and carried forward for 14 months, so the
    // 13→14 link is matched but its trailing expenditure window is empty.
    const entries = [
      buildEntry({
        productId: 'pasta',
        category: 'food',
        recordedAt: midMonth('2025-01'),
        unitPriceMilli: 1000,
      }),
      buildEntry({
        productId: 'diesel',
        category: 'fuel',
        recordedAt: midMonth('2025-01'),
        unitPriceMilli: 1700,
      }),
      buildEntry({
        productId: 'pasta',
        category: 'food',
        recordedAt: midMonth('2026-03'),
        unitPriceMilli: 1100,
      }),
    ];
    const products = [buildProduct(), buildProduct({ id: 'diesel', category: 'fuel' })];

    // Act
    const result = computePersonalCpi({
      entries,
      products,
      settings: { includePromosInIndex: true, carryForwardMonths: 14 },
    });

    // Assert: no NaN anywhere, and the all-imputed months stay flat.
    expect(result.series.every((point) => Number.isFinite(point.index))).toBe(true);
    expect(result.series[13]).toMatchObject({ ym: '2026-02', index: 100, momPct: 0 });
    expect(result.coverage.monthsWithoutOverlap).toEqual([]);
  });

  it('should reproduce every number of the Spec 04 §6 worked example', () => {
    // Arrange
    const { entries, products } = buildWorkedExample();

    // Act
    const result = computePersonalCpi({ entries, products, settings: DEFAULT_SETTINGS });

    // Assert — §6.5 final series
    const expectedSeries: MonthPoint[] = [
      { ym: '2026-03', index: 100.0, momPct: 0.0, yoyPct: null },
      { ym: '2026-04', index: 102.5149, momPct: 2.5149, yoyPct: null },
      { ym: '2026-05', index: 103.6355, momPct: 1.0931, yoyPct: null },
      { ym: '2026-06', index: 103.2405, momPct: -0.3812, yoyPct: null },
    ];
    expect(result.series).toHaveLength(4);
    for (const [position, expected] of expectedSeries.entries()) {
      expectPoint(result.series[position], expected);
    }

    // §6.5 headline
    expect(result.headline?.latestYm).toBe('2026-06');
    expect(result.headline?.momPct).toBeCloseTo(-0.3812, 4);
    expect(result.headline?.yoyPct).toBeNull();
    expect(result.headline?.sinceStartPct).toBeCloseTo(3.2405, 4);

    // §6.5 category series
    const expectedFood = [100.0, 107.9402, 106.6612, 107.6988];
    const expectedFuel = [100.0, 101.83, 103.2468, 102.6564];
    expect(result.categories.map((category) => category.category)).toEqual(['food', 'fuel']);
    for (const [position, expected] of expectedFood.entries()) {
      expect(result.categories[0].series[position].ym).toBe(expectedSeries[position].ym);
      expect(result.categories[0].series[position].index).toBeCloseTo(expected, 4);
    }
    for (const [position, expected] of expectedFuel.entries()) {
      expect(result.categories[1].series[position].ym).toBe(expectedSeries[position].ym);
      expect(result.categories[1].series[position].index).toBeCloseTo(expected, 4);
    }

    // §6.5 coverage
    expect(result.coverage.productsCompared).toBe(3);
    expect(result.coverage.categoriesCovered).toBe(2);
    expect(result.coverage.imputedShare).toBeCloseTo(0.1667, 4);
    expect(result.coverage.entryCount).toBe(13);
    expect(result.coverage.monthsWithoutOverlap).toEqual([]);
    expect(result.coverage.outliersClamped).toBe(0);

    // §6.5 movers
    expect(result.movers).toHaveLength(3);
    expect(result.movers[0]).toMatchObject({
      productId: 'pasta',
      name: 'Spaghetti n.5 500g',
      category: 'food',
      fromYm: '2026-03',
      toYm: '2026-06',
      fromMilli: 2280,
      toMilli: 2580,
    });
    expect(result.movers[0].pct).toBeCloseTo(13.1579, 4);
    expect(result.movers[1]).toMatchObject({
      productId: 'diesel',
      fromYm: '2026-03',
      toYm: '2026-06',
      fromMilli: 1694,
      toMilli: 1739,
    });
    expect(result.movers[1].pct).toBeCloseTo(2.6564, 4);
    expect(result.movers[2]).toMatchObject({
      productId: 'oil',
      fromYm: '2026-03',
      toYm: '2026-06',
      fromMilli: 7990,
      toMilli: 8190,
    });
    expect(result.movers[2].pct).toBeCloseTo(2.5031, 4);
  });

  it('property: constant prices always yield a flat series at 100', () => {
    const random = createSeededRandom(20260821);
    const categories = ['food', 'beverages', 'fuel', 'household', 'pets'] as const;
    const carryForwardMonths = 2;

    for (let fixture = 0; fixture < 50; fixture += 1) {
      // Arrange: N products with a constant price each, observed over M
      // months with random gaps no longer than the carry-forward window.
      const productCount = 1 + Math.floor(random() * 6);
      const monthCount = 1 + Math.floor(random() * 18);
      const entries: IndexEntry[] = [];
      const products: IndexProduct[] = [];
      for (let productIndex = 0; productIndex < productCount; productIndex += 1) {
        const productId = `p${productIndex}`;
        const category = categories[Math.floor(random() * categories.length)];
        const unitPriceMilli = 100 + Math.floor(random() * 99900);
        products.push(buildProduct({ id: productId, category }));
        let offset = Math.floor(random() * monthCount);
        while (offset < monthCount) {
          const observations = 1 + Math.floor(random() * 3);
          for (let observation = 0; observation < observations; observation += 1) {
            entries.push(
              buildEntry({
                productId,
                category,
                recordedAt: midMonth(addMonthsToYm('2025-01', offset)),
                totalPriceCents: Math.floor(random() * 10000),
                unitPriceMilli,
                isPromo: random() < 0.3,
              }),
            );
          }
          offset += 1 + Math.floor(random() * (carryForwardMonths + 1));
        }
      }
      if (entries.length === 0) {
        continue;
      }

      // Act
      const result = computePersonalCpi({
        entries,
        products,
        settings: { includePromosInIndex: random() < 0.5, carryForwardMonths },
      });

      // Assert
      const allPoints = [
        ...result.series,
        ...result.categories.flatMap((category) => category.series),
      ];
      expect(allPoints.length).toBeGreaterThan(0);
      for (const point of allPoints) {
        expect(Math.abs(point.index - 100)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(point.momPct)).toBeLessThanOrEqual(1e-9);
      }
      expect(result.movers).toEqual([]);
      expect(result.coverage.outliersClamped).toBe(0);
    }
  });

  it('should return bit-identical results regardless of input entry order', () => {
    // Arrange
    const { entries, products } = buildWorkedExample();
    const random = createSeededRandom(42);
    const shuffledEntries = shuffleWith(entries, random);
    const shuffledProducts = shuffleWith(products, random);
    expect(shuffledEntries).not.toEqual(entries);

    // Act
    const reference = computePersonalCpi({ entries, products, settings: DEFAULT_SETTINGS });
    const shuffled = computePersonalCpi({
      entries: shuffledEntries,
      products: shuffledProducts,
      settings: DEFAULT_SETTINGS,
    });

    // Assert
    expect(shuffled).toStrictEqual(reference);
  });
});
