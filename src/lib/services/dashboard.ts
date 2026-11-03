/**
 * Read model of the dashboard: the engine's result shaped
 * for the hero, the coverage line, the 12-month trend with the ISTAT
 * overlay rebased to the user's base month, the category breakdown on the
 * hero's horizon, and the top movers with their sparkline points.
 *
 * Design: the official series is a static import of data/istat-nic.json
 * (AGENTS.md §4.27) — the dashboard never fetches ISTAT at runtime.
 */

import type { Db } from '@/lib/db/client';
import type { CategoryId } from '@/lib/domain/categories';
import {
  BASE_INDEX,
  computeMonthlyMeans,
  computePersonalCpi,
  type IndexEntry,
  type IndexProduct,
  type PersonalCpiResult,
  rebaseIstat,
} from '@/lib/inflation';
import istatNic from '../../../data/istat-nic.json';
import { loadIndexInputs } from './inflation';

/** Months plotted by the trend chart. */
const TREND_MONTHS = 12;
/** How many movers the dashboard lists. */
const TOP_MOVERS = 5;
/**
 * Months of series needed before YoY becomes the headline: the first month
 * with a year-ago point is the 13th.
 */
const YOY_MIN_MONTHS = 13;
/** Month-over-month links inside a year-over-year change. */
const YOY_LINKS = YOY_MIN_MONTHS - 1;

export type HeadlineKind = 'yoy' | 'sinceStart';

export interface DashboardHeadline {
  kind: HeadlineKind;
  /** The hero ratio (0.042 = +4.2%). */
  ratio: number;
  momRatio: number;
  /** The partner stat: since-start when YoY is the hero, YoY (or null) otherwise. */
  partnerRatio: number | null;
  indexValue: number;
  baseMonth: string;
  latestMonth: string;
}

export interface DashboardMover {
  productId: string;
  name: string;
  brand: string | null;
  category: CategoryId;
  ratio: number;
  /** Monthly mean unit prices between the mover's from and to months, on the stores it compares. */
  sparkline: number[];
}

export type DashboardData =
  | { state: 'empty' }
  | {
      state: 'thin';
      entryCount: number;
      productCount: number;
      totalSpentCents: number;
    }
  | {
      state: 'ready';
      headline: DashboardHeadline;
      coverage: {
        productsCompared: number;
        categoriesCovered: number;
        productsWithoutLatestPrice: number;
      };
      trend: Array<{ month: string; value: number }>;
      /** ISTAT rebased to the user's base month; null when the months do not overlap. */
      istat: Array<{ month: string; value: number }> | null;
      /** A null ratio: no price of the category was actually compared on this horizon. */
      categories: Array<{ category: CategoryId; ratio: number | null }>;
      movers: DashboardMover[];
    };

/** Everything the dashboard renders, in one read. */
export async function getDashboardData(db: Db, userId: string): Promise<DashboardData> {
  const inputs = await loadIndexInputs(db, userId);
  if (inputs.entries.length === 0) {
    return { state: 'empty' };
  }

  const result = computePersonalCpi(inputs);
  if (result.series.length < 2 || !result.headline) {
    return {
      state: 'thin',
      entryCount: inputs.entries.length,
      productCount: new Set(inputs.entries.map((entry) => entry.productId)).size,
      totalSpentCents: inputs.entries.reduce(
        (sum, entry) => sum + entry.totalPriceCents * entry.quantity,
        0,
      ),
    };
  }

  const headline = buildHeadline(result);
  const trend = result.series.slice(-TREND_MONTHS).map((point) => ({
    month: point.ym,
    value: point.index,
  }));

  return {
    state: 'ready',
    headline,
    coverage: {
      productsCompared: result.coverage.productsCompared,
      categoriesCovered: result.coverage.categoriesCovered,
      productsWithoutLatestPrice: result.coverage.productsWithoutLatestPrice,
    },
    trend,
    istat: buildIstatOverlay(
      result.series[0].ym,
      trend.map((point) => point.month),
    ),
    categories: buildCategoryRatios(result, headline.kind),
    movers: buildMovers(result, inputs.entries, inputs.products),
  };
}

function buildHeadline(result: PersonalCpiResult): DashboardHeadline {
  const headline = result.headline as NonNullable<PersonalCpiResult['headline']>;
  const latest = result.series[result.series.length - 1];
  const hasYoy = result.series.length >= YOY_MIN_MONTHS && headline.yoyPct !== null;
  return {
    kind: hasYoy ? 'yoy' : 'sinceStart',
    ratio: hasYoy ? (headline.yoyPct as number) / 100 : headline.sinceStartPct / 100,
    momRatio: headline.momPct / 100,
    partnerRatio: hasYoy
      ? headline.sinceStartPct / 100
      : headline.yoyPct === null
        ? null
        : headline.yoyPct / 100,
    indexValue: latest.index,
    baseMonth: result.series[0].ym,
    latestMonth: headline.latestYm,
  };
}

/** The official series rebased so the user's base month reads 100, restricted to the plotted months. */
function buildIstatOverlay(
  baseMonth: string,
  months: string[],
): Array<{ month: string; value: number }> | null {
  const rebased = rebaseIstat(istatNic.months as Record<string, number>, baseMonth);
  if (!rebased) {
    return null;
  }
  const overlay = months
    .filter((month) => rebased[month] !== undefined)
    .map((month) => ({ month, value: rebased[month] }));
  return overlay.length > 0 ? overlay : null;
}

/**
 * Each category's change on the same horizon as the hero, sorted descending,
 * with the categories not measured on that horizon last.
 *
 * Why null and not 0: a category whose products were all carried forward chains
 * flat, and "0,0%" would read as "prices held" when nothing was compared at all.
 */
function buildCategoryRatios(
  result: PersonalCpiResult,
  kind: HeadlineKind,
): Array<{ category: CategoryId; ratio: number | null }> {
  const measured: Array<{ category: CategoryId; ratio: number }> = [];
  const notMeasured: Array<{ category: CategoryId; ratio: null }> = [];
  for (const { category, series, comparedMonths } of result.categories) {
    const latest = series[series.length - 1];
    if (!latest || (kind === 'yoy' && latest.yoyPct === null)) {
      continue;
    }
    const horizon = kind === 'yoy' ? series.slice(-YOY_LINKS) : series;
    if (!horizon.some((point) => comparedMonths.includes(point.ym))) {
      notMeasured.push({ category, ratio: null });
    } else if (kind === 'yoy') {
      measured.push({ category, ratio: (latest.yoyPct as number) / 100 });
    } else {
      measured.push({ category, ratio: (latest.index - BASE_INDEX) / BASE_INDEX });
    }
  }
  return [...measured.sort((a, b) => b.ratio - a.ratio), ...notMeasured];
}

/** The TOP_MOVERS largest absolute movers, each with its observed monthly means. */
function buildMovers(
  result: PersonalCpiResult,
  entries: IndexEntry[],
  products: IndexProduct[],
): DashboardMover[] {
  const top = [...result.movers]
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, TOP_MOVERS);
  if (top.length === 0) {
    return [];
  }
  const brandById = new Map(products.map((product) => [product.id, product.brand] as const));
  return top.map((mover) => {
    // Why the mover's stores only: the line must tell the same story as the
    // badge beside it, which compares those stores and no others.
    const series = computeMonthlyMeans(
      entries,
      (entry) => entry.productId === mover.productId && mover.storeIds.includes(entry.storeId),
    );
    return {
      productId: mover.productId,
      name: mover.name,
      brand: brandById.get(mover.productId) ?? null,
      category: mover.category,
      ratio: mover.pct / 100,
      sparkline: series
        .filter(({ month }) => month >= mover.fromYm && month <= mover.toYm)
        .map(({ value }) => value),
    };
  });
}
