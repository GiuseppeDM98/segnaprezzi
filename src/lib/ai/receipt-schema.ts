/**
 * Structured-output schema for receipt extraction.
 *
 * The model's output is untrusted input like any other (AGENTS.md §1.8):
 * the SDK validates against this schema before the extraction reaches a
 * service. Enums are imported from the domain modules, never re-declared —
 * a category the app does not know must be a schema failure, not a row.
 */
import { z } from 'zod';

import { CATEGORY_IDS } from '@/lib/domain/categories';
import { PROMO_KINDS } from '@/lib/domain/entries';
import { QUANTITY_KINDS } from '@/lib/domain/receipt-lines';
import { UNIT_KINDS } from '@/lib/domain/units';

export { QUANTITY_KINDS };

export const receiptLineSchema = z.object({
  rawLine: z.string().min(1),
  description: z.string().min(1),
  brand: z.string().nullable(),
  category: z.enum(CATEGORY_IDS),
  quantity: z.number().positive(),
  quantityKind: z.enum(QUANTITY_KINDS),
  unitPriceCentsOnReceipt: z.number().int().nonnegative().nullable(),
  lineTotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  packageSizeHint: z.number().positive().nullable(),
  unitKindHint: z.enum(UNIT_KINDS).nullable(),
  isPromo: z.boolean(),
  promoKind: z.enum(PROMO_KINDS).nullable(),
  confidence: z.number().min(0).max(1),
});

export const receiptExtractionSchema = z.object({
  storeChain: z.string().nullable(),
  storeName: z.string().nullable(),
  purchasedAt: z.string().nullable(),
  receiptTotalCents: z.number().int().nonnegative().nullable(),
  // A sanity bound, not a product limit: a 200-line receipt is a restaurant
  // inventory, and an unbounded array is how one malformed output becomes a
  // 100 KB ai_raw_json.
  lines: z.array(receiptLineSchema).max(200),
  confidence: z.number().min(0).max(1),
});

export type ReceiptLine = z.infer<typeof receiptLineSchema>;
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
