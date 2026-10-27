'use server';

/**
 * Review-screen Server Actions.
 *
 * Thin by contract: authenticate, validate with Zod, call the service, map
 * domain errors. The schemas in ./schema.ts are the trust boundary —
 * everything they accept has already been edited by hand on the client, so
 * nothing reaching the service is assumed to resemble what was extracted.
 */
import { fieldErrorResult, invalidInputResult, revalidateAppLayout } from '@/lib/action-results';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import {
  type ConfirmShoppingSessionResult,
  confirmShoppingSession as confirmShoppingSessionService,
} from '@/lib/services/confirm-shopping-session';
import { beginSessionReview as beginSessionReviewService } from '@/lib/services/shopping-session-lifecycle';
import {
  beginSessionReviewSchema,
  type ConfirmShoppingSessionInput,
  confirmShoppingSessionSchema,
} from './schema';

/** Persist a reviewed batch and close the spesa. Idempotent under replay. */
export async function confirmShoppingSession(
  input: ConfirmShoppingSessionInput,
): Promise<ActionResult<ConfirmShoppingSessionResult>> {
  const parsed = confirmShoppingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return fieldErrorResult(parsed.error);
  }

  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await confirmShoppingSessionService(db, userId, parsed.data);
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toLoggedActionError('confirmShoppingSession', error, {
        userId,
        sessionId: parsed.data.sessionId,
      }),
    };
  }
}

/**
 * Mark the spesa as under review when the user opens /scan/review online.
 * Best-effort by design: an offline review simply never reports it, and
 * confirm still accepts an `active` session (§2.1).
 */
export async function beginSessionReview(input: {
  sessionId: string;
}): Promise<ActionResult<{ sessionId: string }>> {
  const parsed = beginSessionReviewSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }

  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const session = await beginSessionReviewService(db, userId, parsed.data.sessionId);
    return { ok: true, data: { sessionId: session.id } };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('beginSessionReview', error, { userId }) };
  }
}
