/**
 * Jevons aggregation within categories, expenditure-weighted aggregation
 * across them, chaining, and the computePersonalCpi orchestrator — the
 * engine's single entry point.
 *
 * Design: matched-model Jevons within categories, expenditure-weighted
 * across them, chained month over month — the same structure as ISTAT's NIC
 * (elementary aggregates → weighted upper-level aggregation → annual
 * chaining), at monthly granularity and on a single person's basket.
 *
 * Teacher: why chained — a fixed-base index (compare every month directly to
 * month 1) dies the moment the basket changes, and a personal basket changes
 * constantly: products get discontinued, the user discovers new ones.
 * Chaining multiplies month-over-month links, I(m) = I(m−1) × R(m). Each
 * link uses whatever matched set exists for THAT pair of months, so products
 * can enter and leave the basket freely without breaking the series.
 */
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import {
  bucketEntries,
  buildMonthGrid,
  computeObservedMeans,
  imputeCarryForward,
} from './bucketing';
import { computeCoverage, emptyCoverage } from './coverage';
import { computeMovers } from './movers';
import { computeMonthLink } from './relatives';
import type {
  BucketedEntry,
  CategorySeries,
  IndexEntry,
  IndexProduct,
  IndexSettings,
  MonthLink,
  MonthPoint,
  PersonalCpiResult,
} from './types';
import {
  computeCategoryWeights,
  computeMonthlyExpenditure,
  computeTrailingExpenditure,
} from './weights';

/** Level of every chained series at its base month. */
export const BASE_INDEX = 100;
/** Lag, in series points, between a month and its year-over-year reference. */
const YOY_LAG_MONTHS = 12;

/**
 * Jevons index: the unweighted geometric mean of price relatives,
 * exp(mean(ln r)).
 *
 * Teacher: inside a category we have no quantity data per product-month pair
 * that we can trust (a user may photograph a tag without buying three packs),
 * so the relatives are combined unweighted — exactly ISTAT's situation inside
 * its elementary aggregates, and ISTAT's answer is the same: the Jevons index.
 * The obvious alternative, the arithmetic mean of relatives (Carli index),
 * has a systematic upward bias because it fails the time-reversal test:
 * a price that doubles then halves (relatives 2.0, then 0.5) gives
 * Carli (2.0 + 0.5) / 2 = 1.25 — +25% though the price is back where it
 * started — while Jevons √(2.0 × 0.5) = 1.0, correct. The geometric mean
 * treats a +10% and a −10% move symmetrically and is transitive under
 * chaining; Carli's bias is why the EU banned it for HICP elementary
 * aggregates.
 *
 * Computed in log space: the caller passes relatives in sorted productId
 * order, so the floating-point sum is bit-identical for any input order.
 */
export function computeJevons(relatives: readonly number[]): number {
  let sumOfLogs = 0;
  for (const relative of relatives) {
    sumOfLogs += Math.log(relative);
  }
  return Math.exp(sumOfLogs / relatives.length);
}

/**
 * R_c(m) for every category with at least one matched product in the link.
 * A category with a single matched product has R_c equal to that product's
 * clamped relative.
 */
export function computeCategoryRelatives(link: MonthLink): Map<CategoryId, number> {
  // link.relatives is already sorted by productId, so each category's list
  // inherits that order.
  const relativesByCategory = new Map<CategoryId, number[]>();
  for (const { category, relative } of link.relatives) {
    const relatives = relativesByCategory.get(category);
    if (relatives) {
      relatives.push(relative);
    } else {
      relativesByCategory.set(category, [relative]);
    }
  }

  const categoryRelatives = new Map<CategoryId, number>();
  const sortedByCategory = [...relativesByCategory].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [category, relatives] of sortedByCategory) {
    categoryRelatives.set(category, computeJevons(relatives));
  }
  return categoryRelatives;
}

/**
 * Chain monthly relatives into an index series: base 100 at `months[0]`,
 * then I(m) = I(m−1) × R(m) with momPct = (R(m) − 1) × 100. A month with no
 * relative carries flat (R = 1): with no matched product there is no
 * evidence of price change either way. yoyPct = (I(m) / I(m−12) − 1) × 100
 * once the series contains m−12 (from the 13th point), else null.
 */
export function chainSeries(
  months: readonly string[],
  relativeByYm: ReadonlyMap<string, number>,
): MonthPoint[] {
  const series: MonthPoint[] = [];
  for (const [position, ym] of months.entries()) {
    const relative = position === 0 ? 1 : (relativeByYm.get(ym) ?? 1);
    const index = position === 0 ? BASE_INDEX : series[position - 1].index * relative;
    const yearAgo = position >= YOY_LAG_MONTHS ? series[position - YOY_LAG_MONTHS] : undefined;
    series.push({
      ym,
      index,
      momPct: position === 0 ? 0 : (relative - 1) * 100,
      yoyPct: yearAgo ? (index / yearAgo.index - 1) * 100 : null,
    });
  }
  return series;
}

/**
 * Compute the personal CPI from a user's full entry history.
 *
 * Preconditions (enforced by the caller at the boundary): every
 * entry.productId exists in `products`; unitPriceMilli > 0;
 * totalPriceCents >= 0; carryForwardMonths is an integer >= 0.
 * Never throws on empty input — it returns an empty series and a null
 * headline.
 *
 * All arithmetic on relatives, means, weights and index levels uses floats —
 * these are ratios, not money. Nothing is rounded here; the
 * display layer rounds.
 */
export function computePersonalCpi(input: {
  entries: IndexEntry[];
  products: IndexProduct[];
  settings: IndexSettings;
}): PersonalCpiResult {
  const { entries, products, settings } = input;
  if (entries.length === 0) {
    return { series: [], headline: null, categories: [], coverage: emptyCoverage(), movers: [] };
  }

  // Guide: bucket entries per product per Rome month, then impute gaps up to
  // carryForwardMonths.
  const bucketedEntries = bucketEntries(entries);
  const monthKeys = bucketedEntries.map((entry) => entry.ym).sort();
  const monthGrid = buildMonthGrid(monthKeys[0], monthKeys[monthKeys.length - 1]);
  const observedMeans = computeObservedMeans(bucketedEntries, settings.includePromosInIndex);
  const priceTable = imputeCarryForward(observedMeans, monthGrid, settings.carryForwardMonths);
  const categoryByProduct = new Map(entries.map((entry) => [entry.productId, entry.category]));
  const monthlyExpenditure = computeMonthlyExpenditure(bucketedEntries);

  // Guide: one link per consecutive month pair — matched relatives, Jevons
  // per category, expenditure weights, overall relative.
  const overallRelativeByYm = new Map<string, number>();
  const categoryRelativesByYm = new Map<string, Map<CategoryId, number>>();
  const monthsWithoutOverlap: string[] = [];
  let outliersClamped = 0;
  let latestLink: MonthLink | null = null;

  for (let position = 1; position < monthGrid.length; position += 1) {
    const link = computeMonthLink(
      priceTable,
      categoryByProduct,
      monthGrid[position - 1],
      monthGrid[position],
    );
    latestLink = link;
    outliersClamped += link.clampedCount;

    const categoryRelatives = computeCategoryRelatives(link);
    categoryRelativesByYm.set(link.toYm, categoryRelatives);
    if (categoryRelatives.size === 0) {
      monthsWithoutOverlap.push(link.toYm);
      continue;
    }

    // R(m) = Σ w_c(m) · R_c(m): the arithmetic weighted mean of category
    // relatives — the Laspeyres-style aggregation across categories.
    const weights = computeCategoryWeights(
      computeTrailingExpenditure(monthlyExpenditure, link.toYm),
      categoryRelatives.keys(),
    );
    let overallRelative = 0;
    for (const [category, weight] of weights) {
      overallRelative += weight * (categoryRelatives.get(category) ?? 1);
    }
    overallRelativeByYm.set(link.toYm, overallRelative);
  }

  // Guide: chain the overall and the per-category series, then the
  // headline, coverage and movers.
  const series = chainSeries(monthGrid, overallRelativeByYm);
  const latest = series[series.length - 1];

  return {
    series,
    headline: {
      latestYm: latest.ym,
      momPct: latest.momPct,
      yoyPct: latest.yoyPct,
      sinceStartPct: latest.index - BASE_INDEX,
    },
    categories: buildCategorySeries(bucketedEntries, monthGrid, categoryRelativesByYm),
    coverage: computeCoverage({
      latestLink,
      entryCount: entries.length,
      monthsWithoutOverlap,
      outliersClamped,
    }),
    movers: computeMovers(observedMeans, products),
  };
}

/**
 * One chained series per category, in taxonomy order, each based at 100 on
 * the category's first grid month with any priced product. Months where the
 * category has no matched product carry flat. A category appearing
 * mid-history simply starts its series there — chaining is forward-only, so
 * earlier overall index values never change retroactively.
 *
 * Why the first observed month is the first priced month: imputation only
 * ever carries forward, so no product can be priced before its first
 * observation.
 */
function buildCategorySeries(
  bucketedEntries: readonly BucketedEntry[],
  monthGrid: readonly string[],
  categoryRelativesByYm: ReadonlyMap<string, ReadonlyMap<CategoryId, number>>,
): CategorySeries[] {
  const firstYmByCategory = new Map<CategoryId, string>();
  for (const entry of bucketedEntries) {
    const current = firstYmByCategory.get(entry.category);
    if (current === undefined || entry.ym < current) {
      firstYmByCategory.set(entry.category, entry.ym);
    }
  }

  const categorySeries: CategorySeries[] = [];
  for (const category of CATEGORY_IDS) {
    const firstYm = firstYmByCategory.get(category);
    if (firstYm === undefined) {
      continue;
    }
    const months = monthGrid.slice(monthGrid.indexOf(firstYm));
    const relativeByYm = new Map<string, number>();
    for (const ym of months) {
      const relative = categoryRelativesByYm.get(ym)?.get(category);
      if (relative !== undefined) {
        relativeByYm.set(ym, relative);
      }
    }
    categorySeries.push({ category, series: chainSeries(months, relativeByYm) });
  }
  return categorySeries;
}
