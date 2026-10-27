/**
 * Which slice of a product's monthly price series the detail chart shows.
 * By default the chart shows the most recent months only, so a product
 * tracked for years still reads as a recent trend; the range toggle exists
 * only when there is something older to reveal. Pure: the screen renders,
 * these functions decide.
 */

/** The chart's two ranges: the recent window, or every month on record. */
export type ChartRange = '12' | 'all';

/** Months the chart shows in its default range; the toggle appears only beyond it. */
export const RECENT_RANGE_MONTHS = 12;

/** One month of a series, as the service and the chart both shape it. */
export interface MonthPoint {
  /** "YYYY-MM". */
  month: string;
  value: number;
}

/** Whether the series is longer than the recent window, so the range toggle has a job. */
export function hasOlderMonths(monthlySeries: readonly MonthPoint[]): boolean {
  return monthlySeries.length > RECENT_RANGE_MONTHS;
}

/**
 * The months and promo markers to draw for a range.
 *
 * @param monthlySeries Every month with an observation, oldest first.
 * @param promoMarkers Months with a promo observation; only those inside the
 *   visible window are kept, so a dot never floats outside the line.
 * @param range '12' for the last RECENT_RANGE_MONTHS months, 'all' for the whole series.
 */
export function selectChartWindow<P extends MonthPoint>(
  monthlySeries: P[],
  promoMarkers: P[],
  range: ChartRange,
): { series: P[]; markers: P[] } {
  const series = range === '12' ? monthlySeries.slice(-RECENT_RANGE_MONTHS) : monthlySeries;
  const visibleMonths = new Set(series.map((point) => point.month));
  const markers = promoMarkers.filter((marker) => visibleMonths.has(marker.month));
  return { series, markers };
}

/**
 * The first and last values of the visible series, for the chart's spoken
 * summary ("from … to …"). An empty series reads as 0 at both ends.
 */
export function seriesEndpoints(series: readonly MonthPoint[]): { from: number; to: number } {
  return { from: series[0]?.value ?? 0, to: series[series.length - 1]?.value ?? 0 };
}
