/**
 * Post-extraction sanity check (Spec 03 §7.4). Pure — the service applies it
 * to every extraction before the response leaves the server.
 */
import type { ExtractionResult } from './extraction-schema';

/** Allowed relative gap between the printed total and unit × size (2%). */
const CROSS_CHECK_TOLERANCE = 0.02;
const MIN_CONFIDENCE = 0.6;

export type ReviewReason = 'price-mismatch' | 'low-confidence';

export interface ReviewedExtraction extends ExtractionResult {
  needsReview: boolean;
  reviewReasons: ReviewReason[];
}

/**
 * Flag extractions the user must double-check before confirming.
 *
 * The invariant unitPriceMilli × packageSize = totalPriceCents × 10 holds on
 * a correct tag (both sides are milli-euros for the whole package). A gap
 * beyond 2% means a misread digit, a promo tag whose unit price refers to
 * the old full price, or a unit mix-up — all worth a human look.
 *
 * @param extraction - A schema-valid extraction straight from the gateway
 * @returns The same fields plus needsReview and the reasons behind it
 */
export function flagExtractionForReview(extraction: ExtractionResult): ReviewedExtraction {
  const reviewReasons: ReviewReason[] = [];

  // Skip the cross-check when any value is the 0 "not legible" sentinel —
  // the prompt forces confidence < 0.3 in that case, which flags below.
  const hasAllPrices =
    extraction.totalPriceCents > 0 && extraction.unitPriceMilli > 0 && extraction.packageSize > 0;

  if (hasAllPrices) {
    const totalMilli = extraction.totalPriceCents * 10;
    const derivedMilli = extraction.unitPriceMilli * extraction.packageSize;
    if (Math.abs(derivedMilli - totalMilli) > CROSS_CHECK_TOLERANCE * totalMilli) {
      reviewReasons.push('price-mismatch');
    }
  }

  if (extraction.confidence < MIN_CONFIDENCE) {
    reviewReasons.push('low-confidence');
  }

  return {
    ...extraction,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
}
