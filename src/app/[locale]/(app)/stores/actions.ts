'use server';

/**
 * Store management Server Actions. Also imported by every
 * screen with a store picker, for inline create — one boundary, one schema,
 * wherever a store is born.
 */
import { z } from 'zod';

import { invalidInputResult, revalidateAppLayout } from '@/lib/action-results';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { nanoidSchema } from '@/lib/domain/schemas';
import { STORE_KINDS } from '@/lib/domain/stores';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import {
  createStore as createStoreService,
  deleteStore as deleteStoreService,
  updateStore as updateStoreService,
} from '@/lib/services/stores';

const storeInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  chain: z.string().trim().max(100).nullable(),
  city: z.string().trim().max(100).nullable(),
  kind: z.enum(STORE_KINDS),
});

export type StoreActionInput = z.infer<typeof storeInputSchema>;

/** Create a store; returns its id. */
export async function createStore(input: StoreActionInput): Promise<ActionResult<{ id: string }>> {
  const parsed = storeInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await createStoreService(db, userId, {
      ...parsed.data,
      chain: parsed.data.chain || null,
      city: parsed.data.city || null,
    });
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('createStore', error, { userId }) };
  }
}

const updateStoreSchema = z.object({ storeId: nanoidSchema, input: storeInputSchema });

/** Update a store's name, chain, city or kind. */
export async function updateStore(input: {
  storeId: string;
  input: StoreActionInput;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = updateStoreSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    await updateStoreService(db, userId, parsed.data.storeId, {
      ...parsed.data.input,
      chain: parsed.data.input.chain || null,
      city: parsed.data.input.city || null,
    });
    revalidateAppLayout();
    return { ok: true, data: { id: parsed.data.storeId } };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('updateStore', error, { userId }) };
  }
}

/** Delete a store; its entries keep existing without a store. */
export async function deleteStore(input: { storeId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ storeId: nanoidSchema }).safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    await deleteStoreService(db, userId, parsed.data.storeId);
    revalidateAppLayout();
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('deleteStore', error, { userId }) };
  }
}
