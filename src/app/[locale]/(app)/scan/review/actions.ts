'use server';

/**
 * Review-screen Server Actions (Spec 03 §9.2).
 *
 * Thin by contract: authenticate, validate with Zod, call the service, map
 * domain errors. The schemas in ./schema.ts are the trust boundary —
 * everything they accept has already been edited by hand on the client, so
 * nothing reaching the service is assumed to resemble what was extracted.
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
    return {
      ok: false,
      error: { code: toFieldErrorCode(parsed.error), message: parsed.error.message },
    };
  }

  try {
    const user = await requireUser();
    const data = await confirmShoppingSessionService(db, user.id, parsed.data);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: toLoggedActionError('confirmShoppingSession', error, {
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
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }

  try {
    const user = await requireUser();
    const session = await beginSessionReviewService(db, user.id, parsed.data.sessionId);
    return { ok: true, data: { sessionId: session.id } };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('beginSessionReview', error) };
  }
}

const searchProductsSchema = z.object({ query: z.string().trim().max(100) });

/** Catalog search for the match picker (Spec 05 §5.3). */
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
