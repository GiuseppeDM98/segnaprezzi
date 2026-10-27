'use client';

/**
 * Monthly line + soft area with an optional comparison
 * series (ISTAT) that sits visually behind the accent line, optional
 * markers (promo observations) and sparse y ticks. Draws in on mount only;
 * toggling the comparison fades the overlay and never re-draws the chart.
 *
 * Accessibility: role="img" with a generated summary sentence AND an
 * sr-only table of every plotted value. A pointer/touch readout names the
 * month under the finger in a caption row, never in a floating tooltip.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { type PointerEvent, useId, useState } from 'react';

import { cx } from '@/lib/cx';
import { type AppLocale, formatMonth, formatMonthShort } from '@/lib/format';
import { chartDraw, useAppMotion } from '@/lib/motion';
import { useContainerWidth } from '@/lib/use-container-width';
import { buildAreaChartGeometry } from './scale';

export interface MonthValue {
  /** 'YYYY-MM' */
  month: string;
  value: number;
}

export interface AreaChartProps {
  series: MonthValue[];
  compareSeries?: MonthValue[];
  /** Whether the comparison overlay is currently shown (fades, never redraws). */
  isCompareVisible?: boolean;
  /** Promo observations drawn as dots on the line. */
  markers?: MonthValue[];
  formatValue: (value: number) => string;
  ariaSummary: string;
  seriesLabel: string;
  compareLabel?: string;
  height?: number;
  className?: string;
}

/** Gap between a y tick label's right edge and the plot. */
const Y_TICK_LABEL_GAP = 8;
/** Month labels sit this far above the bottom edge of the SVG. */
const X_LABEL_BOTTOM_OFFSET = 6;

export function AreaChart({
  series,
  compareSeries,
  isCompareVisible = false,
  markers = [],
  formatValue,
  ariaSummary,
  seriesLabel,
  compareLabel,
  height = 200,
  className,
}: AreaChartProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const { isReduced, spring, fade } = useAppMotion();
  const [containerRef, width] = useContainerWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = useId();

  const months = series.map((point) => point.month);
  const compareByMonth = new Map((compareSeries ?? []).map((p) => [p.month, p.value] as const));
  const comparePoints = months.map((month) => compareByMonth.get(month) ?? null);
  const hasCompare = isCompareVisible && comparePoints.some((value) => value !== null);

  const {
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    x,
    y,
    linePath,
    areaPath,
    comparePath,
    yTicks,
    labelIndexes,
    indexAtX,
  } = buildAreaChartGeometry({
    values: series.map((point) => point.value),
    compareValues: hasCompare ? comparePoints : [],
    markerValues: markers.map((marker) => marker.value),
    width,
    height,
  });
  const monthIndex = new Map(months.map((month, index) => [month, index] as const));

  function handlePointer(event: PointerEvent<SVGSVGElement>): void {
    // Client pixels → viewBox units: the SVG is drawn at `width` but laid out
    // at whatever size its container gives it.
    const rect = event.currentTarget.getBoundingClientRect();
    setActiveIndex(indexAtX(((event.clientX - rect.left) / rect.width) * width));
  }

  const active = activeIndex === null ? null : series[activeIndex];
  const activeCompare = activeIndex === null ? null : comparePoints[activeIndex];

  return (
    <div ref={containerRef} className={cx('flex flex-col gap-1', className)}>
      {/* Readout row: fixed height so the chart never jumps. */}
      <div className="flex h-5 items-center justify-between px-1 font-mono text-[12px] tabular-nums">
        {active ? (
          <>
            <span className="text-text-muted">{formatMonth(active.month, locale)}</span>
            <span className="flex items-center gap-3">
              <span className="text-text">
                <span className="mr-1 inline-block size-2 rounded-full bg-accent align-middle" />
                {formatValue(active.value)}
              </span>
              {hasCompare && activeCompare !== null && (
                <span className="text-text-muted">
                  <span className="mr-1 inline-block size-2 rounded-full bg-chart-compare align-middle" />
                  {formatValue(activeCompare)}
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="text-text-muted">{seriesLabel}</span>
            {hasCompare && compareLabel && <span className="text-text-muted">{compareLabel}</span>}
          </>
        )}
      </div>

      <svg
        role="img"
        aria-label={ariaSummary}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        className="touch-pan-y select-none overflow-visible"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines + y ticks */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-chart-grid)"
              strokeDasharray="2 4"
            />
            <text
              x={plotLeft - Y_TICK_LABEL_GAP}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--color-text-muted)"
              className="font-mono text-[11px] tabular-nums"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {/* x labels */}
        {labelIndexes.map((index) => (
          <text
            key={months[index]}
            x={x(index)}
            y={height - X_LABEL_BOTTOM_OFFSET}
            textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}
            fill="var(--color-text-muted)"
            className="font-mono text-[11px]"
          >
            {formatMonthShort(months[index], locale)}
          </text>
        ))}

        {/* Comparison overlay — behind the accent series, fades only */}
        <AnimatePresence>
          {hasCompare && (
            <motion.path
              key="compare"
              d={comparePath}
              fill="none"
              stroke="var(--color-chart-compare)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              strokeLinecap="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            />
          )}
        </AnimatePresence>

        {/* Area fades up, line draws left → right — mount only */}
        <motion.path
          d={areaPath}
          fill={`url(#${gradientId})`}
          initial={isReduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: isReduced ? 0 : chartDraw.areaFadeDelay }}
        />
        <motion.path
          d={linePath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={isReduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={
            isReduced
              ? { duration: 0 }
              : { duration: chartDraw.lineDrawDuration, ease: chartDraw.lineDrawEase }
          }
        />

        {/* Promo markers */}
        {markers.map((marker) => {
          const index = monthIndex.get(marker.month);
          if (index === undefined) {
            return null;
          }
          return (
            <circle
              key={marker.month}
              cx={x(index)}
              cy={y(marker.value)}
              r="4"
              fill="var(--color-promo)"
              stroke="var(--color-surface)"
              strokeWidth="1.5"
            />
          );
        })}

        {/* Active month crosshair */}
        {activeIndex !== null && active && (
          <g>
            <line
              x1={x(activeIndex)}
              x2={x(activeIndex)}
              y1={plotTop}
              y2={plotBottom}
              stroke="var(--color-text-muted)"
              strokeDasharray="2 3"
            />
            <circle
              cx={x(activeIndex)}
              cy={y(active.value)}
              r="4.5"
              fill="var(--color-accent)"
              stroke="var(--color-surface)"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {/* Why the wrapper: `sr-only` sets width:1px, but a <table> is sized by
          its own content and ignores it, so the nowrap caption widened the
          document and /products/[id] scrolled sideways by 117 px. The clipping
          div is a block that honours the width and hides the overflow. */}
      <div className="sr-only">
        <table>
          <caption>{ariaSummary}</caption>
          <thead>
            <tr>
              <th scope="col">{t('table.month')}</th>
              <th scope="col">{seriesLabel}</th>
              {hasCompare && compareLabel && <th scope="col">{compareLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {series.map((point, index) => (
              <tr key={point.month}>
                <th scope="row">{formatMonth(point.month, locale)}</th>
                <td>{formatValue(point.value)}</td>
                {hasCompare && compareLabel && (
                  <td>{comparePoints[index] === null ? '—' : formatValue(comparePoints[index])}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
