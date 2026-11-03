/**
 * Coverage statistics.
 *
 * Design — honesty as a requirement: a national index averages millions of
 * quotes; a personal one may hang on five products. Every result therefore
 * carries coverage statistics (products compared, categories covered,
 * products without a price this month, flags for months with no overlap and clamped outliers) and
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
 * `productsWithoutLatestPrice` counts products, not prices. Why not a share of
 * the 2·n prices entering the link: every price of the month before is real in
 * a young series, so that share cannot pass 50%. A percentage just under 50 read as
 * about half while it meant 19 products out of 20 with no price this month.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const relatives = input.latestLink?.relatives ?? [];
  const productsCompared = relatives.length;
  const categoriesCovered = new Set(relatives.map((relative) => relative.category)).size;

  return {
    productsCompared,
    categoriesCovered,
    productsWithoutLatestPrice: relatives.filter((relative) => relative.isToImputed).length,
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
    productsWithoutLatestPrice: 0,
    entryCount: 0,
    monthsWithoutOverlap: [],
    outliersClamped: 0,
  };
}
