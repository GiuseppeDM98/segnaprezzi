'use client';

/**
 * Where this product costs least: each store's latest unit price, cheapest
 * first, the first row marked as the best. The ordering, and the rule that
 * a comparison needs more than one store, come from the product-detail
 * service; with no rows the section renders nothing.
 */
import { useLocale, useTranslations } from 'next-intl';

import { Chip } from '@/components/ui/chip';
import { SectionHeading } from '@/components/ui/section-heading';
import type { UnitKind } from '@/lib/domain/units';
import { type AppLocale, buildUnitPriceFormatter, formatDate } from '@/lib/format';
import type { StoreComparison } from '@/lib/services/product-detail';

/** Render the per-store comparison list, or nothing when there is no comparison to make. */
export function StoreComparisonSection({
  rows,
  unitKind,
}: {
  /** Cheapest first, as the service returns them. */
  rows: StoreComparison[];
  unitKind: UnitKind;
}) {
  const t = useTranslations('productDetail');
  const locale = useLocale() as AppLocale;
  const formatPrice = buildUnitPriceFormatter(unitKind, locale);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('storesTitle')}</SectionHeading>
      <ol className="zebra -mx-1">
        {rows.map((row, index) => (
          <li key={row.storeId} className="flex min-h-12 items-center justify-between gap-3 px-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-sans text-[15px] text-text">{row.storeName}</span>
              {index === 0 && (
                <Chip variant="status" tone="positive">
                  {t('best')}
                </Chip>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="font-mono font-semibold text-[14px] text-text tabular-nums">
                {formatPrice(row.latestUnitPriceMilli)}
              </span>
              <span className="font-sans text-[11px] text-text-muted">
                {formatDate(row.recordedAt, locale)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
