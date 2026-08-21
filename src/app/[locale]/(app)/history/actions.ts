'use server';

/**
 * Timeline Server Actions: one page of entries for the
 * current filters and cursor. Entry edit/delete reuse the product-detail
 * actions — one boundary per operation.
 */
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { CATEGORY_IDS } from '@/lib/domain/categories';
import { ENTRY_SOURCES } from '@/lib/domain/entries';
import { nanoidSchema } from '@/lib/domain/schemas';
import { type ActionResult, toLoggedActionError } from '@/lib/errors';
import { type HistoryPage, listHistoryPage } from '@/lib/services/history';

const historyPageSchema = z.object({
  filters: z.object({
    category: z.enum(CATEGORY_IDS).optional(),
    storeId: nanoidSchema.optional(),
    isPromo: z.literal(true).optional(),
    source: z.enum(ENTRY_SOURCES).optional(),
  }),
  cursor: z.string().max(200).optional(),
});

export type HistoryPageInput = z.infer<typeof historyPageSchema>;

/** Fetch a page of the timeline. */
export async function loadHistoryPage(input: HistoryPageInput): Promise<ActionResult<HistoryPage>> {
  const parsed = historyPageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
  }
  try {
    const user = await requireUser();
    const data = await listHistoryPage(db, user.id, parsed.data.filters, parsed.data.cursor);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toLoggedActionError('loadHistoryPage', error) };
  }
}
