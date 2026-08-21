'use client';

/**
 * Horizontal signed bars from a zero baseline (Spec 05 §6.2): one zebra row
 * per category — label, bar, signed value. Rising prices extend right in
 * the negative family, falling prices extend left in the positive family.
 * Bars grow on mount with the house spring; the value text is always
 * present, so color and length are never the only channel.
 */
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { cx } from '@/lib/cx';
import type { CategoryId } from '@/lib/domain/categories';
import { useAppMotion } from '@/lib/motion';
import { priceDirectionOf } from './trend-badge';

export interface CategoryBarItem {
  category: CategoryId;
  ratio: number;
}

export interface CategoryBarsProps {
  items: CategoryBarItem[];
  formatValue: (ratio: number) => string;
  /** Localized summary for the sr-only table caption. */
  ariaSummary: string;
  className?: string;
}

export function CategoryBars({ items, formatValue, ariaSummary, className }: CategoryBarsProps) {
  const tCategories = useTranslations('categories');
  const tCommon = useTranslations('common');
  const { isReduced, spring } = useAppMotion();
  const maxAbs = Math.max(0.0001, ...items.map((item) => Math.abs(item.ratio)));

  return (
    <div className={className}>
      <ol className="zebra" aria-hidden="true">
        {items.map((item) => {
          const direction = priceDirectionOf(item.ratio);
          const widthPct = (Math.abs(item.ratio) / maxAbs) * 50;
          return (
            <li key={item.category} className="flex h-12 items-center gap-3 px-3">
              <span className="w-[34%] truncate font-sans text-[15px] text-text">
                {tCategories(item.category)}
              </span>
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
                  direction === 'up' && 'text-negative',
                  direction === 'down' && 'text-positive',
                  direction === 'flat' && 'text-text-muted',
                )}
              >
                {formatValue(item.ratio)}
              </span>
            </li>
          );
        })}
      </ol>
      <table className="sr-only">
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
              <td>{formatValue(item.ratio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
