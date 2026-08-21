'use client';

/**
 * Client half of the timeline: filter chips (category and
 * store open picker sheets, promo and source are chips), days in Europe/Rome
 * ("Oggi", "Ieri", then the date), shopping sessions grouped under a card
 * with their total, standalone entries as plain rows, cursor pagination
 * through an IntersectionObserver sentinel, and the shared entry sheet.
 */
import { Check, ChevronDown, Store as StoreIcon, Tag as TagIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EntrySheet,
  type EntrySheetEntry,
  type EntrySheetSaveInput,
  SOURCE_ICONS,
} from '@/components/entries/entry-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cx } from '@/lib/cx';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import { ENTRY_SOURCES, type EntrySource } from '@/lib/domain/entries';
import {
  type AppLocale,
  calendarDaysBetween,
  formatDayHeading,
  formatMoney,
  formatTime,
  formatUnitPrice,
} from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import type { HistoryEntry, HistoryFilters, HistoryPage } from '@/lib/services/history';
import { deletePriceEntry, editPriceEntry } from '../products/[id]/actions';
import { loadHistoryPage } from './actions';

export interface HistoryScreenProps {
  firstPage: HistoryPage;
  stores: Array<{ id: string; name: string }>;
}

type PickerKind = 'category' | 'store' | 'source' | null;

export function HistoryScreen({ firstPage, stores }: HistoryScreenProps) {
  const t = useTranslations('history');
  const tDetail = useTranslations('productDetail');
  const tCategories = useTranslations('categories');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();

  const [filters, setFilters] = useState<HistoryFilters>({});
  const [entries, setEntries] = useState<HistoryEntry[]>(firstPage.entries);
  const [nextCursor, setNextCursor] = useState<string | null>(firstPage.nextCursor);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [activeEntry, setActiveEntry] = useState<EntrySheetEntry | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const now = useMemo(() => Date.now(), []);
  const hasFilters = Object.keys(filters).length > 0;

  // Re-fetch from the first page whenever the filters change.
  const filtersKey = JSON.stringify(filters);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    let isCancelled = false;
    setIsLoading(true);
    setHasError(false);
    void loadHistoryPage({ filters: JSON.parse(filtersKey) }).then((result) => {
      if (isCancelled) {
        return;
      }
      setIsLoading(false);
      if (!result.ok) {
        setHasError(true);
        return;
      }
      setEntries(result.data.entries);
      setNextCursor(result.data.nextCursor);
    });
    return () => {
      isCancelled = true;
    };
  }, [filtersKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoading) {
      return;
    }
    setIsLoading(true);
    const result = await loadHistoryPage({ filters, cursor: nextCursor });
    setIsLoading(false);
    if (!result.ok) {
      setHasError(true);
      return;
    }
    setEntries((current) => [...current, ...result.data.entries]);
    setNextCursor(result.data.nextCursor);
  }, [filters, nextCursor, isLoading]);

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
    const result = await editPriceEntry({ entryId, ...input });
    if (!result.ok) {
      toast({ kind: 'error', message: tDetail('saveError') });
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
    const result = await deletePriceEntry({ entryId });
    if (!result.ok) {
      toast({ kind: 'error', message: tDetail('saveError') });
      return false;
    }
    toast({ kind: 'success', message: tDetail('entry.deleted') });
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    router.refresh();
    return true;
  }

  const groups = groupByDay(entries, now, (epochMs, days) =>
    days === 0 ? t('today') : days === 1 ? t('yesterday') : formatDayHeading(epochMs, locale),
  );
  const storeName = filters.storeId
    ? stores.find((store) => store.id === filters.storeId)?.name
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col pt-safe">
      <header className="sticky top-0 z-20 flex flex-col gap-3 border-border border-b border-dashed bg-background/95 px-4 pt-4 pb-3 backdrop-blur-sm">
        <h1 className="font-mono font-semibold text-[12px] text-text-muted uppercase tracking-[0.12em]">
          {t('title')}
        </h1>
        <fieldset className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto border-0 p-0 px-4">
          <legend className="sr-only">{t('filters.label')}</legend>
          <Chip
            variant="filter"
            isSelected={Boolean(filters.category)}
            onClick={() => setPicker('category')}
            onRemove={
              filters.category ? () => setFilters(({ category: _c, ...rest }) => rest) : undefined
            }
            removeLabel={t('filters.remove', { filter: t('filters.category') })}
            icon={<TagIcon />}
            data-testid="filter-category"
          >
            {filters.category ? tCategories(filters.category) : t('filters.category')}
          </Chip>
          <Chip
            variant="filter"
            isSelected={Boolean(filters.storeId)}
            onClick={() => setPicker('store')}
            onRemove={
              filters.storeId ? () => setFilters(({ storeId: _s, ...rest }) => rest) : undefined
            }
            removeLabel={t('filters.remove', { filter: t('filters.store') })}
            icon={<StoreIcon />}
            data-testid="filter-store"
          >
            {storeName ?? t('filters.store')}
          </Chip>
          <Chip
            variant="filter"
            isSelected={filters.isPromo === true}
            onClick={() =>
              setFilters(({ isPromo, ...rest }) => (isPromo ? rest : { ...rest, isPromo: true }))
            }
            data-testid="filter-promo"
          >
            {t('filters.promoOnly')}
          </Chip>
          <Chip
            variant="filter"
            isSelected={Boolean(filters.source)}
            onClick={() => setPicker('source')}
            onRemove={
              filters.source ? () => setFilters(({ source: _s, ...rest }) => rest) : undefined
            }
            removeLabel={t('filters.remove', { filter: t('filters.source') })}
            data-testid="filter-source"
          >
            {filters.source ? tDetail(`source.${filters.source}`) : t('filters.source')}
          </Chip>
        </fieldset>
      </header>

      {hasError ? (
        <EmptyState
          tone="error"
          title={t('error.title')}
          body={t('error.body')}
          action={<Button onClick={() => setFilters({ ...filters })}>{t('loadMore')}</Button>}
        />
      ) : entries.length === 0 && !isLoading ? (
        hasFilters ? (
          <EmptyState
            title={t('filteredEmpty.title')}
            body={t('filteredEmpty.body')}
            data-testid="history-filtered-empty"
            action={
              <Button variant="secondary" onClick={() => setFilters({})}>
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
        )
      ) : (
        <div className="flex flex-col gap-6 pt-4 pb-6" data-testid="timeline">
          {groups.map((group) => (
            <section
              key={group.key}
              aria-labelledby={`day-${group.key}`}
              className="flex flex-col gap-2"
            >
              <h2
                id={`day-${group.key}`}
                className="px-4 font-mono font-semibold text-[12px] text-text-muted uppercase tracking-[0.12em]"
              >
                {group.label}
              </h2>
              <div className="flex flex-col gap-3">
                {group.blocks.map((block) =>
                  block.kind === 'session' ? (
                    <div
                      key={block.key}
                      className="mx-4 overflow-hidden rounded-control border border-border bg-surface"
                      data-testid="session-card"
                    >
                      <div className="flex items-center justify-between gap-3 border-border border-b border-dashed px-3 py-2">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                            {t('session')} · {formatTime(block.startedAt, locale)}
                          </span>
                          <span className="truncate font-sans font-medium text-[15px] text-text">
                            {block.storeName ?? tDetail('noStore')}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end">
                          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                            {t('sessionTotal')}
                          </span>
                          <span className="font-mono font-semibold text-[15px] text-text tabular-nums">
                            {formatMoney(block.totalCents, locale)}
                          </span>
                        </span>
                      </div>
                      <ul className="zebra">
                        {block.entries.map((entry) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            locale={locale}
                            onClick={() => setActiveEntry(entry)}
                          />
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <ul key={block.key} className="zebra">
                      {block.entries.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          locale={locale}
                          onClick={() => setActiveEntry(entry)}
                          isStandalone
                        />
                      ))}
                    </ul>
                  ),
                )}
              </div>
            </section>
          ))}
          {nextCursor ? (
            <div ref={sentinelRef} aria-hidden="true">
              <SkeletonRows count={2} />
            </div>
          ) : (
            <p className="px-4 text-center font-mono text-[12px] text-text-muted">{t('end')}</p>
          )}
        </div>
      )}

      <Sheet
        isOpen={picker === 'category'}
        onClose={() => setPicker(null)}
        title={t('filters.pickCategory')}
      >
        <PickerList
          options={[
            { value: '', label: t('filters.anyCategory') },
            ...CATEGORY_IDS.map((id) => ({ value: id, label: tCategories(id) })),
          ]}
          selected={filters.category ?? ''}
          onPick={(value) => {
            setFilters(({ category: _c, ...rest }) =>
              value ? { ...rest, category: value as CategoryId } : rest,
            );
            setPicker(null);
          }}
        />
      </Sheet>
      <Sheet
        isOpen={picker === 'store'}
        onClose={() => setPicker(null)}
        title={t('filters.pickStore')}
      >
        <PickerList
          options={[
            { value: '', label: t('filters.anyStore') },
            ...stores.map((store) => ({ value: store.id, label: store.name })),
          ]}
          selected={filters.storeId ?? ''}
          onPick={(value) => {
            setFilters(({ storeId: _s, ...rest }) => (value ? { ...rest, storeId: value } : rest));
            setPicker(null);
          }}
        />
      </Sheet>
      <Sheet
        isOpen={picker === 'source'}
        onClose={() => setPicker(null)}
        title={t('filters.pickSource')}
      >
        <PickerList
          options={[
            { value: '', label: t('filters.anySource') },
            ...ENTRY_SOURCES.map((source) => ({
              value: source,
              label: tDetail(`source.${source}`),
            })),
          ]}
          selected={filters.source ?? ''}
          onPick={(value) => {
            setFilters(({ source: _s, ...rest }) =>
              value ? { ...rest, source: value as EntrySource } : rest,
            );
            setPicker(null);
          }}
        />
      </Sheet>

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

function EntryRow({
  entry,
  locale,
  onClick,
  isStandalone = false,
}: {
  entry: HistoryEntry;
  locale: AppLocale;
  onClick: () => void;
  isStandalone?: boolean;
}) {
  const tDetail = useTranslations('productDetail');
  const SourceIcon = SOURCE_ICONS[entry.source];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid="history-row"
        className={cx(
          'flex min-h-12 w-full items-center gap-3 py-1.5 text-left transition-colors hover:bg-accent-soft',
          isStandalone ? 'px-4' : 'px-3',
        )}
      >
        {/* The rigid margin column of the printout: the time, always in the same place. */}
        <span className="w-11 shrink-0 border-border border-r border-dashed font-mono text-[11px] text-text-muted tabular-nums">
          {formatTime(entry.recordedAt, locale)}
        </span>
        <SourceIcon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
        <span className="sr-only">{tDetail(`source.${entry.source}`)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="line-clamp-2 font-mono text-[13px] text-text leading-snug">
              {entry.product.name}
            </span>
            {entry.isPromo && (
              <Chip variant="status" tone="promo">
                {tDetail('promo')}
              </Chip>
            )}
          </span>
          {isStandalone && entry.store && (
            <span className="truncate font-sans text-[12px] text-text-muted">
              {entry.store.name}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end font-mono tabular-nums">
          <span className="font-semibold text-[14px] text-text">
            {formatMoney(entry.totalPriceCents, locale)}
          </span>
          <span className="text-[11px] text-text-muted">
            {formatUnitPrice(entry.unitPriceMilli, entry.product.unitKind, locale)}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 -rotate-90 text-text-muted" />
      </button>
    </li>
  );
}

function PickerList({
  options,
  selected,
  onPick,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onPick: (value: string) => void;
}) {
  return (
    <ul className="zebra -mx-2 max-h-[60dvh] overflow-y-auto rounded-control">
      {options.map((option) => (
        <li key={option.value}>
          <button
            type="button"
            onClick={() => onPick(option.value)}
            aria-pressed={selected === option.value}
            className={cx(
              'flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left font-sans text-[15px] text-text hover:bg-accent-soft',
              selected === option.value && 'font-semibold',
            )}
          >
            {option.label}
            {selected === option.value && (
              <Check aria-hidden="true" className="size-4 text-accent-ink" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface DayGroup {
  key: string;
  label: string;
  blocks: Array<
    | {
        kind: 'session';
        key: string;
        storeName: string | null;
        startedAt: number;
        totalCents: number;
        entries: HistoryEntry[];
      }
    | { kind: 'plain'; key: string; entries: HistoryEntry[] }
  >;
}

/**
 * Group newest-first entries by Europe/Rome day; inside a day, consecutive
 * entries of the same shopping session fold into one session block.
 */
function groupByDay(
  entries: HistoryEntry[],
  now: number,
  labelOf: (epochMs: number, days: number) => string,
): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const days = calendarDaysBetween(entry.recordedAt, now);
    const key = String(days);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: labelOf(entry.recordedAt, days), blocks: [] };
      groups.push(group);
    }
    const lastBlock = group.blocks[group.blocks.length - 1];
    if (entry.sessionId) {
      if (lastBlock?.kind === 'session' && lastBlock.key === entry.sessionId) {
        lastBlock.entries.push(entry);
        lastBlock.totalCents += entry.totalPriceCents;
        lastBlock.startedAt = Math.min(lastBlock.startedAt, entry.recordedAt);
      } else {
        group.blocks.push({
          kind: 'session',
          key: entry.sessionId,
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
