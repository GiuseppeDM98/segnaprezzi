'use client';

/**
 * Client half of the timeline. The screen owns the data: the active
 * filters, the loaded entries and their cursor, re-fetching the first page
 * when the filters change, cursor pagination through an IntersectionObserver
 * sentinel, retrying whichever request failed, and the edit/delete actions
 * behind the shared entry sheet. What it renders lives beside it: the filter
 * chips and their pickers (history-filter-bar), the day groups
 * (history-timeline), and the error, empty and end-of-list states
 * (history-list-states).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EntrySheet,
  type EntrySheetEntry,
  type EntrySheetSaveInput,
} from '@/components/entries/entry-sheet';
import { useToast } from '@/components/ui/toast';
import { callAction, describeActionError } from '@/lib/call-action';
import { useRouter } from '@/lib/i18n/navigation';
import type { HistoryEntry, HistoryFilters, HistoryPage } from '@/lib/services/history';
import { deletePriceEntry, updatePriceEntry } from '../products/[id]/actions';
import { loadHistoryPage } from './actions';
import { HistoryFilterBar } from './history-filter-bar';
import { HistoryEmpty, HistoryListFooter, HistoryLoadError } from './history-list-states';
import { HistoryTimeline } from './history-timeline';

export interface HistoryScreenProps {
  firstPage: HistoryPage;
  stores: Array<{ id: string; name: string }>;
}

/** The request whose failure is on screen, so the retry button repeats that one. */
type FailedRequest = 'first-page' | 'next-page' | null;

export function HistoryScreen({ firstPage, stores }: HistoryScreenProps) {
  const t = useTranslations('history');
  const tDetail = useTranslations('productDetail');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const { toast } = useToast();

  const [filters, setFilters] = useState<HistoryFilters>({});
  const [entries, setEntries] = useState<HistoryEntry[]>(firstPage.entries);
  const [nextCursor, setNextCursor] = useState<string | null>(firstPage.nextCursor);
  const [isLoading, setIsLoading] = useState(false);
  const [failedRequest, setFailedRequest] = useState<FailedRequest>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [activeEntry, setActiveEntry] = useState<EntrySheetEntry | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const now = useMemo(() => Date.now(), []);
  const hasFilters = Object.keys(filters).length > 0;

  /*
   * Re-fetch from the first page whenever the filters change, or when a
   * failed first page is retried: the filters are then unchanged, so
   * reloadCount is what makes the effect run again.
   */
  const filtersKey = JSON.stringify(filters);
  const isFirstRender = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount is the retry trigger.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    let isCancelled = false;
    setIsLoading(true);
    setFailedRequest(null);
    void callAction('loadHistoryPage', loadHistoryPage({ filters: JSON.parse(filtersKey) })).then(
      (result) => {
        if (isCancelled) {
          return;
        }
        setIsLoading(false);
        if (!result.ok) {
          setFailedRequest('first-page');
          return;
        }
        setEntries(result.data.entries);
        setNextCursor(result.data.nextCursor);
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [filtersKey, reloadCount]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoading) {
      return;
    }
    setIsLoading(true);
    setFailedRequest(null);
    const result = await callAction(
      'loadHistoryPage',
      loadHistoryPage({ filters, cursor: nextCursor }),
    );
    setIsLoading(false);
    if (!result.ok) {
      setFailedRequest('next-page');
      return;
    }
    setEntries((current) => [...current, ...result.data.entries]);
    setNextCursor(result.data.nextCursor);
  }, [filters, nextCursor, isLoading]);

  /** Repeat the request that failed: the same cursor page, or the first page again. */
  function handleRetry(): void {
    if (failedRequest === 'next-page') {
      void loadMore();
      return;
    }
    setReloadCount((count) => count + 1);
  }

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor) {
      return;
    }
    const observer = new IntersectionObserver((observed) => {
      if (observed[0]?.isIntersecting) {
        void loadMore();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  async function handleSaveEntry(entryId: string, input: EntrySheetSaveInput): Promise<boolean> {
    const result = await callAction('updatePriceEntry', updatePriceEntry({ entryId, ...input }));
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, tDetail('saveError')),
      });
      return false;
    }
    toast({ kind: 'success', message: tDetail('entry.saved') });
    router.refresh();
    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              ...input,
              store: stores.find((store) => store.id === input.storeId) ?? null,
            }
          : entry,
      ),
    );
    return true;
  }

  async function handleDeleteEntry(entryId: string): Promise<boolean> {
    const result = await callAction('deletePriceEntry', deletePriceEntry({ entryId }));
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, tDetail('saveError')),
      });
      return false;
    }
    toast({ kind: 'success', message: tDetail('entry.deleted') });
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    router.refresh();
    return true;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col pt-safe">
      <header className="sticky top-0 z-20 flex flex-col gap-3 border-border border-b border-dashed bg-background/95 px-4 pt-4 pb-3 backdrop-blur-sm">
        <h1 className="font-mono font-semibold text-[12px] text-text-muted uppercase tracking-[0.12em]">
          {t('title')}
        </h1>
        <HistoryFilterBar filters={filters} onFiltersChange={setFilters} stores={stores} />
      </header>

      {failedRequest ? (
        <HistoryLoadError onRetry={handleRetry} />
      ) : entries.length === 0 && !isLoading ? (
        <HistoryEmpty hasFilters={hasFilters} onClearFilters={() => setFilters({})} />
      ) : (
        <HistoryTimeline
          entries={entries}
          now={now}
          onOpenEntry={setActiveEntry}
          footer={<HistoryListFooter hasMore={Boolean(nextCursor)} sentinelRef={sentinelRef} />}
        />
      )}

      <EntrySheet
        entry={activeEntry}
        onClose={() => setActiveEntry(null)}
        stores={stores}
        onSave={handleSaveEntry}
        onDelete={handleDeleteEntry}
      />
    </div>
  );
}
