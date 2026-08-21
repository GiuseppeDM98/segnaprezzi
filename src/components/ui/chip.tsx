'use client';

/**
 * Compact pill (Spec 05 §6.1). Two jobs: `filter` chips are toggles
 * (aria-pressed, 44 px target, highlighter wash when selected); `status`
 * chips are read-only labels tinted by `tone`. Status chips always carry
 * text — color is never the only channel (§8).
 */
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

export type ChipTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'promo';

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface text-text-muted',
  accent: 'border-accent/40 bg-accent-soft text-text',
  positive: 'border-positive/30 bg-positive-soft text-positive',
  negative: 'border-negative/30 bg-negative-soft text-negative',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  promo: 'border-promo/40 bg-surface text-promo',
};

interface ChipBaseProps {
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export interface FilterChipProps extends ChipBaseProps {
  variant: 'filter';
  isSelected?: boolean;
  /** `sm` keeps a 44 px hit area through a transparent halo while drawing a 28 px pill. */
  size?: 'md' | 'sm';
  onClick?: () => void;
  /** Renders a trailing remove affordance; the chip becomes "remove filter". */
  onRemove?: () => void;
  removeLabel?: string;
  'data-testid'?: string;
}

export interface StatusChipProps extends ChipBaseProps {
  variant: 'status';
  tone?: ChipTone;
  'data-testid'?: string;
}

export type ChipProps = FilterChipProps | StatusChipProps;

export function Chip(props: ChipProps) {
  if (props.variant === 'status') {
    const { tone = 'neutral', icon, className, children } = props;
    return (
      <span
        data-testid={props['data-testid']}
        className={cx(
          'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[11px] uppercase tracking-wide',
          TONE_CLASSES[tone],
          className,
        )}
      >
        {icon && (
          <span aria-hidden="true" className="inline-flex [&>svg]:size-3">
            {icon}
          </span>
        )}
        {children}
      </span>
    );
  }

  const {
    isSelected = false,
    onClick,
    onRemove,
    removeLabel,
    icon,
    className,
    children,
    size = 'md',
  } = props;
  return (
    <span className={cx('inline-flex shrink-0 items-center', className)}>
      <button
        type="button"
        aria-pressed={onRemove ? undefined : isSelected}
        onClick={onClick}
        data-testid={props['data-testid']}
        className={cx(
          'inline-flex items-center gap-1.5 border font-sans font-medium text-sm transition-colors',
          size === 'sm'
            ? 'relative h-7 px-3 text-[13px] after:absolute after:-inset-y-2 after:inset-x-0 after:content-[""]'
            : 'h-11 px-3.5',
          onRemove ? 'rounded-l-full border-r-0' : 'rounded-full',
          isSelected
            ? 'border-accent bg-accent-soft text-text'
            : 'border-border bg-surface text-text hover:bg-band',
        )}
      >
        {icon && (
          <span aria-hidden="true" className="inline-flex [&>svg]:size-4">
            {icon}
          </span>
        )}
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="inline-flex h-11 w-10 items-center justify-center rounded-r-full border border-accent bg-accent-soft text-text hover:bg-band"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </span>
  );
}
