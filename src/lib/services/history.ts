/**
 * Read model of the timeline (Spec 05 §5.8): one page of entries with the
 * filters the screen offers, cursor-paginated on (user_id, recorded_at).
 * Grouping by day and by shopping session is presentation and happens in
 * the client from `sessionId` — the service only ships what the rows carry.
 */
import type { Db } from '@/lib/db/client';
import { listPriceEntries } from '@/lib/db/repositories/price-entries';
import { listStores } from '@/lib/db/repositories/stores';
import type { CategoryId } from '@/lib/domain/categories';
import type { EntrySource } from '@/lib/domain/entries';
import { type EntrySummary, toEntrySummary } from './product-detail';

export interface HistoryFilters {
  category?: CategoryId;
  storeId?: string;
  /** The timeline only ever narrows to promos; "full price only" is not a filter the screen offers. */
  isPromo?: true;
  source?: EntrySource;
}

export interface HistoryEntry extends EntrySummary {
  sessionId: string | null;
  category: CategoryId;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  nextCursor: string | null;
}

const PAGE_SIZE = 40;

/** One page of the timeline, newest first. */
export async function listHistoryPage(
  db: Db,
  userId: string,
  filters: HistoryFilters = {},
  cursor?: string,
): Promise<HistoryPage> {
  const page = await listPriceEntries(db, userId, { ...filters, cursor, limit: PAGE_SIZE });
  return {
    entries: page.entries.map((row) => ({
      ...toEntrySummary(row),
      sessionId: row.sessionId,
      category: row.product.category,
    })),
    nextCursor: page.nextCursor,
  };
}

export interface HistoryStoreOption {
  id: string;
  name: string;
}

/** The stores offered by the store filter picker. */
export async function listHistoryStoreOptions(
  db: Db,
  userId: string,
): Promise<HistoryStoreOption[]> {
  const stores = await listStores(db, userId);
  return stores.map((store) => ({ id: store.id, name: store.name }));
}
