'use server';

/**
 * Product-detail Server Actions: the entry sheet's edit and delete of one
 * observation (shared with the timeline). Neither recomputes the index
 * explicitly — the dashboard reads the engine fresh on every request.
 */
import { z } from 'zod';

import { fieldErrorResult, invalidInputResult, revalidateAppLayout } from '@/lib/action-results';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { PROMO_KINDS } from '@/lib/domain/entries';
import {
  epochMsSchema,
  nanoidSchema,
  packageSizeSchema,
  totalPriceCentsSchema,
  unitPriceMilliSchema,
} from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import {
  deletePriceEntry as deletePriceEntryService,
  updatePriceEntry as updatePriceEntryService,
} from '@/lib/services/product-detail';

const editEntrySchema = z
  .object({
    entryId: nanoidSchema,
    recordedAt: epochMsSchema,
    storeId: nanoidSchema.nullable(),
    totalPriceCents: totalPriceCentsSchema,
    packageSize: packageSizeSchema,
    unitPriceMilli: unitPriceMilliSchema,
    isPromo: z.boolean(),
    promoKind: z.enum(PROMO_KINDS).nullable(),
  })
  .refine((entry) => entry.isPromo || entry.promoKind === null, {
    message: 'promoKind requires isPromo',
  });

export type EditEntryActionInput = z.infer<typeof editEntrySchema>;

/** Correct one observation. */
export async function updatePriceEntry(input: EditEntryActionInput): Promise<ActionResult<null>> {
  const parsed = editEntrySchema.safeParse(input);
  if (!parsed.success) {
    return fieldErrorResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const { entryId, ...patch } = parsed.data;
    await updatePriceEntryService(db, userId, entryId, patch);
    revalidateAppLayout();
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('updatePriceEntry', error, { userId }) };
  }
}

/** Delete one observation. */
export async function deletePriceEntry(input: { entryId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ entryId: nanoidSchema }).safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    await deletePriceEntryService(db, userId, parsed.data.entryId);
    revalidateAppLayout();
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('deletePriceEntry', error, { userId }) };
  }
}
