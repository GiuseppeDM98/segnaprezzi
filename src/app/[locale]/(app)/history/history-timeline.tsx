'use client';

/**
 * The timeline itself: the loaded entries grouped by Europe/Rome day, each
 * day under its heading ("Today", "Yesterday", then the date), the entries
 * of one shopping session folded into a card with the session total, and
 * standalone entries as plain rows. The grouping rule is pure and lives in
 * src/lib/domain/history-groups.ts; this file owns the labels and the rows.
 * It loads nothing: what comes after the last day (the pagination sentinel
 * or the end line) is passed in as `footer`.
 */
import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SOURCE_ICONS } from '@/components/entries/entry-sheet';
import { Chip } from '@/components/ui/chip';
import { cx } from '@/lib/cx';
import { groupEntriesByDay, type HistoryDayGroup } from '@/lib/domain/history-groups';
import {
  type AppLocale,
  calendarDaysBetween,
  formatDayHeading,
  formatMoney,
  formatTime,
  formatUnitPrice,
} from '@/lib/format';
import type { HistoryEntry } from '@/lib/services/history';

export interface HistoryTimelineProps {
  entries: HistoryEntry[];
  /** Epoch ms the day distances are measured from, fixed for the life of the screen. */
  now: number;
  /** Called with the row the user tapped, to open it in the entry sheet. */
  onOpenEntry: (entry: HistoryEntry) => void;
  /** Rendered after the last day, inside the timeline. */
  footer: ReactNode;
}

/** Render the entries as day sections of session cards and plain rows. */
export function HistoryTimeline({ entries, now, onOpenEntry, footer }: HistoryTimelineProps) {
  const t = useTranslations('history');
  const tDetail = useTranslations('productDetail');
  const locale = useLocale() as AppLocale;

  const groups = groupEntriesByDay(entries, (epochMs) => calendarDaysBetween(epochMs, now));
  const dayLabel = (group: HistoryDayGroup<HistoryEntry>): string =>
    group.daysAgo === 0
      ? t('today')
      : group.daysAgo === 1
        ? t('yesterday')
        : formatDayHeading(group.dayEpochMs, locale);

  return (
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
            {dayLabel(group)}
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
                        onClick={() => onOpenEntry(entry)}
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
                      onClick={() => onOpenEntry(entry)}
                      isStandalone
                    />
                  ))}
                </ul>
              ),
            )}
          </div>
        </section>
      ))}
      {footer}
    </div>
  );
}

/**
 * One entry as a tappable row. Inside a session card the store is already in
 * the card header, so only a standalone row names it.
 */
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
