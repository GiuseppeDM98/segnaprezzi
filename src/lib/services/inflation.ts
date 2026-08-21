/**
 * Personal CPI service (Spec 04 §9): projection in, pure computation out.
 *
 * Deliberately thin — the three repository reads and one call into the pure
 * engine. Anything smarter (caching, partial recomputation) belongs nowhere
 * until profiling says otherwise: personal data volumes are tiny (a heavy
 * user logs a few thousand entries per year) and the engine is
 * O(entries + products × months) — single-digit milliseconds. A persistent
 * cache would add invalidation complexity (every new entry, merge, or
 * settings change invalidates) for no measurable gain.
 *
 * Correction to Spec 04 §9's literal text, aligned with the codebase rules
 * rather than the snippet: the service takes `db` as its first parameter
 * like every other service (AGENTS.md §1.5 — the app layer passes the
 * singleton, tests pass a throwaway database) and does not wrap itself in
 * React's cache() (services never import react). The per-request
 * memoization the spec asks for belongs to the dashboard page (Spec 05),
 * which can wrap this call in cache() where the several server components
 * that share it live.
 */
import type { Db } from '@/lib/db/client';
import { listEntriesForIndex } from '@/lib/db/repositories/price-entries';
import { listProductsForIndex } from '@/lib/db/repositories/products';
import { getUserSettings } from '@/lib/db/repositories/settings';
import {
  computePersonalCpi,
  type IndexEntry,
  type IndexProduct,
  type IndexSettings,
  type PersonalCpiResult,
} from '@/lib/inflation';

export interface IndexInputs {
  entries: IndexEntry[];
  products: IndexProduct[];
  settings: IndexSettings;
}

/**
 * The three projections the engine consumes, read once. Exported so the
 * dashboard read model (Spec 05) can derive its thin-data stats and mover
 * sparklines from the same rows instead of reading the entries twice.
 */
export async function loadIndexInputs(db: Db, userId: string): Promise<IndexInputs> {
  const [settings, entries, products] = await Promise.all([
    getUserSettings(db, userId),
    listEntriesForIndex(db, userId),
    listProductsForIndex(db, userId),
  ]);
  return {
    entries,
    products,
    settings: {
      includePromosInIndex: settings.includePromosInIndex,
      carryForwardMonths: settings.carryForwardMonths,
    },
  };
}

/** Compute the personal CPI for a user from their full entry history. */
export async function getPersonalCpi(db: Db, userId: string): Promise<PersonalCpiResult> {
  return computePersonalCpi(await loadIndexInputs(db, userId));
}
