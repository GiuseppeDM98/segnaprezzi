/**
 * The catalog search behind a review screen's match sheet, and the memory of
 * what it found.
 *
 * Design: a pick made from search names a product that is not among the
 * card's suggestions, so the screen has to remember the hits to show the
 * picked product's name. The scan review and the receipt review each carried
 * their own copy of "call searchProducts, map the hits, remember them"; this
 * is the one copy. The Server Action arrives as a parameter because
 * components never import actions (AGENTS.md §1.5).
 */
import { useCallback, useState } from 'react';

import type { MatchOption } from './match-picker';

/** The part of the searchProducts Server Action's contract this hook relies on. */
export type SearchProductsAction = (input: {
  query: string;
}) => Promise<
  | { ok: true; data: { id: string; name: string; brand: string | null }[] }
  | { ok: false; error: { code: string } }
>;

/**
 * Search the catalog for the match sheet and remember every hit.
 *
 * A failed search throws rather than resolving to an empty list: MatchPicker
 * tells a failed search apart from one that found nothing.
 *
 * @param searchProductsAction - The searchProducts Server Action
 * @returns `searchProducts`, the MatchPicker `onSearch` callback (stable
 *   across renders), and `searchHits`, every product any search returned so
 *   far, by id (the same Map for the screen's whole life)
 */
export function useProductSearch(searchProductsAction: SearchProductsAction): {
  searchProducts: (query: string) => Promise<MatchOption[]>;
  searchHits: ReadonlyMap<string, MatchOption>;
} {
  const [searchHits] = useState(() => new Map<string, MatchOption>());

  const searchProducts = useCallback(
    async (query: string): Promise<MatchOption[]> => {
      const result = await searchProductsAction({ query });
      if (!result.ok) {
        throw new Error(`searchProducts failed: ${result.error.code}`);
      }
      const hits = result.data.map((hit) => ({
        productId: hit.id,
        name: hit.name,
        brand: hit.brand,
      }));
      for (const hit of hits) {
        searchHits.set(hit.productId, hit);
      }
      return hits;
    },
    [searchProductsAction, searchHits],
  );

  return { searchProducts, searchHits };
}
