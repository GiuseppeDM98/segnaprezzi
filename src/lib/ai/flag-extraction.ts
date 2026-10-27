/**
 * Post-extraction sanity check. Pure — the service applies it to every
 * extraction before the response leaves the server.
 */
import type {
  ExtractionResult,
  ReviewedExtraction,
  ReviewReason,
} from '@/lib/domain/extract-photo';
import { isWithinCrossCheckTolerance } from '@/lib/domain/money';

export type { ReviewedExtraction, ReviewReason };

const MIN_CONFIDENCE = 0.6;

/**
 * Flag extractions the user must double-check before confirming.
 *
 * The invariant unitPriceMilli × packageSize = totalPriceCents × 10 holds on
 * a correct tag (both sides are milli-euros for the whole package). A gap
 * beyond isWithinCrossCheckTolerance's 2% is worth a human look.
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

  if (
    hasAllPrices &&
    !isWithinCrossCheckTolerance(
      extraction.totalPriceCents,
      extraction.packageSize,
      extraction.unitPriceMilli,
    )
  ) {
    reviewReasons.push('price-mismatch');
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
