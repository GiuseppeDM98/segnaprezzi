import { describe, expect, it } from 'vitest';

import { computePersonalCpi } from './chain';
import { buildEntry, buildProduct, DEFAULT_SETTINGS, midMonth } from './fixtures';
import {
  clampRelative,
  computeMonthLink,
  RELATIVE_CLAMP_MAX,
  RELATIVE_CLAMP_MIN,
} from './relatives';
import type { PriceTable } from './types';

describe('clampRelative', () => {
  it('should leave relatives inside the bounds untouched, bounds included', () => {
    expect(clampRelative(1.05)).toEqual({ value: 1.05, wasClamped: false });
    expect(clampRelative(RELATIVE_CLAMP_MAX)).toEqual({ value: 5, wasClamped: false });
    expect(clampRelative(RELATIVE_CLAMP_MIN)).toEqual({ value: 0.2, wasClamped: false });
  });

  it('should clamp relatives outside the bounds and report it', () => {
    expect(clampRelative(60)).toEqual({ value: 5, wasClamped: true });
    expect(clampRelative(0.01)).toEqual({ value: 0.2, wasClamped: true });
  });
});

describe('computeMonthLink', () => {
  it('should match only products priced in both months and sort them by productId', () => {
    // Arrange: 'zeta' and 'alpha' are matched, 'gap' is priced in one month only.
    const table: PriceTable = new Map([
      [
        'zeta',
        new Map([
          ['2026-03', { value: 1000, isImputed: false }],
          ['2026-04', { value: 1100, isImputed: true }],
        ]),
      ],
      ['gap', new Map([['2026-03', { value: 500, isImputed: false }]])],
      [
        'alpha',
        new Map([
          ['2026-03', { value: 2000, isImputed: false }],
          ['2026-04', { value: 1900, isImputed: false }],
        ]),
      ],
    ]);
    const categories = new Map([
      ['zeta', 'fuel' as const],
      ['gap', 'food' as const],
      ['alpha', 'food' as const],
    ]);

    // Act
    const link = computeMonthLink(table, new Map(), categories, '2026-03', '2026-04');

    // Assert
    expect(link).toEqual({
      fromYm: '2026-03',
      toYm: '2026-04',
      clampedCount: 0,
      relatives: [
        {
          productId: 'alpha',
          category: 'food',
          relative: 0.95,
          isFromImputed: false,
          isToImputed: false,
          isPriceCompared: true,
        },
        {
          productId: 'zeta',
          category: 'fuel',
          relative: 1.1,
          isFromImputed: false,
          isToImputed: true,
          isPriceCompared: false,
        },
      ],
    });
  });

  it('should clamp a relative above 5 and count it in outliersClamped', () => {
    // Arrange: a €/100 g tag normalized as €/kg — ×60 month over month.
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ recordedAt: midMonth('2026-04'), unitPriceMilli: 60000 }),
    ];

    // Act
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    // Assert: the relative is treated as 5, not 60.
    expect(result.series[1].index).toBeCloseTo(500, 10);
    expect(result.series[1].momPct).toBeCloseTo(400, 10);
    expect(result.coverage.outliersClamped).toBe(1);
  });

  it('should clamp a relative below 0.2 and count it in outliersClamped', () => {
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 60000 }),
      buildEntry({ recordedAt: midMonth('2026-04'), unitPriceMilli: 1000 }),
    ];

    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    expect(result.series[1].index).toBeCloseTo(20, 10);
    expect(result.series[1].momPct).toBeCloseTo(-80, 10);
    expect(result.coverage.outliersClamped).toBe(1);
  });

  it('should let a genuine large move below the bound pass untouched', () => {
    // Vegetables doubling after a frost: +100% → 2.0, well inside [0.2, 5].
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ recordedAt: midMonth('2026-04'), unitPriceMilli: 2000 }),
    ];

    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    expect(result.series[1].index).toBeCloseTo(200, 10);
    expect(result.coverage.outliersClamped).toBe(0);
  });
});

describe('store-by-store comparison through computePersonalCpi', () => {
  const COOP = 'store-coop';
  const ESSELUNGA = 'store-esselunga';

  /** One banana observation: `unitPriceMilli` at `storeId` in the middle of `ym`. */
  function banana(ym: string, storeId: string | null, unitPriceMilli: number) {
    return buildEntry({ recordedAt: midMonth(ym), storeId, unitPriceMilli });
  }

  function computeIndexes(entries: ReturnType<typeof banana>[], carryForwardMonths = 2) {
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: { ...DEFAULT_SETTINGS, carryForwardMonths },
    });
    return { result, indexes: result.series.map((point) => point.index) };
  }

  it('should not read a change of store as a price change', () => {
    const { indexes, result } = computeIndexes([
      banana('2026-03', COOP, 1500),
      banana('2026-04', ESSELUNGA, 1800),
    ]);

    expect(indexes).toEqual([100, 100]);
    // April has a real price, but it was compared with nothing.
    expect(result.coverage.productsWithoutLatestPrice).toBe(0);
    expect(result.categories[0].comparedMonths).toEqual([]);
  });

  it('should compare a store with itself when another store appears beside it', () => {
    const { indexes, result } = computeIndexes([
      banana('2026-03', COOP, 1500),
      banana('2026-04', COOP, 1650),
      banana('2026-04', ESSELUNGA, 2500),
    ]);

    expect(indexes[1]).toBeCloseTo(110, 10);
    expect(result.categories[0].comparedMonths).toEqual(['2026-04']);
  });

  it('should not move when one of two stores is missing and comes back at the same price', () => {
    // The cross-store mean would read 1650 → 1500 → 1650: −9%, then +10%.
    const { indexes } = computeIndexes([
      banana('2026-03', COOP, 1500),
      banana('2026-03', ESSELUNGA, 1800),
      banana('2026-04', COOP, 1500),
      banana('2026-05', COOP, 1500),
      banana('2026-05', ESSELUNGA, 1800),
    ]);

    expect(indexes).toEqual([100, 100, 100]);
  });

  it('should not drift when two stores alternate at unchanged prices', () => {
    // Comparing only the stores observed in both months would leave the index
    // at 83,3 for good from May on.
    const { indexes } = computeIndexes([
      banana('2026-03', COOP, 1500),
      banana('2026-03', ESSELUNGA, 1800),
      banana('2026-04', ESSELUNGA, 1800),
      banana('2026-05', COOP, 1500),
      banana('2026-06', COOP, 1500),
      banana('2026-06', ESSELUNGA, 1800),
    ]);

    expect(indexes).toEqual([100, 100, 100, 100]);
  });

  it('should deliver a rise once when two stores raise their price in turn', () => {
    const { indexes } = computeIndexes([
      banana('2026-03', COOP, 1000),
      banana('2026-03', ESSELUNGA, 2000),
      banana('2026-04', COOP, 1100),
      banana('2026-05', ESSELUNGA, 2200),
    ]);

    // Half of the +10% in April, the other half in May: never +21%.
    expect(indexes[1]).toBeCloseTo(100 * Math.sqrt(1.1), 10);
    expect(indexes[2]).toBeCloseTo(110, 10);
  });

  it('should fall back on the cross-store ratio when the months share no store', () => {
    // With no carry-forward nothing connects the two stores, and dropping the
    // product from the link would hide what the user paid.
    const { indexes, result } = computeIndexes(
      [banana('2026-03', COOP, 1500), banana('2026-04', ESSELUNGA, 1800)],
      0,
    );

    expect(indexes[1]).toBeCloseTo(120, 10);
    expect(result.categories[0].comparedMonths).toEqual(['2026-04']);
  });

  it('should treat entries with no store as one store of their own', () => {
    const { indexes } = computeIndexes([
      banana('2026-03', null, 1000),
      banana('2026-04', null, 1100),
    ]);

    expect(indexes[1]).toBeCloseTo(110, 10);
  });

  it('should give the same bits whatever order the stores arrive in', () => {
    const entries = [
      banana('2026-03', COOP, 1000),
      banana('2026-03', ESSELUNGA, 2000),
      banana('2026-04', COOP, 1100),
      banana('2026-04', ESSELUNGA, 2300),
    ];

    expect(computeIndexes([...entries].reverse()).indexes).toEqual(computeIndexes(entries).indexes);
  });

  it('should clamp the store-compared relative like any other', () => {
    const { result } = computeIndexes([
      banana('2026-03', COOP, 1000),
      banana('2026-04', COOP, 9000),
    ]);

    expect(result.series[1].index).toBe(500);
    expect(result.coverage.outliersClamped).toBe(1);
  });
});
