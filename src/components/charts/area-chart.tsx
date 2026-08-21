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
import { useAppMotion } from '@/lib/motion';
import { useContainerWidth } from '@/lib/use-container-width';
import {
  buildAreaPath,
  buildLinePath,
  createLinearScale,
  niceTicks,
  padDomain,
  pickLabelIndexes,
} from './scale';

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

const PADDING = { top: 12, right: 12, bottom: 24, left: 44 };

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

  const domainValues = [
    ...series.map((p) => p.value),
    ...(hasCompare ? comparePoints.filter((v): v is number => v !== null) : []),
    ...markers.map((m) => m.value),
  ];
  const plotWidth = Math.max(40, width - PADDING.left - PADDING.right);
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const x = createLinearScale(
    [0, Math.max(1, series.length - 1)],
    [PADDING.left, PADDING.left + plotWidth],
  );
  const yDomain = padDomain(domainValues, 0.12);
  const y = createLinearScale(yDomain, [PADDING.top + plotHeight, PADDING.top]);

  const linePoints = series.map((point, index) => ({ x: x(index), y: y(point.value) }));
  const linePath = buildLinePath(linePoints);
  const areaPath = buildAreaPath(linePoints, PADDING.top + plotHeight);
  const comparePath = buildLinePath(
    comparePoints.map((value, index) => ({ x: x(index), y: value === null ? null : y(value) })),
  );
  const ticks = niceTicks(yDomain, 3);
  const labelIndexes = pickLabelIndexes(series.length, width < 480 ? 4 : 6);
  const monthIndex = new Map(months.map((month, index) => [month, index] as const));

  function handlePointer(event: PointerEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (px - PADDING.left) / plotWidth;
    const index = Math.round(ratio * (series.length - 1));
    setActiveIndex(Math.min(series.length - 1, Math.max(0, index)));
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
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={PADDING.left + plotWidth}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-chart-grid)"
              strokeDasharray="2 4"
            />
            <text
              x={PADDING.left - 8}
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
            y={height - 6}
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
          transition={{ ...spring, delay: isReduced ? 0 : 0.15 }}
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
          transition={isReduced ? { duration: 0 } : { duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
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
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
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

      <table className="sr-only">
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
  );
}
