'use server';

/**
 * Receipt review Server Actions.
 *
 * Thin by contract: authenticate, validate with Zod, call the service, map
 * domain errors. Every number reaching them has been edited by hand on the
 * client, so nothing is assumed to resemble what the model extracted — the
 * service re-checks the price invariant itself.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { toFieldErrorCode } from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import {
  type ProductSearchHit,
  searchProducts as searchProductsService,
} from '@/lib/services/catalog';
import {
  type ConfirmReceiptResult,
  confirmReceipt as confirmReceiptService,
} from '@/lib/services/confirm-receipt';
import { discardReceipt as discardReceiptService } from '@/lib/services/discard-receipt';
import {
  type ConfirmReceiptActionInput,
  confirmReceiptSchema,
  discardReceiptSchema,
} from './schema';

/** Turn the reviewed lines into price entries and learn their aliases. */
export async function confirmReceipt(
  input: ConfirmReceiptActionInput,
): Promise<ActionResult<ConfirmReceiptResult>> {
  const parsed = confirmReceiptSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: toFieldErrorCode(parsed.error), message: parsed.error.message },
    };
  }

  try {
    const user = await requireUser();
    const data = await confirmReceiptService(db, user.id, parsed.data);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toLoggedActionError('confirmReceipt', error, { receiptId: parsed.data.receiptId }),
    };
  }
}

/** Abandon an import in progress; the row survives so a re-upload resumes it. */
export async function discardReceipt(input: {
  receiptId: string;
}): Promise<ActionResult<{ receiptId: string }>> {
  const parsed = discardReceiptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }

  try {
    const user = await requireUser();
    const data = await discardReceiptService(db, user.id, parsed.data.receiptId);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('discardReceipt', error) };
  }
}

const searchProductsSchema = z.object({ query: z.string().trim().max(100) });

/** Catalog search for the line cards' product picker (shared with the capture review's). */
export async function searchProducts(input: {
  query: string;
}): Promise<ActionResult<ProductSearchHit[]>> {
  const parsed = searchProductsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    const data = await searchProductsService(db, user.id, parsed.data.query);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('searchProducts', error) };
  }
}
