'use server';

/**
 * Capture-screen Server Actions.
 *
 * Thin by contract: authenticate, validate with Zod, call the service, map
 * domain errors. No business rule lives here.
 */
import { z } from 'zod';

import { invalidInputResult, revalidateAppLayout } from '@/lib/action-results';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { nanoidSchema } from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import { discardShoppingSession as discardShoppingSessionService } from '@/lib/services/shopping-session-lifecycle';

const discardShoppingSessionSchema = z.object({
  sessionId: nanoidSchema,
  /** Blob URLs of already-extracted photos, so the server can clean them up. */
  blobUrls: z.array(z.url()).max(100),
});

type DiscardShoppingSessionInput = z.infer<typeof discardShoppingSessionSchema>;

/** Abandon the current spesa and delete its uploaded photos. Idempotent. */
export async function discardShoppingSession(
  input: DiscardShoppingSessionInput,
): Promise<ActionResult<{ sessionId: string }>> {
  const parsed = discardShoppingSessionSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }

  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await discardShoppingSessionService(db, userId, parsed.data);
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('discardShoppingSession', error, { userId }) };
  }
}
