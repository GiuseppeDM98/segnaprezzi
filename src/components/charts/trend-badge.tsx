'use client';

/**
 * Signed percentage pill with a direction arrow.
 *
 * Price-direction mapping (DESIGN.md, PRICE_DIRECTION_TEXT_CLASSES in
 * scale.ts): a RISING price renders in the `negative` family and a FALLING
 * price in the `positive` family; a change that displays as 0,0% is neutral.
 * Sign + arrow + color: color is never the only channel.
 */
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { cx } from '@/lib/cx';
import { type AppLocale, formatPct } from '@/lib/format';
import { calculatePriceDirection, PRICE_DIRECTION_TEXT_CLASSES } from './scale';

export interface TrendBadgeProps {
  ratio: number;
  size?: 'sm' | 'md';
  className?: string;
}

/*
 * Why `flat` carries no fill: `band` is also the tint of the alternate
 * zebra row, so the flat pill was a visible plate on odd rows and invisible on
 * even ones — the same number appearing to be two different kinds of thing
 * down one list. Nothing moved is the absence of news, so it gets no plate;
 * the reserved height keeps the column aligned either way.
 */
const DIRECTION_FILL_CLASSES = {
  up: 'bg-negative-soft',
  down: 'bg-positive-soft',
  flat: null,
} as const;

export function TrendBadge({ ratio, size = 'md', className }: TrendBadgeProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations('common');
  const direction = calculatePriceDirection(ratio);
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const directionLabel = t(`trend.${direction}`);

  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full font-mono font-semibold tabular-nums',
        size === 'sm' ? 'h-6 px-1.5 text-[12px]' : 'h-7 px-2 text-[13px]',
        PRICE_DIRECTION_TEXT_CLASSES[direction],
        DIRECTION_FILL_CLASSES[direction],
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
