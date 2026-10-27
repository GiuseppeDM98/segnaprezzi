'use client';

/**
 * Every observation of the product, newest first as the service orders
 * them, one tappable row each: date, promo badge, source and store, the
 * price paid and the unit price. Tapping a row hands the entry to the
 * screen, which opens it in the shared entry sheet.
 */
import { useLocale, useTranslations } from 'next-intl';

import { SOURCE_ICONS } from '@/components/entries/entry-sheet';
import { Chip } from '@/components/ui/chip';
import { SectionHeading } from '@/components/ui/section-heading';
import type { UnitKind } from '@/lib/domain/units';
import {
  type AppLocale,
  buildUnitPriceFormatter,
  formatDate,
  formatMoney,
  formatPackageSize,
} from '@/lib/format';
import type { EntrySummary } from '@/lib/services/product-detail';

/** Render the entries section; `onOpenEntry` is called with the row the user tapped. */
export function PriceHistoryList({
  entries,
  unitKind,
  onOpenEntry,
}: {
  entries: EntrySummary[];
  unitKind: UnitKind;
  onOpenEntry: (entry: EntrySummary) => void;
}) {
  const t = useTranslations('productDetail');
  const locale = useLocale() as AppLocale;
  const formatPrice = buildUnitPriceFormatter(unitKind, locale);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('entriesTitle')}</SectionHeading>
      <ul className="zebra -mx-1" data-testid="entry-list">
        {entries.map((entry) => {
          const SourceIcon = SOURCE_ICONS[entry.source];
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onOpenEntry(entry)}
                data-testid="entry-row"
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent-soft"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-mono text-[13px] text-text tabular-nums">
                    {formatDate(entry.recordedAt, locale)}
                    {entry.isPromo && (
                      <Chip variant="status" tone="promo">
                        {t('promo')}
                      </Chip>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 font-sans text-[12px] text-text-muted">
                    <SourceIcon aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">{t(`source.${entry.source}`)}</span>
                    <span className="truncate">{entry.store?.name ?? t('noStore')}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end font-mono tabular-nums">
                  <span className="font-semibold text-[14px] text-text">
                    {formatMoney(entry.totalPriceCents, locale)}
                  </span>
                  <span className="text-[12px] text-text-muted">
                    {formatPackageSize(entry.packageSize, unitKind, locale)} ·{' '}
                    {formatPrice(entry.unitPriceMilli)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
