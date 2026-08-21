import { describe, expect, it } from 'vitest';

import { computeCoverage, emptyCoverage } from './coverage';
import type { MonthLink } from './types';

describe('computeCoverage', () => {
  it('should describe the latest link and carry the whole-series flags through', () => {
    // Arrange: three matched products in two categories; one of the six
    // prices entering the link is a carry-forward.
    const latestLink: MonthLink = {
      fromYm: '2026-05',
      toYm: '2026-06',
      clampedCount: 0,
      relatives: [
        {
          productId: 'diesel',
          category: 'fuel',
          relative: 1,
          isFromImputed: false,
          isToImputed: false,
        },
        {
          productId: 'oil',
          category: 'food',
          relative: 1,
          isFromImputed: false,
          isToImputed: false,
        },
        {
          productId: 'pasta',
          category: 'food',
          relative: 1,
          isFromImputed: true,
          isToImputed: false,
        },
      ],
    };

    // Act
    const coverage = computeCoverage({
      latestLink,
      entryCount: 13,
      monthsWithoutOverlap: ['2026-04'],
      outliersClamped: 2,
    });

    // Assert
    expect(coverage).toEqual({
      productsCompared: 3,
      categoriesCovered: 2,
      imputedShare: 1 / 6,
      entryCount: 13,
      monthsWithoutOverlap: ['2026-04'],
      outliersClamped: 2,
    });
  });

  it('should count both sides of a relative when both prices are imputed', () => {
    const latestLink: MonthLink = {
      fromYm: '2026-05',
      toYm: '2026-06',
      clampedCount: 0,
      relatives: [
        {
          productId: 'pasta',
          category: 'food',
          relative: 1,
          isFromImputed: true,
          isToImputed: true,
        },
      ],
    };

    const coverage = computeCoverage({
      latestLink,
      entryCount: 1,
      monthsWithoutOverlap: [],
      outliersClamped: 0,
    });

    expect(coverage.imputedShare).toBe(1);
  });

  it('should report zero products and a zero imputed share when there is no latest link', () => {
    const coverage = computeCoverage({
      latestLink: null,
      entryCount: 2,
      monthsWithoutOverlap: [],
      outliersClamped: 0,
    });

    expect(coverage).toEqual({
      productsCompared: 0,
      categoriesCovered: 0,
      imputedShare: 0,
      entryCount: 2,
      monthsWithoutOverlap: [],
      outliersClamped: 0,
    });
  });

  it('should return all zeros for an empty input', () => {
    expect(emptyCoverage()).toEqual({
      productsCompared: 0,
      categoriesCovered: 0,
      imputedShare: 0,
      entryCount: 0,
      monthsWithoutOverlap: [],
      outliersClamped: 0,
    });
  });
});
