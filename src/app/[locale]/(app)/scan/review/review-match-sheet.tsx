'use client';

/**
 * The review screen's product match sheet: the shared MatchPicker, fed from
 * the one draft whose match row was tapped.
 *
 * Design: this file only translates a draft into the picker's props. The
 * catalog search and the effect of a pick stay with the screen, which owns
 * the Server Action call and the drafts.
 */
import { type MatchOption, MatchPicker } from '@/components/capture/match-picker';
import type { ProductPick, ReviewEntryDraft } from './review-derivations';

export interface ReviewMatchSheetProps {
  /** The draft being matched. */
  draft: ReviewEntryDraft;
  isOpen: boolean;
  onClose: () => void;
  onPick: (pick: ProductPick) => void;
  /** Catalog search; rejects when the search itself failed. */
  onSearch: (query: string) => Promise<MatchOption[]>;
}

/** Open the match picker on one draft's suggestions and current pick. */
export function ReviewMatchSheet({
  draft,
  isOpen,
  onClose,
  onPick,
  onSearch,
}: ReviewMatchSheetProps) {
  return (
    <MatchPicker
      isOpen={isOpen}
      onClose={onClose}
      suggestions={draft.suggestions.map((suggestion) => ({
        productId: suggestion.productId,
        name: suggestion.name,
        brand: suggestion.brand,
        score: suggestion.score,
      }))}
      selectedProductId={
        draft.selectedProduct?.kind === 'existing' ? draft.selectedProduct.productId : null
      }
      isNewSelected={draft.selectedProduct?.kind === 'new'}
      newProductName={draft.fields.productName}
      onPick={onPick}
      onSearch={onSearch}
    />
  );
}
