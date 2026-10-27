'use client';

/**
 * What the timeline shows besides its rows: the load error with its retry
 * button, the empty states (nothing recorded yet, or nothing matching the
 * filters), and the footer after the last day (the pagination sentinel
 * while more pages exist, the end line once they do not). Each one only
 * renders; deciding which applies, and repeating a failed request, stay
 * with the screen.
 */
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRows } from '@/components/ui/skeleton';

/** The error card shown in place of the timeline when a page failed to load. */
export function HistoryLoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('history');
  const tCommon = useTranslations('common');
  return (
    <EmptyState
      tone="error"
      title={t('error.title')}
      body={t('error.body')}
      action={<Button onClick={onRetry}>{tCommon('retry')}</Button>}
    />
  );
}

/**
 * The empty timeline: with filters on, an invitation to clear them;
 * without, the first-run invitation to scan or import a receipt.
 */
export function HistoryEmpty({
  hasFilters,
  onClearFilters,
}: {
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const t = useTranslations('history');
  return hasFilters ? (
    <EmptyState
      title={t('filteredEmpty.title')}
      body={t('filteredEmpty.body')}
      data-testid="history-filtered-empty"
      action={
        <Button variant="secondary" onClick={onClearFilters}>
          {t('filters.clear')}
        </Button>
      }
    />
  ) : (
    <EmptyState
      title={t('empty.title')}
      body={t('empty.body')}
      data-testid="history-empty"
      action={<Button href="/scan">{t('empty.cta')}</Button>}
      secondaryAction={
        <Button href="/add/receipt" variant="ghost">
          {t('empty.receiptCta')}
        </Button>
      }
    />
  );
}

/**
 * The end of the timeline. While another page exists it is the skeleton
 * the screen's IntersectionObserver watches through `sentinelRef`, so
 * scrolling it into view loads the next page; afterwards it is the end line.
 */
export function HistoryListFooter({
  hasMore,
  sentinelRef,
}: {
  hasMore: boolean;
  sentinelRef: Ref<HTMLDivElement>;
}) {
  const t = useTranslations('history');
  return hasMore ? (
    <div ref={sentinelRef} aria-hidden="true">
      <SkeletonRows count={2} />
    </div>
  ) : (
    <p className="px-4 text-center font-mono text-[12px] text-text-muted">{t('end')}</p>
  );
}
