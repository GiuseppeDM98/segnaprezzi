/**
 * The review screen's pure rules: how an extracted photo becomes an editable
 * draft, how an edit or a product pick changes it, what a draft still lacks,
 * and how a resolved draft becomes a confirm entry.
 *
 * Design: everything here computes from drafts and photos without touching
 * React, IndexedDB or the network, so the screen and its hook only decide
 * *when* to apply a rule and these functions decide *what* it produces. That
 * keeps the rules unit-testable in node and leaves the components with
 * wiring only.
 */
import type { BlockingReason, ExtractionCardMatch } from '@/components/capture/extraction-card';
import type { CategoryId } from '@/lib/domain/categories';
import type {
  ExtractionResult,
  ProductSuggestion,
  ReviewedExtraction,
  ReviewReason,
} from '@/lib/domain/extract-photo';
import { computeDerivedUnitPriceMilli } from '@/lib/domain/money';
import { PRESELECT_SCORE_THRESHOLD } from '@/lib/domain/receipt-lines';
import type { UnitKind } from '@/lib/domain/units';
import type { PendingPhoto } from '@/lib/offline/db';
import type { ConfirmShoppingSessionInput } from './schema';

export type SelectedProduct =
  | { kind: 'existing'; productId: string; name: string; brand: string | null }
  | { kind: 'new'; name: string; brand: string | null; category: CategoryId; unitKind: UnitKind };

export interface ReviewEntryDraft {
  /** = pendingPhotos.id = future price_entries.id */
  id: string;
  blobUrl: string;
  /** User-editable copy of extraction fields (name, prices, category, promo…). */
  fields: ExtractionResult;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  suggestions: ProductSuggestion[];
  /**
   * null until the user picks; preselected to suggestions[0] when its score
   * reaches PRESELECT_SCORE_THRESHOLD.
   */
  selectedProduct: SelectedProduct | null;
  /** Epoch ms; defaults to the moment the photo was taken. */
  recordedAt: number;
  /** The immutable AI payload, kept verbatim for ai_raw_json. */
  original: ReviewedExtraction;
  aiModel: string;
  /** True once the user typed a unit price: stops the auto-recompute. */
  isUnitPriceEdited: boolean;
}

/** A queued photo whose extraction has come back. */
export type ExtractedPhoto = PendingPhoto & {
  extraction: NonNullable<PendingPhoto['extraction']>;
};

/** What the match sheet needs to know about a product it may be asked to pick. */
export interface KnownProduct {
  name: string;
  brand: string | null;
}

/** The product a user chose in the match sheet: a catalog id, or "create new". */
export type ProductPick = { productId: string } | 'new';

/** Photos still travelling have no extraction to review yet. */
export function hasExtraction(photo: PendingPhoto): photo is ExtractedPhoto {
  return photo.extraction !== undefined;
}

/**
 * Build the editable draft for a freshly extracted photo.
 *
 * The top suggestion is preselected only when its score reaches
 * PRESELECT_SCORE_THRESHOLD; below it the card starts unresolved, so the
 * user has to choose.
 */
export function toDraft(photo: ExtractedPhoto): ReviewEntryDraft {
  const { extraction, suggestions, blobUrl, model } = photo.extraction;
  const { needsReview, reviewReasons, ...fields } = extraction;
  const topSuggestion = suggestions[0];

  return {
    id: photo.id,
    blobUrl,
    fields: { ...fields },
    needsReview,
    reviewReasons,
    suggestions,
    selectedProduct:
      topSuggestion && topSuggestion.score >= PRESELECT_SCORE_THRESHOLD
        ? {
            kind: 'existing',
            productId: topSuggestion.productId,
            name: topSuggestion.name,
            brand: topSuggestion.brand,
          }
        : null,
    recordedAt: photo.createdAt,
    original: extraction,
    aiModel: model,
    isUnitPriceEdited: false,
  };
}

/**
 * Apply a field edit to a draft. Editing the total or the size re-derives the
 * unit price, unless the user owns it: once they type a unit price
 * themselves, it is never overwritten again.
 */
export function applyFieldsPatch(
  draft: ReviewEntryDraft,
  patch: Partial<ExtractionResult>,
): ReviewEntryDraft {
  const fields = { ...draft.fields, ...patch };
  const isUnitPriceEdited = draft.isUnitPriceEdited || patch.unitPriceMilli !== undefined;
  const derivedUnitPriceMilli = computeDerivedUnitPriceMilli(
    fields.totalPriceCents,
    fields.packageSize,
    isUnitPriceEdited,
  );
  return {
    ...draft,
    fields:
      derivedUnitPriceMilli === null
        ? fields
        : { ...fields, unitPriceMilli: derivedUnitPriceMilli },
    isUnitPriceEdited,
  };
}

/**
 * Apply a match-sheet pick to a draft.
 *
 * @param searchHits products seen in earlier catalog searches, by id: a pick
 *   from search is not among the draft's suggestions, and this is where its
 *   name comes from. A pick found in neither falls back to the extracted name.
 */
export function applyProductPick(
  draft: ReviewEntryDraft,
  pick: ProductPick,
  searchHits: ReadonlyMap<string, KnownProduct>,
): ReviewEntryDraft {
  if (pick === 'new') {
    return { ...draft, selectedProduct: toNewProductPick(draft.fields) };
  }
  const known =
    draft.suggestions.find((s) => s.productId === pick.productId) ?? searchHits.get(pick.productId);
  return {
    ...draft,
    selectedProduct: {
      kind: 'existing',
      productId: pick.productId,
      name: known?.name ?? draft.fields.productName,
      brand: known?.brand ?? null,
    },
  };
}

/** The "create new" pick, prefilled from what the model read on the tag. */
export function toNewProductPick(fields: ExtractionResult): SelectedProduct {
  return {
    kind: 'new',
    name: fields.productName,
    brand: fields.brand,
    category: fields.category,
    unitKind: fields.unitKind,
  };
}

/** The match row's label for a card, or null while nothing is picked. */
export function toCardMatch(selected: SelectedProduct | null): ExtractionCardMatch | null {
  if (!selected) {
    return null;
  }
  return { kind: selected.kind, label: selected.name, brand: selected.brand };
}

/** A card is ready when blockingReasonOf() finds nothing left to fix. */
export function isDraftResolved(draft: ReviewEntryDraft): boolean {
  return blockingReasonOf(draft) === null;
}

/**
 * A card the "flagged" filter shows: the model asked for a review, or the
 * card is still missing something.
 */
export function isDraftFlagged(draft: ReviewEntryDraft): boolean {
  return draft.needsReview || !isDraftResolved(draft);
}

/**
 * Name what a card is still missing, in the order the user has to fix it:
 * the product first (only they can choose it), then its name and numbers.
 *
 * @returns null when the card is ready to be confirmed.
 */
export function blockingReasonOf(draft: ReviewEntryDraft): BlockingReason | null {
  if (draft.selectedProduct === null) {
    return 'product';
  }
  const hasEveryValue =
    draft.fields.productName.trim().length > 0 &&
    draft.fields.totalPriceCents > 0 &&
    draft.fields.packageSize > 0 &&
    draft.fields.unitPriceMilli > 0;
  return hasEveryValue ? null : 'values';
}

/** The counts and the total the header chip and the confirm bar show. */
export interface DraftsSummary {
  flaggedCount: number;
  incompleteCount: number;
  runningTotalCents: number;
}

/** Summarise the batch for the header filter chip and the confirm bar. */
export function summarizeDrafts(drafts: readonly ReviewEntryDraft[]): DraftsSummary {
  return {
    flaggedCount: drafts.filter(isDraftFlagged).length,
    incompleteCount: drafts.filter((draft) => !isDraftResolved(draft)).length,
    runningTotalCents: drafts.reduce((sum, draft) => sum + draft.fields.totalPriceCents, 0),
  };
}

/**
 * Turn a draft into the confirm action's entry.
 *
 * Precondition: the draft is resolved (isDraftResolved). A draft without a
 * pick would be sent as a new product named after the extraction.
 */
export function toConfirmEntry(
  draft: ReviewEntryDraft,
): ConfirmShoppingSessionInput['entries'][number] {
  const selected = draft.selectedProduct ?? toNewProductPick(draft.fields);
  return {
    id: draft.id,
    product:
      selected.kind === 'existing'
        ? { kind: 'existing', productId: selected.productId }
        : {
            kind: 'new',
            name: selected.name,
            brand: selected.brand,
            category: selected.category,
            unitKind: selected.unitKind,
          },
    recordedAt: draft.recordedAt,
    totalPriceCents: draft.fields.totalPriceCents,
    packageSize: draft.fields.packageSize,
    unitPriceMilli: draft.fields.unitPriceMilli,
    isPromo: draft.fields.isPromo,
    promoKind: draft.fields.promoKind,
    photoUrl: draft.blobUrl,
    // The ORIGINAL confidence, even after edits: it records how sure the model
    // was, not how sure the user is.
    aiConfidence: draft.original.confidence,
    aiModel: draft.aiModel,
    aiRawJson: JSON.stringify(draft.original),
  };
}
