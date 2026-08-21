/**
 * Tiny inline trend line, no axes. `aria-hidden` by
 * contract: it always sits next to a TrendBadge that carries the value.
 * Stroke color follows the price-direction mapping (up = negative family).
 */
import { cx } from '@/lib/cx';
import { buildLinePath, createLinearScale, padDomain, trendOf } from './scale';

export interface SparklineProps {
  points: number[];
  trend?: 'up' | 'down' | 'flat';
  width?: number;
  height?: number;
  className?: string;
}

const TREND_CLASSES = {
  up: 'text-negative',
  down: 'text-positive',
  flat: 'text-text-muted',
} as const;

export function Sparkline({ points, trend, width = 72, height = 24, className }: SparklineProps) {
  const direction = trend ?? trendOf(points);
  const x = createLinearScale([0, Math.max(1, points.length - 1)], [2, width - 2]);
  const y = createLinearScale(padDomain(points, 0.15), [height - 2, 2]);
  const path = buildLinePath(points.map((value, index) => ({ x: x(index), y: y(value) })));
  const last = points.at(-1);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cx('shrink-0 overflow-visible', TREND_CLASSES[direction], className)}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last !== undefined && (
        <circle cx={x(points.length - 1)} cy={y(last)} r="2.25" fill="currentColor" />
      )}
    </svg>
  );
}
