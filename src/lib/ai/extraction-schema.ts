/**
 * The shape the extraction model must return (Spec 03 §7.2, mirroring the
 * field list of Spec 00 §8).
 *
 * Design: this schema is both the structured-output contract handed to the
 * Anthropic SDK and the validation boundary for the model's answer — the
 * model's output is untrusted input like any other (AGENTS.md §1.8).
 *
 * The money and size fields allow 0 as the "not legible" sentinel the prompt
 * mandates. Confirm-time validation (§9.2) requires positive values, so a
 * sentinel forces the user to fill the gap on the review screen instead of
 * silently persisting a zero-price entry.
 */
import { z } from 'zod';

import { CATEGORY_IDS } from '@/lib/domain/categories';
import { PROMO_KINDS } from '@/lib/domain/entries';
import { UNIT_KINDS } from '@/lib/domain/units';

export const extractionResultSchema = z.object({
  productName: z.string().min(1),
  brand: z.string().nullable(),
  category: z.enum(CATEGORY_IDS),
  unitKind: z.enum(UNIT_KINDS),
  totalPriceCents: z
    .number()
    .int()
    .min(0)
    .describe('Euro cents, integer. 0 only when the price is not legible.'),
  packageSize: z
    .number()
    .min(0)
    .describe('Package content in base units (kg, L, or pieces). 0 when not legible.'),
  unitPriceMilli: z
    .number()
    .int()
    .min(0)
    .describe('Milli-euros (1/1000 EUR) per base unit. 0 only when not legible.'),
  isPromo: z.boolean(),
  promoKind: z.enum(PROMO_KINDS).nullable(),
  confidence: z.number().min(0).max(1),
  rawText: z.string(),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
