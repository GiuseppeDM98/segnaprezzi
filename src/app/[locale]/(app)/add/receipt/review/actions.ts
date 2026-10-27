'use server';

/**
 * Receipt review Server Actions.
 *
 * Thin by contract: authenticate, validate with Zod, call the service, map
 * domain errors. Every number reaching them has been edited by hand on the
 * client, so nothing is assumed to resemble what the model extracted — the
 * service re-checks the price invariant itself.
 */
import { fieldErrorResult, invalidInputResult, revalidateAppLayout } from '@/lib/action-results';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
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
    return fieldErrorResult(parsed.error);
  }

  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    // The wire field keeps its short name (`learnAlias`); the service speaks
    // in boolean-prefixed names, so the mapping happens here, once.
    const data = await confirmReceiptService(db, userId, {
      ...parsed.data,
      lines: parsed.data.lines.map(({ learnAlias, ...line }) => ({
        ...line,
        shouldLearnAlias: learnAlias,
      })),
    });
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toLoggedActionError('confirmReceipt', error, {
        userId,
        receiptId: parsed.data.receiptId,
      }),
    };
  }
}

/** Abandon an import in progress; the row survives so a re-upload resumes it. */
export async function discardReceipt(input: {
  receiptId: string;
}): Promise<ActionResult<{ receiptId: string }>> {
  const parsed = discardReceiptSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }

  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await discardReceiptService(db, userId, parsed.data.receiptId);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('discardReceipt', error, { userId }) };
  }
}
