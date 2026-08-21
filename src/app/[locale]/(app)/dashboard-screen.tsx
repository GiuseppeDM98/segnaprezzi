'use client';

/**
 * Client half of the dashboard: the hero ticker, the trend
 * chart with its ISTAT toggle (persisted per device), the category bars and
 * the top movers. Every number arrives as a ratio/integer and is rendered
 * through src/lib/format.ts here — nothing is formatted upstream.
 */
import { Camera, Fuel, PencilLine, ReceiptText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { AreaChart } from '@/components/charts/area-chart';
import { CategoryBars } from '@/components/charts/category-bars';
import { NumberTicker } from '@/components/charts/number-ticker';
import { Sparkline } from '@/components/charts/sparkline';
import { priceDirectionOf, TrendBadge } from '@/components/charts/trend-badge';
import { CachedDataBanner } from '@/components/layout/cached-data-banner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { LogoMark } from '@/components/ui/logo-mark';
import { SectionHeading } from '@/components/ui/section-heading';
import { cx } from '@/lib/cx';
import {
  type AppLocale,
  formatCount,
  formatIndexValue,
  formatMoney,
  formatMonth,
  formatPct,
} from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import type { DashboardData } from '@/lib/services/dashboard';

/** localStorage key of the ISTAT overlay toggle (persists per device, §5.1). */
const ISTAT_TOGGLE_KEY = 'segnaprezzi.dashboard.istat';

export interface DashboardScreenProps {
  data: DashboardData;
  /** Epoch ms the server computed these numbers; drives the offline banner. */
  generatedAt: number;
}

export function DashboardScreen({ data, generatedAt }: DashboardScreenProps) {
  const t = useTranslations('dashboard');

  if (data.state === 'empty') {
    return <EmptyDashboard />;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-safe pb-4 tablet:px-8 tablet:pt-6">
      <div className="flex flex-col gap-3 pt-4 tablet:pt-0">
        <SectionHeading as="h1">{t('title')}</SectionHeading>
        <CachedDataBanner generatedAt={generatedAt} />
      </div>

      {data.state === 'thin' ? (
        <ThinDashboard data={data} />
      ) : (
        <div className="grid gap-8 tablet:grid-cols-[2fr_1fr] tablet:gap-x-10 tablet:gap-y-12">
          <div className="flex flex-col gap-7">
            <Hero data={data} />
            <TrendSection data={data} />
          </div>
          <div className="flex flex-col gap-10">
            <CategorySection data={data} />
            <MoversSection data={data} />
          </div>
        </div>
      )}

      <QuickActions />
    </div>
  );
}

type ReadyData = Extract<DashboardData, { state: 'ready' }>;
type ThinData = Extract<DashboardData, { state: 'thin' }>;

const HERO_DIRECTION_CLASSES = {
  up: 'text-negative',
  down: 'text-positive',
  flat: 'text-text',
} as const;

function Hero({ data }: { data: ReadyData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;
  const { headline, coverage } = data;
  const direction = priceDirectionOf(headline.ratio);

  const chips: Array<{ label: string; value: string; caption?: string }> = [
    { label: t('mom'), value: formatPct(headline.momRatio, locale) },
  ];
  if (headline.partnerRatio !== null) {
    chips.push({
      label: headline.kind === 'yoy' ? t('sinceStart') : t('yoy'),
      value: formatPct(headline.partnerRatio, locale),
    });
  }
  chips.push({
    label: t('indexValue'),
    value: formatIndexValue(headline.indexValue, locale),
    caption: t('indexBase', { month: formatMonth(headline.baseMonth, locale) }),
  });

  return (
    <section
      aria-labelledby="hero-label"
      className="flex flex-col gap-4"
      data-testid="dashboard-hero"
    >
      <p id="hero-label" className="font-sans text-[15px] text-text-muted">
        {headline.kind === 'yoy' ? t('heroYoy') : t('heroSinceStart')}
        <span aria-hidden="true"> · </span>
        <span className="font-mono text-[13px]">
          {t('updatedAt', { month: formatMonth(headline.latestMonth, locale) })}
        </span>
      </p>

      <NumberTicker
        value={formatPct(headline.ratio, locale)}
        className={cx(
          'font-mono font-semibold text-[clamp(4.25rem,21vw,6rem)] leading-none tracking-[-0.04em]',
          HERO_DIRECTION_CLASSES[direction],
        )}
      />

      <dl className="zebra -mx-1 flex flex-col font-mono text-[14px] tabular-nums tablet:flex-row tablet:divide-x tablet:divide-border tablet:[&>*]:flex-1 tablet:[&>:nth-child(odd)]:bg-transparent">
        {chips.map((chip) => (
          <div
            key={chip.label}
            className="flex h-10 items-center justify-between gap-3 px-3 tablet:h-auto tablet:flex-col tablet:items-start tablet:justify-center tablet:gap-1 tablet:py-2"
          >
            <dt className="font-sans text-[13px] text-text-muted">{chip.label}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-semibold text-text">{chip.value}</span>
              {chip.caption && (
                <span className="whitespace-nowrap text-[12px] text-text-muted">
                  {chip.caption}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="font-sans text-[14px] text-text-muted" data-testid="coverage-line">
        {t('coverage', {
          products: coverage.productsCompared,
          categories: coverage.categoriesCovered,
        })}
        {coverage.imputedShare > 0 &&
          t('coverageImputed', {
            pct: formatPct(coverage.imputedShare, locale, { decimals: 0 }).replace('+', ''),
          })}
      </p>
    </section>
  );
}

function TrendSection({ data }: { data: ReadyData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;
  const [isIstatVisible, setIsIstatVisible] = useState(false);

  // Why an effect: localStorage is per device and unknown on the server;
  // reading it during render would mismatch the SSR markup.
  useEffect(() => {
    try {
      setIsIstatVisible(window.localStorage.getItem(ISTAT_TOGGLE_KEY) === '1');
    } catch {
      // Storage blocked: the toggle simply starts off.
    }
  }, []);

  function toggleIstat(): void {
    const next = !isIstatVisible;
    setIsIstatVisible(next);
    try {
      window.localStorage.setItem(ISTAT_TOGGLE_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }

  const first = data.trend[0];
  const last = data.trend[data.trend.length - 1];
  const change = first && last ? last.value / first.value - 1 : 0;

  return (
    <section aria-labelledby="trend-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="trend-heading"
        trailing={
          data.istat ? (
            <Chip
              variant="filter"
              isSelected={isIstatVisible}
              onClick={toggleIstat}
              data-testid="istat-toggle"
              size="sm"
            >
              {t('istat')}
            </Chip>
          ) : undefined
        }
      >
        {t('trendTitle')}
      </SectionHeading>
      <AreaChart
        series={data.trend}
        compareSeries={data.istat ?? undefined}
        isCompareVisible={isIstatVisible}
        formatValue={(value) => formatIndexValue(value, locale)}
        seriesLabel={t('trendSeries')}
        compareLabel={t('istatSeries')}
        ariaSummary={t('trendSummary', {
          months: data.trend.length,
          from: formatIndexValue(first?.value ?? 100, locale),
          to: formatIndexValue(last?.value ?? 100, locale),
          change: formatPct(change, locale),
        })}
        height={220}
      />
    </section>
  );
}

function CategorySection({ data }: { data: ReadyData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;
  return (
    <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
      <SectionHeading id="categories-heading">{t('categoriesTitle')}</SectionHeading>
      <CategoryBars
        items={data.categories}
        formatValue={(ratio) => formatPct(ratio, locale)}
        ariaSummary={t('categoriesSummary', { count: data.categories.length })}
        className="-mx-1"
      />
    </section>
  );
}

function MoversSection({ data }: { data: ReadyData }) {
  const t = useTranslations('dashboard');
  if (data.movers.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="movers-heading" className="flex flex-col gap-3">
      <SectionHeading id="movers-heading">{t('moversTitle')}</SectionHeading>
      <ol className="zebra -mx-1" aria-label={t('moversSummary')}>
        {data.movers.map((mover) => (
          <li key={mover.productId}>
            <Link
              href={`/products/${mover.productId}`}
              className="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-accent-soft"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-mono text-[14px] text-text leading-snug">{mover.name}</span>
                {mover.brand && (
                  <span className="truncate font-sans text-[12px] text-text-muted">
                    {mover.brand}
                  </span>
                )}
              </span>
              <Sparkline
                points={mover.sparkline}
                trend={priceDirectionOf(mover.ratio)}
                width={64}
                height={22}
              />
              <TrendBadge ratio={mover.ratio} size="sm" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function QuickActions() {
  const t = useTranslations('dashboard');
  return (
    <section className="grid grid-cols-2 gap-3 tablet:max-w-md">
      <Button href="/add/manual" variant="secondary" icon={<PencilLine className="size-4" />}>
        {t('quickAddManual')}
      </Button>
      <Button href="/add/fuel" variant="secondary" icon={<Fuel className="size-4" />}>
        {t('quickAddFuel')}
      </Button>
      <Button
        href="/add/receipt"
        variant="secondary"
        icon={<ReceiptText className="size-4" />}
        className="col-span-2"
      >
        {t('quickAddReceipt')}
      </Button>
    </section>
  );
}

function ThinDashboard({ data }: { data: ThinData }) {
  const t = useTranslations('dashboard');
  const locale = useLocale() as AppLocale;
  const facts = [
    { label: t('thin.entries'), value: formatCount(data.entryCount, locale) },
    { label: t('thin.products'), value: formatCount(data.productCount, locale) },
    { label: t('thin.spent'), value: formatMoney(data.totalSpentCents, locale) },
  ];
  return (
    <div className="flex flex-col gap-8" data-testid="dashboard-thin">
      <div className="flex flex-col gap-2">
        <h2 className="text-balance font-sans font-semibold text-2xl text-text leading-tight">
          {t('thin.title')}
        </h2>
        <p className="text-pretty font-sans text-[15px] text-text-muted">{t('thin.body')}</p>
      </div>
      <dl className="zebra -mx-1 font-mono tabular-nums">
        {facts.map((fact) => (
          <div key={fact.label} className="flex h-12 items-center justify-between px-3">
            <dt className="font-sans text-[15px] text-text-muted">{fact.label}</dt>
            <dd className="font-semibold text-[17px] text-text">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex min-h-40 items-center justify-center rounded-control border border-border border-dashed px-6 text-center">
        <p className="text-pretty font-sans text-[14px] text-text-muted">
          {t('thin.chartPlaceholder')}
        </p>
      </div>
    </div>
  );
}

function EmptyDashboard() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  return (
    <div
      className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-md flex-col items-center justify-center gap-8 px-6 pt-safe text-center"
      data-testid="dashboard-empty"
    >
      <div className="flex flex-col items-center gap-5">
        <LogoMark size={72} title={tCommon('appName')} />
        <h1 className="text-balance font-sans font-semibold text-2xl text-text leading-tight">
          {t('empty.title')}
        </h1>
        <p className="text-pretty font-sans text-[15px] text-text-muted leading-relaxed">
          {t('empty.body')}
        </p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Button href="/scan" size="lg" icon={<Camera className="size-5" />}>
          {t('empty.cta')}
        </Button>
        <Button href="/add/manual" variant="ghost">
          {t('empty.secondary')}
        </Button>
      </div>
    </div>
  );
}
