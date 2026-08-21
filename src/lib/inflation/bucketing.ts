/**
 * Steps 1 and 2 of the engine (Spec 04 §4.1–§4.2): Europe/Rome month
 * bucketing, 'YYYY-MM' arithmetic, the month grid, per-product monthly
 * means, and carry-forward imputation.
 *
 * Design: the only place the engine touches a Date is toRomeYearMonth. From
 * there on, months are 'YYYY-MM' strings handled with integer arithmetic —
 * no timezone or DST reasoning of our own anywhere else.
 */
import type { BucketedEntry, IndexEntry, MonthlyPrice, ObservedMeans, PriceTable } from './types';

// Why 'en-CA': it is the one widely-supported locale whose formatted date
// parts come out ISO-like ('2026-04'), so no manual part reassembly and no
// DST/offset arithmetic of our own — the Intl database owns the timezone
// rules, including Italy's DST switches.
// Why module-level: constructing an Intl.DateTimeFormat is orders of
// magnitude more expensive than calling .format(); the engine formats one
// timestamp per entry on every recomputation.
const romeYearMonthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
});

/**
 * Map an epoch-milliseconds UTC timestamp to the 'YYYY-MM' calendar month
 * it falls in for the Europe/Rome timezone.
 *
 * A scan at 00:30 on 1 April in Milan is 22:30 on 31 March UTC — bucketing
 * in UTC would file it under the wrong month and shift a whole shopping trip
 * across a month-over-month boundary.
 *
 * Examples (2026 DST starts 29 March, so Rome is UTC+2 in late March):
 *   toRomeYearMonth(Date.parse('2026-03-31T22:30:00Z')) === '2026-04'
 *   toRomeYearMonth(Date.parse('2026-01-31T23:30:00Z')) === '2026-02'
 */
export function toRomeYearMonth(ms: number): string {
  return romeYearMonthFormatter.format(new Date(ms));
}

/** Shift a 'YYYY-MM' key by a (possibly negative) number of months. */
export function addMonthsToYm(ym: string, delta: number): string {
  const [year, month] = ym.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(totalMonths / 12);
  const shiftedMonth = (totalMonths % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

/** Signed number of months from `fromYm` to `toYm` ('2026-01' → '2026-04' = 3). */
export function countMonthsBetween(fromYm: string, toYm: string): number {
  const [fromYear, fromMonth] = fromYm.split('-').map(Number);
  const [toYear, toMonth] = toYm.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/**
 * Every calendar month from `firstYm` to `lastYm` inclusive — empty months
 * in between are part of the grid (carry-forward may fill them; if not,
 * the index carries flat there).
 *
 * Why the grid never extends to "today": the engine is pure and must not
 * consult the wall clock, so the series ends at the last month with data.
 * This also makes every test deterministic.
 */
export function buildMonthGrid(firstYm: string, lastYm: string): string[] {
  const grid: string[] = [];
  for (let ym = firstYm; ym <= lastYm; ym = addMonthsToYm(ym, 1)) {
    grid.push(ym);
  }
  return grid;
}

/**
 * Label every entry with its Europe/Rome month, once — both the monthly means
 * and the expenditure weights bucket by the same key.
 */
export function bucketEntries(entries: readonly IndexEntry[]): BucketedEntry[] {
  return entries.map((entry) => ({ ...entry, ym: toRomeYearMonth(entry.recordedAt) }));
}

/**
 * Running integer sum and count. Why not a running mean: integer sums are
 * exact in doubles, so the entry order cannot change the result by a single
 * bit — a requirement of the engine's determinism rule (Spec 04 §2).
 */
interface Accumulator {
  sum: number;
  count: number;
}

/**
 * Per-product, per-month arithmetic mean of unitPriceMilli (Spec 04 §4.1).
 *
 * Duplicate observations in a month — two stores, a re-scan, entries moved in
 * by a product merge — simply average.
 *
 * Promo rule: with includePromosInIndex false, promo entries are dropped from
 * the mean — but if that leaves the product-month empty while promo entries
 * exist, the promo entries are used instead. Why: a promo price is still a
 * real price the user saw; treating a promo-only month as "no data" would
 * silently shrink the matched set and bias the index toward products that
 * never go on promotion. The setting means "prefer regular prices", not
 * "pretend promos never happened". A promo-only month is an observation,
 * never an imputation, so coverage is unaffected.
 */
export function computeObservedMeans(
  entries: readonly BucketedEntry[],
  includePromosInIndex: boolean,
): ObservedMeans {
  // Guide: accumulate the entries that enter the mean and the promo
  // fallback separately, per product-month.
  const preferred = new Map<string, Map<string, Accumulator>>();
  const fallback = new Map<string, Map<string, Accumulator>>();
  for (const entry of entries) {
    const ym = entry.ym;
    const bucket = entry.isPromo && !includePromosInIndex ? fallback : preferred;
    const byMonth = getOrCreate(bucket, entry.productId, () => new Map<string, Accumulator>());
    const accumulator = getOrCreate(byMonth, ym, () => ({ sum: 0, count: 0 }));
    accumulator.sum += entry.unitPriceMilli;
    accumulator.count += 1;
  }

  // Guide: resolve each product-month — preferred entries win, the promo
  // fallback only fills months that would otherwise be empty.
  const means: ObservedMeans = new Map();
  for (const productId of new Set([...preferred.keys(), ...fallback.keys()])) {
    const monthMeans = new Map<string, number>();
    for (const [ym, accumulator] of preferred.get(productId) ?? []) {
      monthMeans.set(ym, accumulator.sum / accumulator.count);
    }
    for (const [ym, accumulator] of fallback.get(productId) ?? []) {
      if (!monthMeans.has(ym)) {
        monthMeans.set(ym, accumulator.sum / accumulator.count);
      }
    }
    means.set(productId, monthMeans);
  }
  return means;
}

/**
 * Carry-forward imputation (Spec 04 §4.2): fill each product's empty grid
 * months with its most recent observed mean, as long as that observation is
 * at most `carryForwardMonths` calendar months old. The window is anchored
 * on the observation month — with carryForwardMonths = 2 an observation in
 * March can fill April and May but not June. 0 disables imputation; the
 * engine never backcasts.
 *
 * Imputed values participate fully in the matched set: if pasta is observed
 * in April and imputed in May, the May relative is 1.0 and a June
 * observation produces a June relative from the imputed May base. Because
 * the carried value equals the April observation, chaining across the gap
 * reproduces exactly the April→June change (1.0 × p(Jun)/p(Apr)) — no price
 * movement is lost, only delayed.
 *
 * Teacher note — known bias: carry-forward relatives of 1.0 drag the Jevons
 * mean toward "no change", damping measured inflation while a product is
 * imputed. That is the standard, accepted cost of carry-forward imputation
 * (statistical offices pay it too); it is bounded by carryForwardMonths and
 * made visible through coverage.imputedShare.
 */
export function imputeCarryForward(
  observedMeans: ObservedMeans,
  monthGrid: readonly string[],
  carryForwardMonths: number,
): PriceTable {
  const table: PriceTable = new Map();
  for (const [productId, monthMeans] of observedMeans) {
    const prices = new Map<string, MonthlyPrice>();
    let lastObservedYm: string | null = null;
    let lastObservedValue = 0;
    // The grid is contiguous and ascending, so the last observation seen
    // while walking it is always the most recent one.
    for (const ym of monthGrid) {
      const observed = monthMeans.get(ym);
      if (observed !== undefined) {
        prices.set(ym, { value: observed, isImputed: false });
        lastObservedYm = ym;
        lastObservedValue = observed;
      } else if (
        lastObservedYm !== null &&
        countMonthsBetween(lastObservedYm, ym) <= carryForwardMonths
      ) {
        prices.set(ym, { value: lastObservedValue, isImputed: true });
      }
    }
    table.set(productId, prices);
  }
  return table;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = create();
  map.set(key, created);
  return created;
}
