'use server';

/**
 * Manual entry Server Action.
 *
 * Online-only in v1: the form needs product and store lookups, so unlike the
 * photo path it does not queue offline. No idempotency key is needed either —
 * the form is single-shot and the UI disables submit while it is pending.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { PROMO_KINDS } from '@/lib/domain/entries';
import {
  epochMsSchema,
  nanoidSchema,
  packageSizeSchema,
  productPickSchema,
  toFieldErrorCode,
  totalPriceCentsSchema,
  unitPriceMilliSchema,
} from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import { createPriceEntry } from '@/lib/services/create-price-entry';

const createManualEntrySchema = z
  .object({
    product: productPickSchema,
    storeId: nanoidSchema.nullable(),
    recordedAt: epochMsSchema,
    totalPriceCents: totalPriceCentsSchema,
    packageSize: packageSizeSchema,
    unitPriceMilli: unitPriceMilliSchema,
    isPromo: z.boolean(),
    promoKind: z.enum(PROMO_KINDS).nullable(),
  })
  .refine((entry) => entry.isPromo || entry.promoKind === null, {
    message: 'promoKind requires isPromo',
  });

export type CreateManualEntryInput = z.infer<typeof createManualEntrySchema>;

/** Record one hand-entered price observation. */
export async function createManualEntry(
  input: CreateManualEntryInput,
): Promise<ActionResult<{ entryId: string; productId: string }>> {
  const parsed = createManualEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: toFieldErrorCode(parsed.error), message: parsed.error.message },
    };
  }

  try {
    const user = await requireUser();
    const { entryId, productId } = await createPriceEntry(db, user.id, {
      ...parsed.data,
      source: 'manual',
    });
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data: { entryId, productId } };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('createManualEntry', error) };
  }
}
