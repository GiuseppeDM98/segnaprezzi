import { describe, expect, it } from 'vitest';

import {
  addMonthsToYm,
  bucketEntries,
  buildMonthGrid,
  computeObservedMeans,
  countMonthsBetween,
  imputeCarryForward,
  toRomeYearMonth,
} from './bucketing';
import { computePersonalCpi } from './chain';
import { atTenUtc, buildEntry, buildProduct, DEFAULT_SETTINGS, midMonth } from './fixtures';

describe('toRomeYearMonth', () => {
  it('should bucket a late-evening UTC timestamp into the next Rome month during DST', () => {
    // 2026 DST starts 29 March, so Rome is UTC+2: 22:30Z on 31 March is
    // 00:30 on 1 April in Rome.
    expect(toRomeYearMonth(Date.parse('2026-03-31T22:30:00Z'))).toBe('2026-04');
  });

  it('should bucket a late-evening UTC timestamp into the next Rome month outside DST', () => {
    // Rome is UTC+1 in winter: 23:30Z on 31 January is 00:30 on 1 February.
    expect(toRomeYearMonth(Date.parse('2026-01-31T23:30:00Z'))).toBe('2026-02');
  });

  it('should keep a timestamp in its UTC month when the Rome offset does not cross midnight', () => {
    expect(toRomeYearMonth(Date.parse('2026-01-31T22:30:00Z'))).toBe('2026-01');
    expect(toRomeYearMonth(atTenUtc('2026-06-15'))).toBe('2026-06');
  });
});

describe('addMonthsToYm', () => {
  it('should roll back across a year boundary', () => {
    expect(addMonthsToYm('2026-01', -2)).toBe('2025-11');
  });

  it('should roll forward across a year boundary', () => {
    expect(addMonthsToYm('2025-11', 2)).toBe('2026-01');
    expect(addMonthsToYm('2026-12', 1)).toBe('2027-01');
  });

  it('should shift by whole years and by zero', () => {
    expect(addMonthsToYm('2026-05', -12)).toBe('2025-05');
    expect(addMonthsToYm('2026-05', 13)).toBe('2027-06');
    expect(addMonthsToYm('2026-05', 0)).toBe('2026-05');
  });
});

describe('countMonthsBetween', () => {
  it('should count signed months between two keys', () => {
    expect(countMonthsBetween('2026-01', '2026-04')).toBe(3);
    expect(countMonthsBetween('2026-04', '2026-01')).toBe(-3);
    expect(countMonthsBetween('2025-11', '2026-02')).toBe(3);
    expect(countMonthsBetween('2026-03', '2026-03')).toBe(0);
  });
});

describe('buildMonthGrid', () => {
  it('should include every calendar month between the bounds, inclusive', () => {
    expect(buildMonthGrid('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(buildMonthGrid('2026-03', '2026-03')).toEqual(['2026-03']);
  });
});

describe('computeObservedMeans', () => {
  it('should bucket entries by the Europe/Rome calendar month, not UTC', () => {
    // Arrange: a March observation and one at 22:30Z on 31 March, which is
    // already April in Rome.
    const entries = [
      buildEntry({ recordedAt: atTenUtc('2026-03-15'), unitPriceMilli: 1000 }),
      buildEntry({ recordedAt: Date.parse('2026-03-31T22:30:00Z'), unitPriceMilli: 1100 }),
    ];

    // Act
    const means = computeObservedMeans(bucketEntries(entries), true);
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: DEFAULT_SETTINGS,
    });

    // Assert: two months, not one month with a 1050 mean.
    expect([...(means.get('pasta') ?? [])]).toEqual([
      ['2026-03', 1000],
      ['2026-04', 1100],
    ]);
    expect(result.series.map((point) => point.ym)).toEqual(['2026-03', '2026-04']);
    expect(result.series[1].momPct).toBeCloseTo(10, 10);
  });

  it('should exclude promo entries from monthly means when includePromosInIndex is false', () => {
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 1800, isPromo: true }),
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 2000 }),
    ];

    const withoutPromos = computeObservedMeans(bucketEntries(entries), false);
    const withPromos = computeObservedMeans(bucketEntries(entries), true);

    expect(withoutPromos.get('pasta')?.get('2026-03')).toBe(2000);
    expect(withPromos.get('pasta')?.get('2026-03')).toBe(1900);
  });

  it('should fall back to promo entries when a product-month has only promos', () => {
    // Arrange: March is promo-only, April has a regular price.
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 1800, isPromo: true }),
      buildEntry({ recordedAt: midMonth('2026-04'), unitPriceMilli: 2000 }),
    ];

    // Act
    const means = computeObservedMeans(bucketEntries(entries), false);
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: { includePromosInIndex: false, carryForwardMonths: 2 },
    });

    // Assert: March keeps the promo mean and counts as observed, not imputed.
    expect(means.get('pasta')?.get('2026-03')).toBe(1800);
    expect(result.series[1].momPct).toBeCloseTo((2000 / 1800 - 1) * 100, 10);
    expect(result.coverage.imputedShare).toBe(0);
    expect(result.coverage.productsCompared).toBe(1);
  });

  it('should average multiple observations of a product within the same month', () => {
    const entries = [
      buildEntry({ recordedAt: atTenUtc('2026-03-07'), unitPriceMilli: 2380 }),
      buildEntry({ recordedAt: atTenUtc('2026-03-21'), unitPriceMilli: 2180, isPromo: true }),
    ];

    const means = computeObservedMeans(bucketEntries(entries), true);

    expect(means.get('pasta')?.get('2026-03')).toBe(2280);
  });
});

describe('imputeCarryForward', () => {
  it('should carry a price forward up to carryForwardMonths and flag it imputed', () => {
    // Arrange: observed March 1000, gap April–May, observed June 1100.
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ recordedAt: midMonth('2026-06'), unitPriceMilli: 1100 }),
    ];
    const grid = buildMonthGrid('2026-03', '2026-06');

    // Act
    const table = imputeCarryForward(computeObservedMeans(bucketEntries(entries), true), grid, 2);
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: { includePromosInIndex: true, carryForwardMonths: 2 },
    });

    // Assert: April and May carry the March value, flagged; June is observed.
    expect([...(table.get('pasta') ?? [])]).toEqual([
      ['2026-03', { value: 1000, isImputed: false }],
      ['2026-04', { value: 1000, isImputed: true }],
      ['2026-05', { value: 1000, isImputed: true }],
      ['2026-06', { value: 1100, isImputed: false }],
    ]);
    expect(result.series.map((point) => point.index)).toEqual([
      100,
      100,
      100,
      expect.closeTo(110, 10),
    ]);
    // The May→June link uses the imputed May price: 1 of 2 prices imputed.
    expect(result.coverage.imputedShare).toBe(0.5);
    expect(result.coverage.monthsWithoutOverlap).toEqual([]);
  });

  it('should not impute beyond carryForwardMonths', () => {
    // Arrange: observed March, next observation July, window of 2 months.
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ recordedAt: midMonth('2026-07'), unitPriceMilli: 1100 }),
    ];
    const grid = buildMonthGrid('2026-03', '2026-07');

    // Act
    const table = imputeCarryForward(computeObservedMeans(bucketEntries(entries), true), grid, 2);
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: { includePromosInIndex: true, carryForwardMonths: 2 },
    });

    // Assert: June has no price, so neither the May→June nor the June→July
    // link matches the product; the index carries flat.
    expect(table.get('pasta')?.has('2026-05')).toBe(true);
    expect(table.get('pasta')?.has('2026-06')).toBe(false);
    expect(result.coverage.monthsWithoutOverlap).toEqual(['2026-06', '2026-07']);
    expect(result.series.map((point) => point.index)).toEqual([100, 100, 100, 100, 100]);
  });

  it('should not impute at all when carryForwardMonths is 0', () => {
    // Arrange: observed March, gap April, observed May.
    const entries = [
      buildEntry({ recordedAt: midMonth('2026-03'), unitPriceMilli: 1000 }),
      buildEntry({ recordedAt: midMonth('2026-05'), unitPriceMilli: 1100 }),
    ];
    const grid = buildMonthGrid('2026-03', '2026-05');

    // Act
    const table = imputeCarryForward(computeObservedMeans(bucketEntries(entries), true), grid, 0);
    const result = computePersonalCpi({
      entries,
      products: [buildProduct()],
      settings: { includePromosInIndex: true, carryForwardMonths: 0 },
    });

    // Assert: April is missing, so both links touching April are unmatched.
    expect(table.get('pasta')?.has('2026-04')).toBe(false);
    expect(result.coverage.monthsWithoutOverlap).toEqual(['2026-04', '2026-05']);
    expect(result.coverage.imputedShare).toBe(0);
  });

  it('should never backcast a price into months before the first observation', () => {
    const entries = [buildEntry({ recordedAt: midMonth('2026-05'), unitPriceMilli: 1000 })];
    const grid = buildMonthGrid('2026-03', '2026-05');

    const table = imputeCarryForward(computeObservedMeans(bucketEntries(entries), true), grid, 2);

    expect([...(table.get('pasta') ?? []).keys()]).toEqual(['2026-05']);
  });
});
