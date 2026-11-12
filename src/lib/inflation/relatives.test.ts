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
    const link = computeMonthLink(table, categories, '2026-03', '2026-04');

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
        },
        {
          productId: 'zeta',
          category: 'fuel',
          relative: 1.1,
          isFromImputed: false,
          isToImputed: true,
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

describe('one price per product through computePersonalCpi', () => {
  /** One banana observation: `unitPriceMilli` in the middle of `ym`. */
  function banana(ym: string, unitPriceMilli: number) {
    return buildEntry({ recordedAt: midMonth(ym), unitPriceMilli });
  }

  function computeIndexes(entries: ReturnType<typeof banana>[]) {
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });
    return { result, indexes: result.series.map((point) => point.index) };
  }

  it('should read a dearer price as a rise, wherever it was seen', () => {
    const { indexes, result } = computeIndexes([banana('2026-03', 1500), banana('2026-04', 1800)]);

    expect(indexes[1]).toBeCloseTo(120, 10);
    expect(result.categories[0].comparedMonths).toEqual(['2026-04']);
  });

  it('should give the rise back when the cheaper price returns', () => {
    // A month at a dearer shop is noise on that month, never drift: the links
    // multiply back to latest price / first price.
    const { indexes } = computeIndexes([
      banana('2026-03', 1500),
      banana('2026-04', 1800),
      banana('2026-05', 1500),
    ]);

    expect(indexes[1]).toBeCloseTo(120, 10);
    expect(indexes[2]).toBeCloseTo(100, 10);
  });

  it('should compare the mean of a month with two prices', () => {
    const { indexes } = computeIndexes([
      banana('2026-03', 1500),
      banana('2026-03', 1800),
      banana('2026-04', 1500),
    ]);

    expect(indexes[1]).toBeCloseTo((100 * 1500) / 1650, 10);
  });

  it('should not count a carried-forward month as a compared price', () => {
    const { indexes, result } = computeIndexes([banana('2026-03', 1500), banana('2026-05', 1650)]);

    expect(indexes[1]).toBe(100);
    expect(indexes[2]).toBeCloseTo(110, 10);
    expect(result.categories[0].comparedMonths).toEqual(['2026-05']);
  });

  it('should give the same bits whatever order the prices arrive in', () => {
    const entries = [
      banana('2026-03', 1000),
      banana('2026-03', 2000),
      banana('2026-04', 1100),
      banana('2026-04', 2300),
    ];

    expect(computeIndexes([...entries].reverse()).indexes).toEqual(computeIndexes(entries).indexes);
  });
});
