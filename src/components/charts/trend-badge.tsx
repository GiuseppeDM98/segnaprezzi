'use client';

/**
 * Signed percentage pill with a direction arrow.
 *
 * Price-direction mapping (DESIGN.md): this is an inflation tracker, so a
 * RISING price renders in the `negative` family and a FALLING price in the
 * `positive` family; exactly zero is neutral. Sign + arrow + color: color is
 * never the only channel.
 */
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { cx } from '@/lib/cx';
import { type AppLocale, formatPct } from '@/lib/format';

export interface TrendBadgeProps {
  ratio: number;
  size?: 'sm' | 'md';
  className?: string;
}

export function priceDirectionOf(ratio: number): 'up' | 'down' | 'flat' {
  if (ratio > 0.00005) {
    return 'up';
  }
  if (ratio < -0.00005) {
    return 'down';
  }
  return 'flat';
}

const DIRECTION_CLASSES = {
  up: 'bg-negative-soft text-negative',
  down: 'bg-positive-soft text-positive',
  flat: 'bg-band text-text-muted',
} as const;

export function TrendBadge({ ratio, size = 'md', className }: TrendBadgeProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const direction = priceDirectionOf(ratio);
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const directionLabel = t(`trend.${direction}`);

  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full font-mono font-semibold tabular-nums',
        size === 'sm' ? 'h-6 px-1.5 text-[12px]' : 'h-7 px-2 text-[13px]',
        DIRECTION_CLASSES[direction],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={size === 'sm' ? 'size-3.5' : 'size-4'}
        strokeWidth={2.5}
      />
      <span className="sr-only">{directionLabel} </span>
      {formatPct(ratio, locale)}
    </span>
  );
}
