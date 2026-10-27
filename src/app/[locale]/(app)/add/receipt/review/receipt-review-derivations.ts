/**
 * The receipt review's pure rules: how a server-resolved line becomes an
 * editable draft, how each correction changes it, what it still lacks, how
 * the edited lines reconcile with the printed total, and how a draft becomes
 * a confirm line.
 *
 * Design: everything here computes from drafts without touching React or the
 * network. The screen decides *when* a correction happens; these functions
 * decide *what* it produces, so the arithmetic the user leans on (the
 * difference to the printed total, the "which line to check" hint) is
 * unit-tested rather than trusted to a render. The per-line status and
 * blocking rules themselves live in src/lib/domain/receipt-lines.ts; this
 * module only adapts a draft to them.
 */
import type { MatchOption } from '@/components/capture/match-picker';
import type { ReceiptLineCardFields } from '@/components/receipt/receipt-line-card';
import type { CategoryId } from '@/lib/domain/categories';
import { calculateUnitPriceMilli, computeDerivedUnitPriceMilli } from '@/lib/domain/money';
import {
  computeReceiptLineStatus,
  getReceiptLineBlockingReason,
  type ReceiptLineBlockingReason,
  type ReceiptLineCheck,
  type ReceiptLineStatus,
  suggestExtraPackages,
} from '@/lib/domain/receipt-lines';
import { RECEIPT_TOTAL_TOLERANCE_CENTS } from '@/lib/domain/receipts';
import type { ReceiptReview } from '@/lib/services/import-receipt';
import type { ConfirmReceiptActionInput } from './schema';

export interface LineDraft {
  index: number;
  rawLine: string;
  /** How many identical receipt lines this card stands for; 1 when it is alone. */
  mergedLineCount: number;
  reviewReasons: ReceiptReview['lines'][number]['reviewReasons'];
  suggestions: MatchOption[];
  product: LineProduct;
  fields: ReceiptLineCardFields;
  category: CategoryId;
  /**
   * The matcher found candidates but none convincing: the user must pick or
   * accept "new" before this line can be confirmed.
   */
  needsProductDecision: boolean;
  isExcluded: boolean;
  shouldLearnAlias: boolean;
  /** True once the user typed a unit price: stops the auto-recompute. */
  isUnitPriceEdited: boolean;
}

export type LineProduct =
  | {
      kind: 'existing';
      productId: string;
      label: string;
      brand: string | null;
      isArchived: boolean;
    }
  | { kind: 'new'; label: string; brand: string | null; isArchived: false };

/** The product a user chose in the match sheet: a catalog id, or "create new". */
export type ProductPick = { productId: string } | 'new';

/** Server-resolved line → editable draft. */
export function toDraft(line: ReceiptReview['lines'][number]): LineDraft {
  const suggestions =
    line.match.kind === 'suggested'
      ? line.match.suggestions.map((suggestion) => ({
          productId: suggestion.productId,
          name: suggestion.name,
          brand: suggestion.brand,
          score: suggestion.score,
        }))
      : [];

  const product: LineProduct = line.selectedProduct
    ? {
        kind: 'existing',
        productId: line.selectedProduct.productId,
        label: line.selectedProduct.name,
        brand: line.selectedProduct.brand,
        isArchived: line.selectedProduct.isArchived,
      }
    : {
        kind: 'new',
        label: line.match.kind === 'new' ? line.match.draft.name : line.extraction.description,
        brand: line.extraction.brand,
        isArchived: false,
      };

  return {
    index: line.index,
    rawLine: line.extraction.rawLine,
    mergedLineCount: line.mergedLineIndexes.length + 1,
    reviewReasons: line.reviewReasons,
    suggestions,
    product,
    fields: {
      quantity: line.fields.quantity,
      packageSize: line.fields.packageSize,
      sizeSource: line.fields.sizeSource,
      totalPriceCents: line.fields.totalPriceCents,
      unitPriceMilli: line.fields.unitPriceMilli,
      isPromo: line.fields.isPromo,
      promoKind: line.fields.promoKind,
      unitKind: line.fields.unitKind,
    },
    category: line.fields.category,
    // Read off the match, not the status: a line that also lacks a size
    // reports 'needs-size', and the product question must survive the user
    // filling the size in.
    needsProductDecision: line.selectedProduct === null && line.match.kind === 'suggested',
    isExcluded: false,
    shouldLearnAlias: true,
    isUnitPriceEdited: false,
  };
}

/**
 * Apply a field edit to a line. Editing the price or the size re-derives the
 * unit price, unless the user owns it: once they type a unit price
 * themselves, it is never overwritten again.
 */
export function applyFieldsPatch(
  draft: LineDraft,
  patch: Partial<ReceiptLineCardFields>,
): LineDraft {
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
 * Apply a match-sheet pick to a line; either way the product question is
 * answered.
 *
 * @param searchHits products seen in earlier catalog searches, by id: a pick
 *   from search is not among the line's suggestions, and this is where its
 *   name comes from. A pick found in neither keeps the line's current label.
 */
export function applyProductPick(
  draft: LineDraft,
  pick: ProductPick,
  searchHits: ReadonlyMap<string, MatchOption>,
): LineDraft {
  if (pick === 'new') {
    return {
      ...draft,
      needsProductDecision: false,
      product: {
        kind: 'new',
        label: draft.product.label,
        brand: draft.product.brand,
        isArchived: false,
      },
    };
  }
  const known =
    draft.suggestions.find((option) => option.productId === pick.productId) ??
    searchHits.get(pick.productId);
  return {
    ...draft,
    needsProductDecision: false,
    product: {
      kind: 'existing',
      productId: pick.productId,
      label: known?.name ?? draft.product.label,
      brand: known?.brand ?? null,
      isArchived: false,
    },
  };
}

/**
 * Take the unit price back from the user and re-derive it.
 *
 * The way out of the one blocking reason nobody can fix by arithmetic in
 * their head: a hand-typed unit price that no longer matches the price and
 * the size next to it. A line without a size is returned unchanged.
 */
export function recalculateUnitPrice(draft: LineDraft): LineDraft {
  if (draft.fields.packageSize === null || draft.fields.packageSize <= 0) {
    return draft;
  }
  return {
    ...draft,
    isUnitPriceEdited: false,
    fields: {
      ...draft.fields,
      unitPriceMilli: calculateUnitPriceMilli(
        draft.fields.totalPriceCents,
        draft.fields.packageSize,
      ),
    },
  };
}

/** The fields of a draft that decide whether it is done. */
function toLineCheck(draft: LineDraft): ReceiptLineCheck {
  return {
    packageSize: draft.fields.packageSize,
    totalPriceCents: draft.fields.totalPriceCents,
    unitPriceMilli: draft.fields.unitPriceMilli,
    needsProductDecision: draft.needsProductDecision,
  };
}

/**
 * The status the card shows now, after the user's edits — the server's
 * status was computed before they filled the missing size in.
 */
export function computeLiveStatus(draft: LineDraft): ReceiptLineStatus {
  return computeReceiptLineStatus(toLineCheck(draft), draft.reviewReasons.length > 0);
}

/** What the line is still missing; null when it can be confirmed as it stands. */
export function blockingReasonOf(draft: LineDraft): ReceiptLineBlockingReason | null {
  return getReceiptLineBlockingReason(toLineCheck(draft), draft.product.label);
}

/** A line's own total: one package's price times the packages bought. */
export function lineTotalCents(draft: LineDraft): number {
  return draft.fields.totalPriceCents * draft.fields.quantity;
}

/** The counters and the total the confirm bar shows. */
export interface LinesSummary {
  /** The lines that will be confirmed, in receipt order. */
  includedDrafts: LineDraft[];
  readyCount: number;
  blockedCount: number;
  excludedCount: number;
  /** Σ line totals of the included lines, as edited. */
  includedTotalCents: number;
}

/** Split the lines into included and excluded, and count what is still blocked. */
export function summarizeLines(drafts: readonly LineDraft[]): LinesSummary {
  const includedDrafts = drafts.filter((draft) => !draft.isExcluded);
  const blockedCount = includedDrafts.filter((draft) => blockingReasonOf(draft) !== null).length;
  return {
    includedDrafts,
    readyCount: includedDrafts.length - blockedCount,
    blockedCount,
    excludedCount: drafts.length - includedDrafts.length,
    includedTotalCents: includedDrafts.reduce((sum, draft) => sum + lineTotalCents(draft), 0),
  };
}

/** How the edited lines compare with the total printed on the receipt. */
export interface ReceiptReconciliation {
  /**
   * receiptTotal − Σ included line totals; null when the receipt shows no
   * legible total. Negative means the till charged less than the lines add up to.
   */
  totalDifferenceCents: number | null;
  /** The difference is beyond RECEIPT_TOTAL_TOLERANCE_CENTS. */
  hasTotalMismatch: boolean;
  /** The one line whose packages exactly explain the gap, when there is one. */
  extraPackages: { draft: LineDraft; packages: number } | null;
}

/**
 * Reconcile the included lines with the printed total.
 *
 * The reconciliation the user is actually doing, against the paper in
 * their hand — so it is computed from the lines AS EDITED, not from the
 * extraction as it arrived. That is what lets a correction close the gap:
 * the model read one "PESTO 1,64" line too many, and dropping the
 * packages stepper from 7 to 6 has to take the difference to zero, or
 * the number is telling the user nothing they can act on.
 *
 * @param receiptTotalCents the printed total, or null when not legible
 * @param includedDrafts the lines that will be confirmed (see summarizeLines)
 */
export function reconcileWithReceiptTotal(
  receiptTotalCents: number | null,
  includedDrafts: readonly LineDraft[],
): ReceiptReconciliation {
  if (receiptTotalCents === null) {
    return { totalDifferenceCents: null, hasTotalMismatch: false, extraPackages: null };
  }
  const includedTotalCents = includedDrafts.reduce((sum, draft) => sum + lineTotalCents(draft), 0);
  const totalDifferenceCents = receiptTotalCents - includedTotalCents;
  const hint = suggestExtraPackages(
    totalDifferenceCents,
    includedDrafts.map((draft) => ({
      key: draft.index,
      packagePriceCents: draft.fields.totalPriceCents,
      quantity: draft.fields.quantity,
    })),
  );
  const hintDraft = hint ? includedDrafts.find((draft) => draft.index === hint.key) : undefined;
  return {
    totalDifferenceCents,
    hasTotalMismatch: Math.abs(totalDifferenceCents) > RECEIPT_TOTAL_TOLERANCE_CENTS,
    extraPackages: hint && hintDraft ? { draft: hintDraft, packages: hint.packages } : null,
  };
}

/**
 * The header's review reasons that still stand. The server's own
 * total-mismatch flag is a snapshot of the extraction; the live
 * reconciliation replaces it, and the rest of the header's reasons stand.
 */
export function liveHeaderReasons(
  reasons: ReceiptReview['header']['reasons'],
): ReceiptReview['header']['reasons'] {
  return reasons.filter((reason) => reason !== 'total-mismatch');
}

/**
 * Turn a draft into the confirm action's line.
 *
 * Precondition: blockingReasonOf(draft) is null — the screen's confirm stops
 * at the first line that fails it, which is what makes the size and the unit
 * price safe to read as numbers here.
 */
export function toConfirmLine(draft: LineDraft): ConfirmReceiptActionInput['lines'][number] {
  return {
    index: draft.index,
    product:
      draft.product.kind === 'existing'
        ? { kind: 'existing', productId: draft.product.productId }
        : {
            kind: 'new',
            name: draft.product.label,
            brand: draft.product.brand,
            category: draft.category,
            unitKind: draft.fields.unitKind,
          },
    quantity: draft.fields.quantity,
    packageSize: draft.fields.packageSize as number,
    totalPriceCents: draft.fields.totalPriceCents,
    unitPriceMilli: draft.fields.unitPriceMilli as number,
    isPromo: draft.fields.isPromo,
    promoKind: draft.fields.promoKind,
    learnAlias: draft.shouldLearnAlias,
  };
}
