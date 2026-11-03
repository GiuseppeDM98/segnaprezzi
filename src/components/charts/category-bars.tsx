'use client';

/**
 * Horizontal signed bars from a zero baseline: one zebra row
 * per category — label, bar, signed value. Rising prices extend right in
 * the negative family, falling prices extend left in the positive family.
 * Bars grow on mount with the house spring; the value text is always
 * present, so color and length are never the only channel.
 *
 * A category with no measured change has no bar at all, only a muted label:
 * a zero baseline with "0,0%" would state that its prices held.
 */
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { cx } from '@/lib/cx';
import type { CategoryId } from '@/lib/domain/categories';
import { useAppMotion } from '@/lib/motion';
import { calculatePriceDirection, PRICE_DIRECTION_TEXT_CLASSES } from './scale';

export interface CategoryBarItem {
  category: CategoryId;
  /** null: no price of this category was compared, so there is no change to draw. */
  ratio: number | null;
}

export interface CategoryBarsProps {
  items: CategoryBarItem[];
  formatValue: (ratio: number) => string;
  /** Localized text for a category with a null ratio. */
  notMeasuredLabel: string;
  /** Localized summary for the sr-only table caption. */
  ariaSummary: string;
  className?: string;
}

export function CategoryBars({
  items,
  formatValue,
  notMeasuredLabel,
  ariaSummary,
  className,
}: CategoryBarsProps) {
  const tCategories = useTranslations('categories');
  const tCommon = useTranslations('common');
  const maxAbs = Math.max(0.0001, ...items.map((item) => Math.abs(item.ratio ?? 0)));

  return (
    <div className={className}>
      <ol className="zebra" aria-hidden="true">
        {items.map((item) => (
          <li key={item.category} className="flex h-12 items-center gap-3 px-3">
            <span className="w-[34%] truncate font-sans text-[15px] text-text">
              {tCategories(item.category)}
            </span>
            {item.ratio === null ? (
              <span className="flex-1 text-right font-sans text-[13px] text-text-muted">
                {notMeasuredLabel}
              </span>
            ) : (
              <SignedBar ratio={item.ratio} maxAbs={maxAbs} formatValue={formatValue} />
            )}
          </li>
        ))}
      </ol>
      {/* The clipping wrapper is load-bearing, not decoration — see the note on
          the same construct in area-chart.tsx. */}
      <div className="sr-only">
        <table>
          <caption>{ariaSummary}</caption>
          <thead>
            <tr>
              <th scope="col">{tCommon('table.category')}</th>
              <th scope="col">{tCommon('table.change')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.category}>
                <th scope="row">{tCategories(item.category)}</th>
                <td>{item.ratio === null ? notMeasuredLabel : formatValue(item.ratio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignedBar({
  ratio,
  maxAbs,
  formatValue,
}: {
  ratio: number;
  maxAbs: number;
  formatValue: (ratio: number) => string;
}) {
  const { isReduced, spring } = useAppMotion();
  const direction = calculatePriceDirection(ratio);
  const widthPct = (Math.abs(ratio) / maxAbs) * 50;
  return (
    <>
      <span className="relative h-3 flex-1">
        <span className="absolute inset-y-0 left-1/2 w-px bg-chart-grid" />
        <motion.span
          initial={isReduced ? false : { width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={spring}
          className={cx(
            'absolute inset-y-0 rounded-sm',
            direction === 'up' && 'left-1/2 bg-negative',
            direction === 'down' && 'right-1/2 bg-positive',
            direction === 'flat' && 'left-1/2 w-0',
          )}
        />
      </span>
      <span
        className={cx(
          'w-16 shrink-0 text-right font-mono font-semibold text-[14px] tabular-nums',
          PRICE_DIRECTION_TEXT_CLASSES[direction],
        )}
      >
        {formatValue(ratio)}
      </span>
    </>
  );
}
