/**
 * Expenditure shares across categories.
 *
 * Teacher: why expenditure weights (Laspeyres-style) — across categories,
 * quantities DO matter: a 10% fuel rise hurts a commuter far more than a 10%
 * rise in shampoo. Each category's relative is weighted by the user's
 * expenditure share in that category. Weighting current price change by
 * (near-)past expenditure shares is the Laspeyres idea; ISTAT does it with
 * basket weights updated once a year. A single person's basket is far
 * noisier than a nation's, so we use a rolling 12-month window instead of a
 * fixed annual basket: it smooths seasonal spending (December pandoro,
 * August fuel) while still being "the basket you actually buy".
 */
import type { CategoryId } from '@/lib/domain/categories';
import { addMonthsToYm } from './bucketing';
import type { BucketedEntry } from './types';

/** Trailing window, in calendar months, over which expenditure is summed (m−11 … m). */
export const EXPENDITURE_WINDOW_MONTHS = 12;

/** 'YYYY-MM' → category → Σ totalPriceCents × quantity of that month. */
export type MonthlyExpenditure = Map<string, Map<CategoryId, number>>;

/**
 * Sum each month's expenditure per category.
 *
 * Promo entries ALWAYS count toward expenditure, regardless of
 * includePromosInIndex — expenditure is what was actually paid; the promo
 * setting only governs which price observations enter the means.
 * The spend of an observation is totalPriceCents × quantity: a receipt line
 * "2 × 1,29" was paid twice even though it is one price observation.
 */
export function computeMonthlyExpenditure(entries: readonly BucketedEntry[]): MonthlyExpenditure {
  const expenditure: MonthlyExpenditure = new Map();
  for (const entry of entries) {
    let byCategory = expenditure.get(entry.ym);
    if (!byCategory) {
      byCategory = new Map();
      expenditure.set(entry.ym, byCategory);
    }
    const spend = entry.totalPriceCents * entry.quantity;
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + spend);
  }
  return expenditure;
}

/**
 * E_c(m): expenditure per category over the trailing window m−11 … m.
 *
 * Months before the start of the grid simply have no entries, so the window
 * is truncated there without special handling.
 */
export function computeTrailingExpenditure(
  monthlyExpenditure: MonthlyExpenditure,
  ym: string,
): Map<CategoryId, number> {
  const trailing = new Map<CategoryId, number>();
  for (let offset = EXPENDITURE_WINDOW_MONTHS - 1; offset >= 0; offset -= 1) {
    const byCategory = monthlyExpenditure.get(addMonthsToYm(ym, -offset));
    if (!byCategory) {
      continue;
    }
    for (const [category, spend] of byCategory) {
      trailing.set(category, (trailing.get(category) ?? 0) + spend);
    }
  }
  return trailing;
}

/**
 * w_c(m): the expenditure share of each matched category, renormalized over
 * the categories present in this month's matched set so that the weight of
 * unmatched categories is redistributed proportionally (weights sum to 1).
 *
 * Defensive rule: if the matched categories have zero trailing expenditure
 * altogether (only reachable with carryForwardMonths > 11 carrying matches
 * beyond the expenditure window, or zero-priced entries), fall back to equal
 * weights 1/|C(m)| rather than dividing by zero.
 *
 * The result iterates in sorted category order so that the weighted sum
 * downstream is bit-stable regardless of input order.
 */
export function computeCategoryWeights(
  trailingExpenditure: ReadonlyMap<CategoryId, number>,
  matchedCategories: Iterable<CategoryId>,
): Map<CategoryId, number> {
  const categories = [...new Set(matchedCategories)].sort();
  const weights = new Map<CategoryId, number>();
  if (categories.length === 0) {
    return weights;
  }

  let total = 0;
  for (const category of categories) {
    total += trailingExpenditure.get(category) ?? 0;
  }

  for (const category of categories) {
    const share =
      total > 0 ? (trailingExpenditure.get(category) ?? 0) / total : 1 / categories.length;
    weights.set(category, share);
  }
  return weights;
}
