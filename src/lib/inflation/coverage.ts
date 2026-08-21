/**
 * Coverage statistics.
 *
 * Design — honesty as a requirement: a national index averages millions of
 * quotes; a personal one may hang on five products. Every result therefore
 * carries coverage statistics (products compared, categories covered,
 * imputed share, flags for months with no overlap and clamped outliers) and
 * the UI is contractually required to surface them. A headline number
 * computed from two products must LOOK thin.
 */
import type { Coverage, MonthLink } from './types';

export interface CoverageInput {
  /** The (latest−1, latest) link, or null when the series has a single month. */
  latestLink: MonthLink | null;
  entryCount: number;
  monthsWithoutOverlap: string[];
  outliersClamped: number;
}

/**
 * Describe the latest month-over-month link and the whole-series flags.
 *
 * `imputedShare` is the imputed fraction of the 2·n product-month prices
 * entering the latest link — each relative consumes two prices (the month
 * before and the month itself), either of which may be a carry-forward.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const relatives = input.latestLink?.relatives ?? [];
  const productsCompared = relatives.length;
  const categoriesCovered = new Set(relatives.map((relative) => relative.category)).size;

  let imputedPrices = 0;
  for (const relative of relatives) {
    if (relative.isFromImputed) {
      imputedPrices += 1;
    }
    if (relative.isToImputed) {
      imputedPrices += 1;
    }
  }

  return {
    productsCompared,
    categoriesCovered,
    imputedShare: productsCompared === 0 ? 0 : imputedPrices / (2 * productsCompared),
    entryCount: input.entryCount,
    monthsWithoutOverlap: input.monthsWithoutOverlap,
    outliersClamped: input.outliersClamped,
  };
}

/** The all-zero coverage returned for an empty input. */
export function emptyCoverage(): Coverage {
  return {
    productsCompared: 0,
    categoriesCovered: 0,
    imputedShare: 0,
    entryCount: 0,
    monthsWithoutOverlap: [],
    outliersClamped: 0,
  };
}
