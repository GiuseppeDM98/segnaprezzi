'use client';

/**
 * The top of a product's detail: the unit-price chart with its promo dots
 * and range toggle, then the stat tiles (lowest, highest, mean, last).
 * Which months are drawn is decided in chart-window.ts; the chosen range is
 * the screen's state, passed in, so this component only renders.
 */
import { useLocale, useTranslations } from 'next-intl';

import { AreaChart } from '@/components/charts/area-chart';
import { SectionHeading } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import type { UnitKind } from '@/lib/domain/units';
import { type AppLocale, buildUnitPriceFormatter, formatDate } from '@/lib/format';
import type { ProductDetail } from '@/lib/services/product-detail';
import {
  type ChartRange,
  hasOlderMonths,
  selectChartWindow,
  seriesEndpoints,
} from './chart-window';

/** The tiles in reading order; each names a key of ProductDetail['stats']. */
const STAT_KEYS = ['min', 'max', 'mean', 'last'] as const;

export interface PriceOverviewProps {
  productName: string;
  unitKind: UnitKind;
  monthlySeries: ProductDetail['monthlySeries'];
  promoMarkers: ProductDetail['promoMarkers'];
  /** Null when the product has no observation to compute them from; the tiles are then omitted. */
  stats: ProductDetail['stats'];
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
}

/** Render the chart section and, when there are stats, the tiles below it. */
export function PriceOverview({
  productName,
  unitKind,
  monthlySeries,
  promoMarkers,
  stats,
  range,
  onRangeChange,
}: PriceOverviewProps) {
  const t = useTranslations('productDetail');
  const locale = useLocale() as AppLocale;
  const formatPrice = buildUnitPriceFormatter(unitKind, locale);
  const { series, markers } = selectChartWindow(monthlySeries, promoMarkers, range);
  const endpoints = seriesEndpoints(series);

  return (
    <>
      <section className="flex flex-col gap-3">
        <SectionHeading
          trailing={
            hasOlderMonths(monthlySeries) ? (
              <Segmented<ChartRange>
                label={t('rangeLabel')}
                value={range}
                onChange={onRangeChange}
                options={[
                  { value: '12', label: t('range12') },
                  { value: 'all', label: t('rangeAll') },
                ]}
                className="-mb-1 w-40"
              />
            ) : undefined
          }
        >
          {t('chartTitle')}
        </SectionHeading>
        <AreaChart
          series={series}
          markers={markers}
          formatValue={formatPrice}
          seriesLabel={t('chartSeries')}
          ariaSummary={t('chartSummary', {
            name: productName,
            from: formatPrice(endpoints.from),
            to: formatPrice(endpoints.to),
            months: series.length,
          })}
          height={200}
        />
      </section>

      {stats && (
        <section
          aria-label={t('chartTitle')}
          className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-border bg-border tablet:grid-cols-4"
        >
          {STAT_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1 bg-surface px-3 py-3">
              <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                {t(`stats.${key}`)}
              </span>
              <span className="font-mono font-semibold text-[17px] text-text tabular-nums">
                {formatPrice(stats[key].unitPriceMilli)}
              </span>
              {stats[key].recordedAt !== undefined && (
                <span className="font-sans text-[12px] text-text-muted">
                  {formatDate(stats[key].recordedAt as number, locale)}
                </span>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
