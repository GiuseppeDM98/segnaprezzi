/**
 * Scale and path math for the hand-rolled SVG charts.
 *
 * Design: charts are hand-rolled SVG — no chart library. Two reasons:
 * (1) bundle size: the app is a mobile PWA and every charting dependency
 * costs hundreds of KB for features we don't use; (2) full visual control:
 * the design pass tunes every pixel, which wrapper libraries fight.
 * Tradeoff accepted: we implement scales, paths, and animation ourselves,
 * so this module is pure and unit-tested.
 */

export interface LinearScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

/**
 * Build a linear scale mapping `domain` onto `range`. A degenerate domain
 * (min === max) maps every value to the middle of the range so a flat
 * series still draws a visible line.
 */
export function createLinearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = ((value: number): number =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

/**
 * Pad a [min, max] domain by a fraction of its span on both sides so the
 * line never touches the plot edge; a flat domain gets an absolute pad.
 */
export function padDomain(values: number[], fraction = 0.1): [number, number] {
  if (values.length === 0) {
    return [0, 1];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = span === 0 ? Math.max(Math.abs(min) * 0.05, 1) : span * fraction;
  return [min - pad, max + pad];
}

/** Round a value to 2 decimals — enough for SVG and stable in snapshots. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One plotted point; `y` may be null for a gap in the series. */
export interface PlotPoint {
  x: number;
  y: number | null;
}

/**
 * Build an SVG path for a polyline, breaking the stroke at null gaps:
 * "M x0 y0 L x1 y1 … M x3 y3 …".
 */
export function buildLinePath(points: PlotPoint[]): string {
  let path = '';
  let isPenDown = false;
  for (const point of points) {
    if (point.y === null) {
      isPenDown = false;
      continue;
    }
    path += `${isPenDown ? 'L' : 'M'}${round(point.x)} ${round(point.y)}`;
    isPenDown = true;
  }
  return path;
}

/**
 * Build the closed area under a continuous line down to `baselineY`.
 * Gaps are not supported here: the area chart only fills the primary
 * series, which is always continuous (the engine carries flat months).
 */
export function buildAreaPath(points: Array<{ x: number; y: number }>, baselineY: number): string {
  if (points.length === 0) {
    return '';
  }
  const first = points[0];
  const last = points[points.length - 1];
  const line = points.map((p, index) => `${index === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`);
  return `${line.join('')}L${round(last.x)} ${round(baselineY)}L${round(first.x)} ${round(baselineY)}Z`;
}

/**
 * "Nice" tick values for an axis: at most `count` ticks at a round step
 * (1, 2, 2.5, 5 × 10^n) covering the domain.
 */
export function buildNiceTicks(domain: [number, number], count = 4): number[] {
  const [min, max] = domain;
  const span = max - min;
  if (span <= 0 || !Number.isFinite(span)) {
    return [min];
  }
  const rawStep = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step / 1e6; tick += step) {
    ticks.push(Math.round(tick / step) * step);
  }
  return ticks;
}

/**
 * Pick which x positions get a label: always the first and the last, plus
 * evenly spaced ones so at most `maxLabels` render.
 */
export function pickLabelIndexes(length: number, maxLabels: number): number[] {
  if (length <= maxLabels) {
    return Array.from({ length }, (_, index) => index);
  }
  const stride = Math.ceil((length - 1) / (maxLabels - 1));
  const indexes = new Set<number>();
  for (let index = 0; index < length; index += stride) {
    indexes.add(index);
  }
  indexes.add(length - 1);
  return [...indexes].sort((a, b) => a - b);
}

/*
 * Price direction. Every chart and badge that colors or arrows a change asks
 * the same function, so a number can never sit next to an arrow that
 * contradicts it.
 */

export type PriceDirection = 'up' | 'down' | 'flat';

/**
 * Largest |ratio| still called flat, exclusive. Derived from the display:
 * formatPct shows one decimal of a percent, so every ratio below 0.0005
 * (0.05 %) renders as "0,0%", and from 0.0005 on it renders "±0,1%". A tighter
 * epsilon put a rising arrow beside "0,0%".
 */
export const FLAT_RATIO_EPSILON = 0.0005;

/**
 * Classify a change ratio (0.042 = +4.2 %) for color and arrow: flat while it
 * would render as "0,0%", up or down beyond that.
 */
export function calculatePriceDirection(ratio: number): PriceDirection {
  if (ratio >= FLAT_RATIO_EPSILON) {
    return 'up';
  }
  if (ratio <= -FLAT_RATIO_EPSILON) {
    return 'down';
  }
  return 'flat';
}

/**
 * Change ratio from the first to the last value of a series (prices, so
 * positive). 0 when there is nothing to compare: fewer than two values, or a
 * first value that is not positive.
 */
export function calculateSeriesChangeRatio(values: readonly number[]): number {
  const first = values[0];
  const last = values.at(-1);
  if (values.length < 2 || first === undefined || last === undefined || first <= 0) {
    return 0;
  }
  return last / first - 1;
}

/**
 * Text tone of each direction (DESIGN.md): this is an inflation tracker, so
 * a RISING price is in the `negative` family and a FALLING one in the
 * `positive` family; flat is muted. Shared by the sparkline stroke, the
 * category values and the trend badge.
 */
export const PRICE_DIRECTION_TEXT_CLASSES: Record<PriceDirection, string> = {
  up: 'text-negative',
  down: 'text-positive',
  flat: 'text-text-muted',
};

/*
 * Area chart geometry. Everything the area chart draws is a function of its
 * values and its box, so it is computed here, pure and tested, and the
 * component only renders it.
 */

/** Room around the plot for the y tick labels (left) and the month labels (bottom). */
export const AREA_CHART_PADDING = { top: 12, right: 12, bottom: 24, left: 44 } as const;
/** The plot never gets narrower than this, even before the container is measured. */
const AREA_CHART_MIN_PLOT_WIDTH = 40;
/** Fraction of the value span added above and below, so the line never touches the edge. */
const AREA_CHART_Y_PAD_FRACTION = 0.12;
/** Sparse y ticks: at most this many gridlines. */
const AREA_CHART_Y_TICK_COUNT = 3;
/** Below this width the month labels thin out to the narrow count. */
const AREA_CHART_NARROW_WIDTH = 480;
const AREA_CHART_X_LABELS_NARROW = 4;
const AREA_CHART_X_LABELS_WIDE = 6;

export interface AreaChartGeometryInput {
  /** The primary series, oldest month first. */
  values: readonly number[];
  /**
   * The comparison series aligned to `values` (null for a missing month).
   * Pass an empty array while the comparison is hidden: it then neither draws
   * nor stretches the y domain.
   */
  compareValues: readonly (number | null)[];
  /** Marker values (promo observations); they widen the y domain so no dot is clipped. */
  markerValues: readonly number[];
  /** The SVG viewBox size, in user units. */
  width: number;
  height: number;
}

export interface AreaChartGeometry {
  /** The plot's edges inside the viewBox. */
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  /** Series index → x; value → y. */
  x: LinearScale;
  y: LinearScale;
  linePath: string;
  areaPath: string;
  comparePath: string;
  yTicks: number[];
  /** Indexes of the months that get an x label. */
  labelIndexes: number[];
  /** The series index nearest to a viewBox x, clamped to the series. */
  indexAtX: (viewBoxX: number) => number;
}

/** Lay out the area chart: plot box, scales, paths, ticks, labels and the pointer lookup. */
export function buildAreaChartGeometry({
  values,
  compareValues,
  markerValues,
  width,
  height,
}: AreaChartGeometryInput): AreaChartGeometry {
  const plotLeft = AREA_CHART_PADDING.left;
  const plotWidth = Math.max(
    AREA_CHART_MIN_PLOT_WIDTH,
    width - AREA_CHART_PADDING.left - AREA_CHART_PADDING.right,
  );
  const plotRight = plotLeft + plotWidth;
  const plotTop = AREA_CHART_PADDING.top;
  const plotBottom = height - AREA_CHART_PADDING.bottom;
  const lastIndex = values.length - 1;

  const yDomain = padDomain(
    [
      ...values,
      ...compareValues.filter((value): value is number => value !== null),
      ...markerValues,
    ],
    AREA_CHART_Y_PAD_FRACTION,
  );
  const x = createLinearScale([0, Math.max(1, lastIndex)], [plotLeft, plotRight]);
  const y = createLinearScale(yDomain, [plotBottom, plotTop]);

  const linePoints = values.map((value, index) => ({ x: x(index), y: y(value) }));

  return {
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    x,
    y,
    linePath: buildLinePath(linePoints),
    areaPath: buildAreaPath(linePoints, plotBottom),
    comparePath: buildLinePath(
      compareValues.map((value, index) => ({ x: x(index), y: value === null ? null : y(value) })),
    ),
    yTicks: buildNiceTicks(yDomain, AREA_CHART_Y_TICK_COUNT),
    labelIndexes: pickLabelIndexes(
      values.length,
      width < AREA_CHART_NARROW_WIDTH ? AREA_CHART_X_LABELS_NARROW : AREA_CHART_X_LABELS_WIDE,
    ),
    indexAtX: (viewBoxX) => {
      const index = Math.round(((viewBoxX - plotLeft) / plotWidth) * lastIndex);
      return Math.min(lastIndex, Math.max(0, index));
    },
  };
}
