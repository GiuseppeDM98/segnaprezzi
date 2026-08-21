'use server';

/**
 * Price-entry Server Actions (Spec 05 §5.7 entry sheet, shared with the
 * timeline): edit and delete one observation. Both recompute the index
 * implicitly — the dashboard reads the engine fresh on every request.
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
  toFieldErrorCode,
  totalPriceCentsSchema,
  unitPriceMilliSchema,
} from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import { forgetProductAlias } from '@/lib/services/catalog';
import {
  editPriceEntry as editPriceEntryService,
  removePriceEntry,
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
export async function editPriceEntry(input: EditEntryActionInput): Promise<ActionResult<null>> {
  const parsed = editEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: toFieldErrorCode(parsed.error), message: parsed.error.message },
    };
  }
  try {
    const user = await requireUser();
    const { entryId, ...patch } = parsed.data;
    await editPriceEntryService(db, user.id, entryId, patch);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('editPriceEntry', error) };
  }
}

/** Delete one observation. */
export async function deletePriceEntry(input: { entryId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ entryId: nanoidSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    await removePriceEntry(db, user.id, parsed.data.entryId);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('deletePriceEntry', error) };
  }
}

/** Forget one learned receipt line for this product (Spec 07 §9). */
export async function deleteProductAlias(input: { aliasId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ aliasId: nanoidSchema }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    await forgetProductAlias(db, user.id, parsed.data.aliasId);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('deleteProductAlias', error) };
  }
}
