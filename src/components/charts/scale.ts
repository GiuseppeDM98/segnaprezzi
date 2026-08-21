/**
 * Scale and path math for the hand-rolled SVG charts (Spec 05 §6.2).
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
export function niceTicks(domain: [number, number], count = 4): number[] {
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

/** Trend direction of a series for sparkline coloring: compares last vs first. */
export function trendOf(values: number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) {
    return 'flat';
  }
  const first = values[0];
  const last = values[values.length - 1];
  if (last > first) {
    return 'up';
  }
  if (last < first) {
    return 'down';
  }
  return 'flat';
}
