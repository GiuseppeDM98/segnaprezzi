/**
 * Top movers: the products whose observed price changed the
 * most over the last year, for the dashboard's "what moved" list.
 *
 * Why observed means only: imputed values would fabricate flat segments — a
 * carried-forward price is not evidence that the price held.
 *
 * Why the same stores on both sides: "what moved" must not list bananas at +20%
 * because they were bought at a dearer store this time. It also keeps the list
 * in step with the index, which compares each store with itself.
 */
import { addMonthsToYm, NO_STORE_KEY } from './bucketing';
import type { IndexProduct, ObservedMeans, ObservedStoreMeans, ProductMover } from './types';

/** How far back from a product's latest observation the comparison may reach. */
export const MOVERS_WINDOW_MONTHS = 12;
/** Risers and fallers are each capped at this many. */
export const MOVERS_PER_DIRECTION = 5;

/** Where a product's change is measured: two months and the stores seen in both. */
interface StoreComparison {
  fromYm: string;
  toYm: string;
  fromMilli: number;
  toMilli: number;
  storeKeys: string[];
}

/**
 * Pick one product's comparison: `toYm` is its latest observed month, `fromYm`
 * the earliest observed month within [toYm − MOVERS_WINDOW_MONTHS, toYm) that
 * shares a store with it, and both prices are means over the shared stores.
 * Null when no such month exists.
 */
function findStoreComparison(storeMeans: ObservedMeans): StoreComparison | null {
  const months = [
    ...new Set([...storeMeans.values()].flatMap((means) => [...means.keys()])),
  ].sort();
  const toYm = months[months.length - 1];
  const windowStartYm = addMonthsToYm(toYm, -MOVERS_WINDOW_MONTHS);
  const sortedStores = [...storeMeans].sort(([a], [b]) => (a < b ? -1 : 1));

  for (const fromYm of months) {
    if (fromYm < windowStartYm || fromYm >= toYm) {
      continue;
    }
    const storeKeys: string[] = [];
    let fromSum = 0;
    let toSum = 0;
    for (const [storeKey, means] of sortedStores) {
      const from = means.get(fromYm);
      const to = means.get(toYm);
      if (from !== undefined && to !== undefined) {
        storeKeys.push(storeKey);
        fromSum += from;
        toSum += to;
      }
    }
    if (storeKeys.length > 0) {
      return {
        fromYm,
        toYm,
        fromMilli: fromSum / storeKeys.length,
        toMilli: toSum / storeKeys.length,
        storeKeys,
      };
    }
  }
  return null;
}

/**
 * Rank the user's products by observed price change on the same stores (see
 * findStoreComparison). Products with no comparable month pair, or with
 * pct === 0 (nothing moved), are excluded.
 *
 * Returns up to MOVERS_PER_DIRECTION risers and as many fallers, as one array
 * sorted by pct descending; ties break on productId so the order is
 * deterministic.
 */
export function computeMovers(
  observedStoreMeans: ObservedStoreMeans,
  products: readonly IndexProduct[],
): ProductMover[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  const candidates: ProductMover[] = [];

  const sortedProducts = [...observedStoreMeans].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [productId, storeMeans] of sortedProducts) {
    const product = productById.get(productId);
    // A product missing from the projection violates the engine's
    // precondition; dropping it from a display list beats throwing.
    const comparison = product ? findStoreComparison(storeMeans) : null;
    if (!product || !comparison) {
      continue;
    }

    const { fromYm, toYm, fromMilli, toMilli, storeKeys } = comparison;
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
      storeIds: storeKeys.map((storeKey) => (storeKey === NO_STORE_KEY ? null : storeKey)),
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
