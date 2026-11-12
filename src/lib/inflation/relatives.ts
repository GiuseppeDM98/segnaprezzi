/**
 * Matched-model month-over-month price relatives with the outlier clamp.
 *
 * Teacher: why relatives at all — you cannot average €2.28/kg pasta with
 * €1.69/L diesel; the units differ and a mean of raw prices is dominated by
 * whichever product happens to be expensive. A price relative divides this
 * month's price of a product by last month's price of the SAME product: it
 * is dimensionless (1.05 = "up 5%"), so relatives of pasta and diesel can be
 * combined.
 *
 * Teacher: why matched-model — a relative only measures pure price change if
 * it compares the same product with itself. Comparing "the average price of
 * everything bought in April" with "everything bought in March" would
 * register massive fake inflation for a user who bought steak in April and
 * lentils in March. So each month-over-month link uses only the products
 * priced (observed or imputed) in BOTH months — the matched set. This is
 * the matched-model principle used by every statistical office.
 *
 * Design: a product is one thing wherever it is bought. Its price in a month
 * is the mean of everything observed that month (bucketing.ts), and the
 * relative divides one month's price by the previous month's. The owner's
 * call of 2026-11-12: the index is the inflation of what this person pays, so
 * buying the same bananas at a dearer shop this month is part of it. Until
 * that date each shop was compared with itself.
 *
 * The accepted cost: a month bought at a dearer shop reads as a rise and the
 * next month at the cheaper one as a fall. Chaining gives it back — a
 * product's links multiply to latest price / first price whatever happened in
 * between — so where one shops adds noise to a month, never drift to the level.
 */
import type { CategoryId } from '@/lib/domain/categories';
import type { MonthLink, PriceTable, ProductRelative } from './types';

/**
 * Outlier bounds for a single month-over-month relative.
 *
 * Why clamp at all: a genuine month-over-month grocery or fuel move virtually
 * never exceeds ×5 or ÷5; moves that large are almost always data errors — a
 * €/100 g tag normalized as €/kg (×10), a wrong pack size, a bad product
 * match.
 * Why clamp rather than drop: clamping keeps the matched set stable,
 * preserves the direction of the move, and bounds the damage of one bad
 * photo to at most a factor 5 on one product for one month. Real spikes
 * survive — vegetables doubling after a frost (2.0) or a fuel shock pass
 * untouched.
 */
export const RELATIVE_CLAMP_MIN = 0.2;
export const RELATIVE_CLAMP_MAX = 5;

/** Clamp one relative into [RELATIVE_CLAMP_MIN, RELATIVE_CLAMP_MAX], reporting whether it was touched. */
export function clampRelative(relative: number): { value: number; wasClamped: boolean } {
  if (relative > RELATIVE_CLAMP_MAX) {
    return { value: RELATIVE_CLAMP_MAX, wasClamped: true };
  }
  if (relative < RELATIVE_CLAMP_MIN) {
    return { value: RELATIVE_CLAMP_MIN, wasClamped: true };
  }
  return { value: relative, wasClamped: false };
}

/**
 * Jevons index: the unweighted geometric mean of price relatives,
 * exp(mean(ln r)).
 *
 * Teacher: we have no quantity data per product-month pair that we can trust
 * (a user may photograph a tag without buying three packs), so the relatives
 * are combined unweighted, inside a category and across the whole basket — exactly ISTAT's situation inside
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
 * Computed in log space: the caller passes relatives in sorted key order, so
 * the floating-point sum is bit-identical for any input order.
 */
export function computeJevons(relatives: readonly number[]): number {
  let sumOfLogs = 0;
  for (const relative of relatives) {
    sumOfLogs += Math.log(relative);
  }
  return Math.exp(sumOfLogs / relatives.length);
}

/**
 * The matched set of one consecutive month pair: one clamped relative per
 * product priced in both `fromYm` and `toYm`.
 *
 * Relatives come out sorted by productId. Why: the geometric mean computed
 * downstream is mathematically order-independent, but floating-point
 * addition is not associative — sorting keeps every result bit-stable
 * regardless of the order entries arrived in — the engine's determinism rule.
 */
export function computeMonthLink(
  priceTable: PriceTable,
  categoryByProduct: ReadonlyMap<string, CategoryId>,
  fromYm: string,
  toYm: string,
): MonthLink {
  const relatives: ProductRelative[] = [];
  let clampedCount = 0;
  const productIds = [...priceTable.keys()].sort();
  for (const productId of productIds) {
    const prices = priceTable.get(productId);
    const from = prices?.get(fromYm);
    const to = prices?.get(toYm);
    const category = categoryByProduct.get(productId);
    if (!from || !to || !category) {
      continue;
    }
    const { value, wasClamped } = clampRelative(to.value / from.value);
    if (wasClamped) {
      clampedCount += 1;
    }
    relatives.push({
      productId,
      category,
      relative: value,
      isFromImputed: from.isImputed,
      isToImputed: to.isImputed,
    });
  }
  return { fromYm, toYm, relatives, clampedCount };
}
