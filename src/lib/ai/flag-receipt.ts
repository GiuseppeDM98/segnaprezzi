/**
 * Post-extraction sanity checks for a receipt. Pure — the import service
 * applies it to every extraction before the response leaves the server.
 *
 * Design: nothing here BLOCKS an import. A receipt whose lines do not add up
 * to its printed total is usually still 38 good observations and one
 * unreadable coupon line; the user is the authority and the flags exist to
 * point their eyes at the right rows, not to refuse the file.
 */
import { parseReceiptPurchasedAt, RECEIPT_TOTAL_TOLERANCE_CENTS } from '@/lib/domain/receipts';
import type { ReceiptExtraction, ReceiptLine } from './receipt-schema';

export const MIN_LINE_CONFIDENCE = 0.6;
export const MIN_RECEIPT_CONFIDENCE = 0.5;

/** Slack on `unitPrice × quantity = lineTotal + discount` (counted lines). */
const LINE_ARITHMETIC_TOLERANCE_CENTS = 2;

/** How far back a receipt date may plausibly reach. */
const MAX_RECEIPT_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** Clock skew tolerated between the user's device and the server. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type ReceiptReviewReason =
  /** Σ lineTotalCents ≠ receiptTotalCents (± tolerance). */
  | 'total-mismatch'
  /** Overall confidence below MIN_RECEIPT_CONFIDENCE. */
  | 'low-confidence'
  /** receiptTotalCents null: nothing to cross-check against. */
  | 'no-total'
  /** purchasedAt null, unparseable, or outside the plausible window. */
  | 'no-date';

export type LineReviewReason =
  | 'low-confidence'
  /** unitPriceCentsOnReceipt × quantity ≠ lineTotal + discount (pieces only). */
  | 'qty-price-mismatch'
  | 'zero-price';

export interface FlaggedReceiptHeader {
  needsReview: boolean;
  reasons: ReceiptReviewReason[];
  /** Epoch ms UTC; falls back to `now` when the date is unusable. */
  purchasedAtMs: number;
  /** Σ of every line total, for the cross-check the review screen shows. */
  linesTotalCents: number;
}

export interface FlaggedReceiptLine {
  needsReview: boolean;
  reasons: LineReviewReason[];
}

export interface FlaggedReceipt {
  header: FlaggedReceiptHeader;
  lines: FlaggedReceiptLine[];
}

/**
 * Flag the parts of an extraction a human should look at.
 *
 * @param extraction - A schema-valid extraction straight from the gateway
 * @param now - Epoch ms UTC; the date fallback and the future check use it
 * @returns Header flags (with the resolved purchase date) plus one entry per
 *   line, positionally matching `extraction.lines`
 */
export function flagReceiptForReview(extraction: ReceiptExtraction, now: number): FlaggedReceipt {
  const reasons: ReceiptReviewReason[] = [];

  const linesTotalCents = extraction.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (extraction.receiptTotalCents === null) {
    reasons.push('no-total');
  } else if (
    Math.abs(linesTotalCents - extraction.receiptTotalCents) > RECEIPT_TOTAL_TOLERANCE_CENTS
  ) {
    reasons.push('total-mismatch');
  }

  if (extraction.confidence < MIN_RECEIPT_CONFIDENCE) {
    reasons.push('low-confidence');
  }

  const purchasedAtMs = resolvePurchasedAt(extraction.purchasedAt, now);
  if (purchasedAtMs === null) {
    reasons.push('no-date');
  }

  return {
    header: {
      needsReview: reasons.length > 0,
      reasons,
      purchasedAtMs: purchasedAtMs ?? now,
      linesTotalCents,
    },
    lines: extraction.lines.map(flagLine),
  };
}

/** Per-line checks: the confidence the model reported and the line's own arithmetic. */
function flagLine(line: ReceiptLine): FlaggedReceiptLine {
  const reasons: LineReviewReason[] = [];

  if (line.lineTotalCents <= 0) {
    reasons.push('zero-price');
  }

  /*
   * Teacher: on a counted line the printer states three numbers that must
   * agree — "2 x 1,09  2,18" with a 0,40 discount means 2 × 109 = 178 + 40.
   * A gap means a misread digit or a discount attached to the wrong line.
   * Weighed lines are excluded: their "quantity" is a weight, so the product
   * is a €/kg × kg and rounds differently (deriveUnitPriceMilli checks that
   * one against its own 1 % tolerance).
   */
  if (line.quantityKind === 'pieces' && line.unitPriceCentsOnReceipt !== null) {
    const printed = line.unitPriceCentsOnReceipt * line.quantity;
    const paid = line.lineTotalCents + line.discountCents;
    if (Math.abs(printed - paid) > LINE_ARITHMETIC_TOLERANCE_CENTS) {
      reasons.push('qty-price-mismatch');
    }
  }

  if (line.confidence < MIN_LINE_CONFIDENCE) {
    reasons.push('low-confidence');
  }

  return { needsReview: reasons.length > 0, reasons };
}

/** The receipt's own date, or null when it is missing or implausible. */
function resolvePurchasedAt(raw: string | null, now: number): number | null {
  const parsed = parseReceiptPurchasedAt(raw);
  if (parsed === null) {
    return null;
  }
  if (parsed > now + FUTURE_TOLERANCE_MS || parsed < now - MAX_RECEIPT_AGE_MS) {
    return null;
  }
  return parsed;
}
