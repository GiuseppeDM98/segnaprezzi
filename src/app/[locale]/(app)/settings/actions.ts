'use server';

/**
 * Settings Server Actions (Spec 05 §5.10): index options and backup import.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import {
  type ImportResult,
  type IndexSettings,
  importUserData,
  updateIndexSettings as updateIndexSettingsService,
} from '@/lib/services/settings';

const indexSettingsSchema = z
  .object({
    includePromosInIndex: z.boolean().optional(),
    carryForwardMonths: z.number().int().min(0).max(6).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Empty patch' });

/** Change one or both index options; the index recomputes on the next read. */
export async function updateIndexSettings(
  input: Partial<IndexSettings>,
): Promise<ActionResult<IndexSettings>> {
  const parsed = indexSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    const data = await updateIndexSettingsService(db, user.id, parsed.data);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('updateIndexSettings', error) };
  }
}

/** Upper bound on an import file; a personal export is far below it. */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * Merge a backup (a previous /api/export JSON) into the user's data. The
 * raw text is parsed here so the service receives `unknown` and validates.
 */
export async function importBackup(input: { json: string }): Promise<ActionResult<ImportResult>> {
  const parsed = z.object({ json: z.string().max(MAX_IMPORT_BYTES) }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(parsed.data.json);
  } catch {
    return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Not JSON' } };
  }
  try {
    const user = await requireUser();
    const data = await importUserData(db, user.id, payload);
    revalidatePath('/[locale]', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('importBackup', error) };
  }
}
