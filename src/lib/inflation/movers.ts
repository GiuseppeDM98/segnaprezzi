/**
 * Top movers: the products whose observed price changed the
 * most over the last year, for the dashboard's "what moved" list.
 *
 * Why observed means only: imputed values would fabricate flat segments — a
 * carried-forward price is not evidence that the price held.
 */
import { addMonthsToYm } from './bucketing';
import type { IndexProduct, ObservedMeans, ProductMover } from './types';

/** How far back from a product's latest observation the comparison may reach. */
export const MOVERS_WINDOW_MONTHS = 12;
/** Risers and fallers are each capped at this many. */
export const MOVERS_PER_DIRECTION = 5;

/**
 * Rank the user's products by observed price change.
 *
 * Per product: `toYm` is its latest observed month; `fromYm` is its earliest
 * observed month within [toYm − 12 months, toYm) — exactly twelve months back
 * when that month is observed, otherwise the earliest observation inside the
 * window. Products with fewer than two observed months, with no observation
 * inside the window, or with pct === 0 (nothing moved) are excluded.
 *
 * Returns up to 5 risers and up to 5 fallers as one array sorted by pct
 * descending; ties break on productId so the order is deterministic.
 */
export function computeMovers(
  observedMeans: ObservedMeans,
  products: readonly IndexProduct[],
): ProductMover[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  const candidates: ProductMover[] = [];

  for (const productId of [...observedMeans.keys()].sort()) {
    const monthMeans = observedMeans.get(productId);
    const product = productById.get(productId);
    // A product missing from the projection violates the engine's
    // precondition; dropping it from a display list beats throwing.
    if (!monthMeans || !product || monthMeans.size < 2) {
      continue;
    }

    const months = [...monthMeans.keys()].sort();
    const toYm = months[months.length - 1];
    const windowStartYm = addMonthsToYm(toYm, -MOVERS_WINDOW_MONTHS);
    const fromYm = months.find((ym) => ym >= windowStartYm && ym < toYm);
    if (fromYm === undefined) {
      continue;
    }

    const fromMilli = monthMeans.get(fromYm) ?? 0;
    const toMilli = monthMeans.get(toYm) ?? 0;
    const pct = (toMilli / fromMilli - 1) * 100;
    if (pct === 0) {
      continue;
    }

    candidates.push({
      productId,
      name: product.name,
      category: product.category,
      fromYm,
      toYm,
      fromMilli,
      toMilli,
      pct,
    });
  }

  // Why no explicit tie-breaker: candidates were collected in sorted
  // productId order and Array.prototype.sort is stable, so products with
  // the same pct keep that order — deterministic without a second key.
  const byPctDescending = (a: ProductMover, b: ProductMover) => b.pct - a.pct;
  const byPctAscending = (a: ProductMover, b: ProductMover) => a.pct - b.pct;
  const risers = candidates
    .filter((mover) => mover.pct > 0)
    .sort(byPctDescending)
    .slice(0, MOVERS_PER_DIRECTION);
  const fallers = candidates
    .filter((mover) => mover.pct < 0)
    .sort(byPctAscending)
    .slice(0, MOVERS_PER_DIRECTION);

  return [...risers, ...fallers].sort(byPctDescending);
}
