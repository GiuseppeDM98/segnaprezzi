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
