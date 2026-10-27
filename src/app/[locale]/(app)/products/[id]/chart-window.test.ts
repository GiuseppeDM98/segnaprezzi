import { describe, expect, test } from 'vitest';

import {
  hasOlderMonths,
  type MonthPoint,
  RECENT_RANGE_MONTHS,
  selectChartWindow,
  seriesEndpoints,
} from './chart-window';

/** A series of `count` consecutive months of 2024–2026, oldest first, valued 1, 2, 3… */
function monthsOf(count: number): MonthPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const year = 2024 + Math.floor(index / 12);
    const month = String((index % 12) + 1).padStart(2, '0');
    return { month: `${year}-${month}`, value: index + 1 };
  });
}

describe('hasOlderMonths', () => {
  test('should offer no range toggle for a series that fits the recent window', () => {
    expect(hasOlderMonths(monthsOf(RECENT_RANGE_MONTHS))).toBe(false);
  });

  test('should offer the range toggle once the series is longer than the recent window', () => {
    expect(hasOlderMonths(monthsOf(RECENT_RANGE_MONTHS + 1))).toBe(true);
  });
});

describe('selectChartWindow', () => {
  test('should keep only the most recent months in the default range', () => {
    // Arrange
    const monthly = monthsOf(15);

    // Act
    const { series } = selectChartWindow(monthly, [], '12');

    // Assert
    expect(series).toHaveLength(RECENT_RANGE_MONTHS);
    expect(series[0]).toEqual(monthly[3]);
    expect(series.at(-1)).toEqual(monthly[14]);
  });

  test('should keep every month in the all range', () => {
    const monthly = monthsOf(15);

    expect(selectChartWindow(monthly, [], 'all').series).toEqual(monthly);
  });

  test('should drop the promo markers of months outside the visible window', () => {
    // Arrange
    const monthly = monthsOf(15);
    const early = { month: monthly[0].month, value: 1 };
    const recent = { month: monthly[14].month, value: 14 };

    // Act
    const recentWindow = selectChartWindow(monthly, [early, recent], '12');
    const allWindow = selectChartWindow(monthly, [early, recent], 'all');

    // Assert
    expect(recentWindow.markers).toEqual([recent]);
    expect(allWindow.markers).toEqual([early, recent]);
  });

  test('should return a short series unchanged in the default range', () => {
    const monthly = monthsOf(3);

    expect(selectChartWindow(monthly, [], '12').series).toEqual(monthly);
  });
});

describe('seriesEndpoints', () => {
  test('should read the first and last values of the series', () => {
    expect(seriesEndpoints(monthsOf(4))).toEqual({ from: 1, to: 4 });
  });

  test('should read an empty series as zero at both ends', () => {
    expect(seriesEndpoints([])).toEqual({ from: 0, to: 0 });
  });
});
