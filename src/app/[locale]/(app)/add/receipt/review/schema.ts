/**
 * Boundary schemas for the receipt review's Server Actions (Spec 07 §8.2).
 *
 * They live beside `actions.ts` rather than inside it because a `"use server"`
 * module may only export async functions (AGENTS.md §4.22) — and both the
 * action and its tests need these shapes.
 */
import { z } from 'zod';

import { PROMO_KINDS } from '@/lib/domain/entries';
import {
  epochMsSchema,
  nanoidSchema,
  packageSizeSchema,
  productPickSchema,
  totalPriceCentsSchema,
  unitPriceMilliSchema,
} from '@/lib/domain/schemas';
import { STORE_KINDS } from '@/lib/domain/stores';

const confirmLineSchema = z
  .object({
    /** Position on the receipt; indexes into the stored extraction. */
    index: z.number().int().nonnegative().max(199),
    product: productPickSchema,
    quantity: z.number().int().min(1).max(99),
    packageSize: packageSizeSchema,
    totalPriceCents: totalPriceCentsSchema,
    unitPriceMilli: unitPriceMilliSchema,
    isPromo: z.boolean(),
    promoKind: z.enum(PROMO_KINDS).nullable(),
    // Why the alias flag but not the alias: the key is recomputed server-side
    // from the stored rawLine (§8.3 step 7). A client that could name it
    // could teach the catalog a mapping the receipt never printed.
    learnAlias: z.boolean().default(true),
  })
  .refine((line) => line.isPromo || line.promoKind === null, {
    message: 'promoKind requires isPromo',
  });

export const confirmReceiptSchema = z.object({
  receiptId: nanoidSchema,
  storeId: nanoidSchema.nullable(),
  newStore: z
    .object({
      name: z.string().min(1).max(200),
      chain: z.string().max(100).nullable(),
      kind: z.enum(STORE_KINDS),
    })
    .nullable(),
  purchasedAt: epochMsSchema,
  lines: z.array(confirmLineSchema).min(1).max(200),
});

export type ConfirmReceiptActionInput = z.infer<typeof confirmReceiptSchema>;

export const discardReceiptSchema = z.object({ receiptId: nanoidSchema });
