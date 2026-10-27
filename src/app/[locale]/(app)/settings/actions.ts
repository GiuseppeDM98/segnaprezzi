'use server';

/**
 * Settings Server Actions: index options and backup import.
 */
import { z } from 'zod';

import { invalidInputResult, revalidateAppLayout } from '@/lib/action-results';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import { MAX_CARRY_FORWARD_MONTHS } from '@/lib/inflation';
import {
  type ImportResult,
  type IndexSettings,
  importUserData,
  updateIndexSettings as updateIndexSettingsService,
} from '@/lib/services/settings';

const indexSettingsSchema = z
  .object({
    includePromosInIndex: z.boolean().optional(),
    carryForwardMonths: z.number().int().min(0).max(MAX_CARRY_FORWARD_MONTHS).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Empty patch' });

/** Patch any subset of the index options; the index recomputes on the next read. */
export async function updateIndexSettings(
  input: Partial<IndexSettings>,
): Promise<ActionResult<IndexSettings>> {
  const parsed = indexSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInputResult(parsed.error);
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await updateIndexSettingsService(db, userId, parsed.data);
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('updateIndexSettings', error, { userId }) };
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
    return invalidInputResult(parsed.error);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(parsed.data.json);
  } catch {
    return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Not JSON' } };
  }
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;
    const data = await importUserData(db, userId, payload);
    revalidateAppLayout();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('importBackup', error, { userId }) };
  }
}
