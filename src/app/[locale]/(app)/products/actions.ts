'use server';

/**
 * Catalog Server Actions: merge, edit, archive, delete.
 * Thin by contract: authenticate, validate with Zod, call the service, map
 * domain errors.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { CATEGORY_IDS } from '@/lib/domain/categories';
import { nanoidSchema } from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import {
  type DeleteProductsResult,
  deleteProducts as deleteProductsService,
  editProduct as editProductService,
  type MergeProductsResult,
  mergeProducts as mergeProductsService,
  setProductArchived as setProductArchivedService,
} from '@/lib/services/catalog';

const mergeProductsSchema = z.object({
  survivorId: nanoidSchema,
  mergedIds: z.array(nanoidSchema).min(1).max(50),
});

/** Move the entries of `mergedIds` onto the survivor and archive them. Irreversible. */
export async function mergeProducts(input: {
  survivorId: string;
  mergedIds: string[];
}): Promise<ActionResult<MergeProductsResult>> {
  const parsed = mergeProductsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    const data = await mergeProductsService(db, user.id, parsed.data);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('mergeProducts', error) };
  }
}

const editProductSchema = z.object({
  productId: nanoidSchema,
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(100).nullable(),
  category: z.enum(CATEGORY_IDS),
});

/** Rename / re-brand / re-categorize a product. */
export async function editProduct(input: {
  productId: string;
  name: string;
  brand: string | null;
  category: string;
}): Promise<ActionResult<null>> {
  const parsed = editProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    const { productId, ...patch } = parsed.data;
    await editProductService(db, user.id, productId, { ...patch, brand: patch.brand || null });
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('editProduct', error) };
  }
}

const archiveSchema = z.object({ productId: nanoidSchema, isArchived: z.boolean() });

/** Archive or restore a product. */
export async function setProductArchived(input: {
  productId: string;
  isArchived: boolean;
}): Promise<ActionResult<null>> {
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    await setProductArchivedService(db, user.id, parsed.data.productId, parsed.data.isArchived);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('setProductArchived', error) };
  }
}

const deleteProductsSchema = z.object({ productIds: z.array(nanoidSchema).min(1).max(50) });

/**
 * Delete products and every observation they carry. Irreversible, and the
 * only action in the app that destroys price history — the caller is
 * responsible for having asked first, with the entry count in hand.
 */
export async function deleteProducts(input: {
  productIds: string[];
}): Promise<ActionResult<DeleteProductsResult>> {
  const parsed = deleteProductsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    const data = await deleteProductsService(db, user.id, parsed.data.productIds);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('deleteProducts', error) };
  }
}
