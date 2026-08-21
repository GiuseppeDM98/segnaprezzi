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
  computePersonalCpi,
  type IndexEntry,
  type IndexProduct,
  type PersonalCpiResult,
  rebaseIstat,
  toRomeYearMonth,
} from '@/lib/inflation';
import istatNic from '../../../data/istat-nic.json';
import { loadIndexInputs } from './inflation';

/** Months plotted by the trend chart. */
const TREND_MONTHS = 12;
/** How many movers the dashboard lists. */
const TOP_MOVERS = 5;
/** Years needed before YoY becomes the headline (13 months of series). */
const YOY_MIN_MONTHS = 13;

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
  /** Monthly mean unit prices between the mover's from and to months. */
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
      coverage: { productsCompared: number; categoriesCovered: number; imputedShare: number };
      trend: Array<{ month: string; value: number }>;
      /** ISTAT rebased to the user's base month; null when the months do not overlap. */
      istat: Array<{ month: string; value: number }> | null;
      categories: Array<{ category: CategoryId; ratio: number }>;
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
      imputedShare: result.coverage.imputedShare,
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

/** Each category's change on the same horizon as the hero, sorted descending. */
function buildCategoryRatios(
  result: PersonalCpiResult,
  kind: HeadlineKind,
): Array<{ category: CategoryId; ratio: number }> {
  const ratios: Array<{ category: CategoryId; ratio: number }> = [];
  for (const category of result.categories) {
    const latest = category.series[category.series.length - 1];
    if (!latest) {
      continue;
    }
    if (kind === 'yoy') {
      if (latest.yoyPct !== null) {
        ratios.push({ category: category.category, ratio: latest.yoyPct / 100 });
      }
      continue;
    }
    ratios.push({ category: category.category, ratio: (latest.index - 100) / 100 });
  }
  return ratios.sort((a, b) => b.ratio - a.ratio);
}

/** The five largest absolute movers, each with its observed monthly means. */
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
  const means = monthlyMeansByProduct(entries, new Set(top.map((mover) => mover.productId)));
  const brandById = new Map(products.map((product) => [product.id, product.brand] as const));
  return top.map((mover) => {
    const series = means.get(mover.productId) ?? [];
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

/** Observed monthly mean unit price per product (Europe/Rome months), oldest first. */
function monthlyMeansByProduct(
  entries: IndexEntry[],
  productIds: Set<string>,
): Map<string, Array<{ month: string; value: number }>> {
  const sums = new Map<string, Map<string, { total: number; count: number }>>();
  for (const entry of entries) {
    if (!productIds.has(entry.productId)) {
      continue;
    }
    const month = toRomeYearMonth(entry.recordedAt);
    const byMonth = sums.get(entry.productId) ?? new Map();
    const slot = byMonth.get(month) ?? { total: 0, count: 0 };
    slot.total += entry.unitPriceMilli;
    slot.count += 1;
    byMonth.set(month, slot);
    sums.set(entry.productId, byMonth);
  }
  const means = new Map<string, Array<{ month: string; value: number }>>();
  for (const [productId, byMonth] of sums) {
    means.set(
      productId,
      [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, { total, count }]) => ({ month, value: total / count })),
    );
  }
  return means;
}
