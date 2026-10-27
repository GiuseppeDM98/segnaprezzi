/**
 * The shared failure results and cache step of the Server Actions.
 *
 * Design: every action under src/app is the same four steps — parse, call
 * the service, revalidate, map errors (AGENTS.md §1.10). The steps stay
 * spelled out in each action, so one can be read top to bottom without
 * opening another file; only the parts that were copied verbatim into every
 * one of them live here, so they cannot drift apart. Server-only: it imports
 * next/cache.
 */
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

import { toFieldErrorCode } from '@/lib/domain/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * The result of an input that failed its Zod schema, as the generic
 * INVALID_INPUT.
 *
 * @param error - The ZodError from a failed safeParse
 */
export function invalidInputResult(error: z.ZodError): ActionResult<never> {
  return { ok: false, error: { code: 'INVALID_INPUT', message: error.message } };
}

/**
 * The result of an input that failed its Zod schema, with the code of the
 * failing field (INVALID_PRICE, INVALID_DATE, …) so the form can say which
 * number to fix. For the actions that take price-entry fields.
 *
 * @param error - The ZodError from a failed safeParse
 */
export function fieldErrorResult(error: z.ZodError): ActionResult<never> {
  return { ok: false, error: { code: toFieldErrorCode(error), message: error.message } };
}

/**
 * Invalidate every page under the locale layout after a write.
 *
 * Why the whole layout: the dashboard index, the timeline, the catalog and
 * the product pages all read the same entries, so any write can change any of
 * them — and the dashboard recomputes the index on its next request anyway.
 */
export function revalidateAppLayout(): void {
  revalidatePath('/[locale]', 'layout');
}
