'use server';

/**
 * Fuel quick-entry Server Action (Spec 03 §11.3).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { FUEL_QUICK_PICKS, type FuelQuickPickKey } from '@/lib/domain/fuel-products';
import { epochMsSchema, nanoidSchema, toFieldErrorCode } from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import { createFuelEntry as createFuelEntryService } from '@/lib/services/create-price-entry';

// Derived from the domain constant so a new quick-pick is accepted here
// automatically instead of silently 400-ing (Spec 03 §11.1).
const FUEL_KEYS = FUEL_QUICK_PICKS.map((pick) => pick.key) as [
  FuelQuickPickKey,
  ...FuelQuickPickKey[],
];

const createFuelEntrySchema = z.object({
  fuel: z.enum(FUEL_KEYS),
  /** Store of kind 'fuel_station'; optional but encouraged. */
  storeId: nanoidSchema.nullable(),
  recordedAt: epochMsSchema,
  unitPriceMilli: z.number().int().min(1).max(10_000), // ≤ €10 per base unit
  /** Litres, or kilograms for methane (§11.1). → package_size */
  quantity: z.number().min(0.1).max(200),
  totalPriceCents: z.number().int().min(1).max(50_000), // ≤ €500
});

export type CreateFuelEntryInput = z.infer<typeof createFuelEntrySchema>;

/** Record a refuelling stop. */
export async function createFuelEntry(
  input: CreateFuelEntryInput,
): Promise<ActionResult<{ entryId: string }>> {
  const parsed = createFuelEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: toFieldErrorCode(parsed.error), message: parsed.error.message },
    };
  }

  try {
    const user = await requireUser();
    const { entryId } = await createFuelEntryService(db, user.id, parsed.data);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data: { entryId } };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('createFuelEntry', error) };
  }
}
