/**
 * How the timeline lays entries out: one group per calendar day, and inside
 * a day, the entries of one shopping session folded into a single block that
 * carries the session's total. Pure — no imports; the caller supplies the
 * calendar (Europe/Rome day distance) so the grouping is testable without a
 * clock or a time zone database.
 */

/** The fields of a timeline entry the grouping reads. */
export interface GroupableEntry {
  id: string;
  /** Epoch ms. */
  recordedAt: number;
  /** The shopping session the entry was confirmed in, or null for a standalone entry. */
  sessionId: string | null;
  totalPriceCents: number;
  store: { name: string } | null;
}

/** A run of consecutive entries from one shopping session. */
export interface SessionBlock<E extends GroupableEntry> {
  kind: 'session';
  /** Unique among the blocks of a day, even when one session appears in two runs. */
  key: string;
  sessionId: string;
  storeName: string | null;
  /** Epoch ms of the run's earliest entry. */
  startedAt: number;
  totalCents: number;
  entries: E[];
}

/** A run of consecutive standalone entries. */
export interface PlainBlock<E extends GroupableEntry> {
  kind: 'plain';
  key: string;
  entries: E[];
}

export type HistoryBlock<E extends GroupableEntry> = SessionBlock<E> | PlainBlock<E>;

/** One calendar day of the timeline. */
export interface HistoryDayGroup<E extends GroupableEntry> {
  key: string;
  /** Whole calendar days before "now": 0 is today, 1 yesterday. */
  daysAgo: number;
  /** Epoch ms of the day's newest entry, for formatting the day heading. */
  dayEpochMs: number;
  blocks: HistoryBlock<E>[];
}

/**
 * Group newest-first entries by calendar day; inside a day, consecutive
 * entries of the same shopping session fold into one session block with
 * their summed total, and consecutive standalone entries share a plain block.
 *
 * Only consecutive entries fold: a standalone entry recorded in the middle of
 * a session splits it into two runs, because the timeline is in time order
 * and a block must not hide an entry that happened between its rows.
 *
 * @param entries - Timeline entries, newest first (the order the pages arrive in)
 * @param daysAgoOf - Whole calendar days between an entry's epoch ms and now
 * @returns The day groups, newest day first
 */
export function groupEntriesByDay<E extends GroupableEntry>(
  entries: E[],
  daysAgoOf: (epochMs: number) => number,
): HistoryDayGroup<E>[] {
  const groups: HistoryDayGroup<E>[] = [];
  for (const entry of entries) {
    const daysAgo = daysAgoOf(entry.recordedAt);
    let group = groups[groups.length - 1];
    if (!group || group.daysAgo !== daysAgo) {
      group = { key: String(daysAgo), daysAgo, dayEpochMs: entry.recordedAt, blocks: [] };
      groups.push(group);
    }

    const lastBlock = group.blocks[group.blocks.length - 1];
    if (entry.sessionId) {
      if (lastBlock?.kind === 'session' && lastBlock.sessionId === entry.sessionId) {
        lastBlock.entries.push(entry);
        lastBlock.totalCents += entry.totalPriceCents;
        lastBlock.startedAt = Math.min(lastBlock.startedAt, entry.recordedAt);
      } else {
        group.blocks.push({
          kind: 'session',
          key: `session-${entry.id}`,
          sessionId: entry.sessionId,
          storeName: entry.store?.name ?? null,
          startedAt: entry.recordedAt,
          totalCents: entry.totalPriceCents,
          entries: [entry],
        });
      }
    } else if (lastBlock?.kind === 'plain') {
      lastBlock.entries.push(entry);
    } else {
      group.blocks.push({ kind: 'plain', key: `plain-${entry.id}`, entries: [entry] });
    }
  }
  return groups;
}
