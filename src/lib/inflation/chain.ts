/**
 * Jevons aggregation over the matched products, per category and overall,
 * chaining, and the computePersonalCpi orchestrator — the engine's single
 * entry point.
 *
 * Design: matched-model relatives, Jevons within each category for the
 * category series and Jevons over every matched product for the overall
 * index, chained month over month. ISTAT's NIC weights its categories by
 * expenditure; this index does not, by the owner's decision of 2026-11-06:
 * it tracks the prices of the things one person keeps buying, and a fill-up
 * worth sixty euros must not outvote thirty tags worth two. Every compared
 * product is one vote, whatever it cost and however many were bought.
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
import { computeJevons, computeMonthLink } from './relatives';
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

/** Level of every chained series at its base month. */
export const BASE_INDEX = 100;
/** Lag, in series points, between a month and its year-over-year reference. */
const YOY_LAG_MONTHS = 12;

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
 * carryForwardMonths is an integer >= 0.
 * Never throws on empty input — it returns an empty series and a null
 * headline.
 *
 * All arithmetic on relatives, means and index levels uses floats —
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

  // Guide: one link per consecutive month pair — matched relatives, Jevons
  // per category, Jevons over every matched product for the overall relative.
  const overallRelativeByYm = new Map<string, number>();
  const categoryRelativesByYm = new Map<string, Map<CategoryId, number>>();
  const comparedMonthsByCategory = new Map<CategoryId, string[]>();
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
    recordComparedCategories(link, comparedMonthsByCategory);

    const categoryRelatives = computeCategoryRelatives(link);
    categoryRelativesByYm.set(link.toYm, categoryRelatives);
    if (categoryRelatives.size === 0) {
      monthsWithoutOverlap.push(link.toYm);
      continue;
    }

    // R(m): the Jevons of every matched product's relative, so a category
    // weighs as many products as it brings and no product weighs more than
    // another. link.relatives is sorted by productId (float determinism).
    overallRelativeByYm.set(
      link.toYm,
      computeJevons(link.relatives.map(({ relative }) => relative)),
    );
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
    categories: buildCategorySeries(
      bucketedEntries,
      monthGrid,
      categoryRelativesByYm,
      comparedMonthsByCategory,
    ),
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
 * Note the link's month under every category with a new price actually
 * compared in it: a carried-forward price is not one.
 */
function recordComparedCategories(
  link: MonthLink,
  comparedMonthsByCategory: Map<CategoryId, string[]>,
): void {
  const comparedCategories = new Set(
    link.relatives.filter((relative) => !relative.isToImputed).map(({ category }) => category),
  );
  for (const category of comparedCategories) {
    comparedMonthsByCategory.set(category, [
      ...(comparedMonthsByCategory.get(category) ?? []),
      link.toYm,
    ]);
  }
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
  comparedMonthsByCategory: ReadonlyMap<CategoryId, string[]>,
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
    categorySeries.push({
      category,
      series: chainSeries(months, relativeByYm),
      comparedMonths: comparedMonthsByCategory.get(category) ?? [],
    });
  }
  return categorySeries;
}
