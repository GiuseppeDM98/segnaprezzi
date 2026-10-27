'use server';

/**
 * Catalog Server Actions: merge, edit, archive, delete, and the catalog
 * search every product picker shares.
 * Thin by contract: authenticate, validate with Zod, call the service, map
 * domain errors.
 */
import { z } from 'zod';

import { invalidInputResult, revalidateAppLayout } from '@/lib/action-results';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { CATEGORY_IDS } from '@/lib/domain/categories';
import { nanoidSchema } from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import {
  type DeleteProductsResult,
  deleteProducts as deleteProductsService,
  type MergeProductsResult,
  mergeProducts as mergeProductsService,
  type ProductSearchHit,
  searchProducts as searchProductsService,
  setProductArchived as setProductArchivedService,
  updateProduct as updateProductService,
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
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await mergeProductsService(db, userId, parsed.data);
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('mergeProducts', error, { userId }) };
  }
}

const editProductSchema = z.object({
  productId: nanoidSchema,
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(100).nullable(),
  category: z.enum(CATEGORY_IDS),
});

/** Rename / re-brand / re-categorize a product. */
export async function updateProduct(input: {
  productId: string;
  name: string;
  brand: string | null;
  category: string;
}): Promise<ActionResult<null>> {
  const parsed = editProductSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const { productId, ...patch } = parsed.data;
    await updateProductService(db, userId, productId, { ...patch, brand: patch.brand || null });
    revalidateAppLayout();
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('updateProduct', error, { userId }) };
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
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    await setProductArchivedService(db, userId, parsed.data.productId, parsed.data.isArchived);
    revalidateAppLayout();
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('setProductArchived', error, { userId }) };
  }
}

const deleteProductsSchema = z.object({ productIds: z.array(nanoidSchema).min(1).max(50) });

/**
 * Delete products and every observation they carry. Irreversible — whole
 * price histories go with them — so the caller is responsible for having
 * asked first, with the entry count in hand.
 */
export async function deleteProducts(input: {
  productIds: string[];
}): Promise<ActionResult<DeleteProductsResult>> {
  const parsed = deleteProductsSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await deleteProductsService(db, userId, parsed.data.productIds);
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('deleteProducts', error, { userId }) };
  }
}

const searchProductsSchema = z.object({ query: z.string().trim().max(100) });

/** Catalog search (name or brand, non-archived products) for every product picker. */
export async function searchProducts(input: {
  query: string;
}): Promise<ActionResult<ProductSearchHit[]>> {
  const parsed = searchProductsSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await searchProductsService(db, userId, parsed.data.query);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('searchProducts', error, { userId }) };
  }
}
