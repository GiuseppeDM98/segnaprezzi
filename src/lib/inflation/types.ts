/**
 * Types of the personal inflation engine. No logic lives here.
 *
 * The public types are re-exported by the barrel (index.ts); the internal
 * ones at the bottom are shared between the sibling modules only.
 */
import type { CategoryId } from '@/lib/domain/categories';

/**
 * Minimal projection of a price entry needed by the engine.
 *
 * Deliberately NOT the Drizzle row type: the engine must not depend on the
 * persistence schema. `category` is denormalized from the product at
 * projection time (repository JOIN) so the engine never joins anything.
 *
 * This is the ONE definition of IndexEntry in the codebase. The repository's
 * `listEntriesForIndex` imports this type and returns exactly it — mapping
 * the DB `Date` to `recordedAt` epoch milliseconds.
 */
export interface IndexEntry {
  productId: string;
  category: CategoryId;
  /** Epoch milliseconds UTC. */
  recordedAt: number;
  /** Integer euro cents for ONE package, as paid/displayed. */
  totalPriceCents: number;
  /**
   * Packages bought in this observation (receipt "2 x 1,29" → 2; always 1
   * for photo/manual/fuel). Only expenditure weights use it — never the
   * price means.
   */
  quantity: number;
  /** Integer milli-euros per base unit (kg | L | piece). */
  unitPriceMilli: number;
  isPromo: boolean;
}

/** Minimal product projection — only what movers need for display. */
export interface IndexProduct {
  id: string;
  name: string;
  brand: string | null;
  category: CategoryId;
}

/** Mirrors the `user_settings` columns that affect the index. */
export interface IndexSettings {
  /** Default true. */
  includePromosInIndex: boolean;
  /** Default 2; 0 disables imputation. */
  carryForwardMonths: number;
}

/** One point of a chained series. All numbers are raw floats — round at display only. */
export interface MonthPoint {
  /** 'YYYY-MM' (Europe/Rome calendar month). */
  ym: string;
  /** Chained level, base month = 100. */
  index: number;
  /** Month-over-month %, 0 for the base month. */
  momPct: number;
  /** Year-over-year %; null until 13 months of series exist. */
  yoyPct: number | null;
}

export interface Headline {
  latestYm: string;
  momPct: number;
  yoyPct: number | null;
  /** index(latest) − 100. */
  sinceStartPct: number;
}

export interface CategorySeries {
  category: CategoryId;
  /** Own chained index, base 100 at the category's first month with a price. */
  series: MonthPoint[];
}

export interface Coverage {
  /** Size of the matched set in the latest month-over-month link. */
  productsCompared: number;
  /** Distinct categories in that matched set. */
  categoriesCovered: number;
  /**
   * Share of the 2·n product-month prices entering the latest link that were
   * carry-forward imputations rather than observations. Range 0..1.
   */
  imputedShare: number;
  /** Total number of input entries the computation saw. */
  entryCount: number;
  /** Months where no product matched and the index was carried flat. */
  monthsWithoutOverlap: string[];
  /** Total count of relatives clamped by the outlier guard across the whole series. */
  outliersClamped: number;
}

export interface ProductMover {
  productId: string;
  name: string;
  category: CategoryId;
  fromYm: string;
  toYm: string;
  /** Observed monthly mean, float (means of integers). */
  fromMilli: number;
  toMilli: number;
  /** (toMilli / fromMilli − 1) × 100. */
  pct: number;
}

export interface PersonalCpiResult {
  /** [] when there are no entries. */
  series: MonthPoint[];
  /** null when series is empty. */
  headline: Headline | null;
  categories: CategorySeries[];
  coverage: Coverage;
  /** Risers then fallers, sorted by pct descending. */
  movers: ProductMover[];
}

// ---------------------------------------------------------------------------
// Internal types — shared between the engine's modules, never exported by the
// barrel.
// ---------------------------------------------------------------------------

/** An entry labelled once with the Europe/Rome month it belongs to. */
export interface BucketedEntry extends IndexEntry {
  ym: string;
}

/** productId → 'YYYY-MM' → arithmetic mean of the observed unitPriceMilli. */
export type ObservedMeans = Map<string, Map<string, number>>;

/** One product's price in one grid month: an observed mean or a carry-forward. */
export interface MonthlyPrice {
  value: number;
  isImputed: boolean;
}

/** productId → 'YYYY-MM' → price, after carry-forward imputation. */
export type PriceTable = Map<string, Map<string, MonthlyPrice>>;

/** One matched-model relative of one product across one month pair. */
export interface ProductRelative {
  productId: string;
  category: CategoryId;
  /** Already clamped to the outlier bounds. */
  relative: number;
  /** Whether the price on either side of the link was a carry-forward. */
  isFromImputed: boolean;
  isToImputed: boolean;
}

/** The matched set of one consecutive month pair (fromYm → toYm). */
export interface MonthLink {
  fromYm: string;
  toYm: string;
  /** Sorted by productId for float determinism. */
  relatives: ProductRelative[];
  /** How many relatives of this link hit the outlier clamp. */
  clampedCount: number;
}
