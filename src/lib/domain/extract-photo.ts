/**
 * The wire contract of POST /api/extract: what one price-tag photo becomes
 * on its way back to the client.
 *
 * Design: the producers of these shapes are server modules (the Anthropic
 * gateway's schema, the review flags, the catalog matcher), but the consumers
 * include the offline queue — which also runs in the service worker and may
 * import nothing from the server — and the review screen. Declaring the types
 * here, in the pure domain, is what lets both sides share them; the gateway
 * schema is checked against ExtractionResult at compile time, so the two
 * cannot drift.
 */
import type { CategoryId } from './categories';
import type { PromoKind } from './entries';
import type { UnitKind } from './units';

/**
 * The fields the model reads off a price tag. The money and size fields use
 * 0 as the "not legible" sentinel; confirm-time validation requires positive
 * values, so a sentinel makes the user fill the gap.
 */
export interface ExtractionResult {
  productName: string;
  brand: string | null;
  category: CategoryId;
  unitKind: UnitKind;
  /** Euro cents; 0 when not legible. */
  totalPriceCents: number;
  /** Base units (kg, L, pieces); 0 when not legible. */
  packageSize: number;
  /** Milli-euros per base unit; 0 when not legible. */
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
  /** 0..1, the model's own estimate. */
  confidence: number;
  rawText: string;
}

/** Why an extraction asks for a human look before it is confirmed. */
export type ReviewReason = 'price-mismatch' | 'low-confidence';

/** An extraction plus the server's verdict on whether to double-check it. */
export interface ReviewedExtraction extends ExtractionResult {
  needsReview: boolean;
  reviewReasons: ReviewReason[];
}

/**
 * Lowest match score (0–1) at which the top product suggestion arrives
 * preselected on a review card; below it the card starts unresolved and the
 * user picks. One constant for every capture path, so the same product with
 * the same score cannot be preselected through one and not another.
 */
export const PRESELECT_SCORE_THRESHOLD = 0.7;

/** One catalog product the matcher proposes for an extraction. */
export interface ProductSuggestion {
  productId: string;
  name: string;
  brand: string | null;
  /** 0..1 similarity. */
  score: number;
}

/** The 200 body of POST /api/extract. */
export interface ExtractPhotoResponse {
  blobUrl: string;
  extraction: ReviewedExtraction;
  /** The best catalog matches (suggestProductMatches caps them), best first; may be empty. */
  suggestions: ProductSuggestion[];
  /** Model that produced the extraction — stored to price_entries.ai_model on confirm. */
  model: string;
}
