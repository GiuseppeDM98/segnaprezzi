/**
 * Boundary schemas for the review screen's Server Actions (Spec 03 §9.2).
 *
 * They live beside `actions.ts` rather than inside it because a `"use server"`
 * module may only export async functions — and both the action and its tests
 * need this schema.
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

/** Vercel Blob's public host suffix — photoUrl may point nowhere else. */
const BLOB_HOSTNAME_SUFFIX = '.public.blob.vercel-storage.com';

const confirmEntrySchema = z
  .object({
    id: nanoidSchema, // client photo id → price_entries.id (idempotency key)
    product: productPickSchema,
    recordedAt: epochMsSchema, // epoch ms; default = photo createdAt
    totalPriceCents: totalPriceCentsSchema,
    packageSize: packageSizeSchema,
    unitPriceMilli: unitPriceMilliSchema,
    isPromo: z.boolean(),
    promoKind: z.enum(PROMO_KINDS).nullable(),
    // Why constrain the host: photoUrl is written straight into the entry and
    // later rendered as an <img> src. Accepting an arbitrary URL would let a
    // crafted confirm turn the user's own history into a beacon for someone
    // else's server.
    photoUrl: z
      .url()
      .refine(
        (url) => new URL(url).hostname.endsWith(BLOB_HOSTNAME_SUFFIX),
        'photoUrl must be a Vercel Blob URL',
      )
      .nullable(),
    aiConfidence: z.number().min(0).max(1).nullable(),
    aiModel: z.string().max(100).nullable(),
    aiRawJson: z.string().max(20_000).nullable(),
  })
  .refine((entry) => entry.isPromo || entry.promoKind === null, {
    message: 'promoKind requires isPromo',
  });

export const confirmShoppingSessionSchema = z.object({
  sessionId: nanoidSchema,
  /** One store per session (v1): applied to the session and every entry. */
  storeId: nanoidSchema.nullable(),
  entries: z.array(confirmEntrySchema).min(1).max(100),
});

export type ConfirmShoppingSessionInput = z.infer<typeof confirmShoppingSessionSchema>;

export const beginSessionReviewSchema = z.object({ sessionId: nanoidSchema });
