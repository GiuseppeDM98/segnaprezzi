/**
 * Surface container. In the printout world a card is a
 * ruled block on the sheet — a hairline frame, no drop shadow, no nesting.
 */
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '@/lib/cx';

export type CardPadding = 'none' | 'compact' | 'default';

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  compact: 'p-3',
  default: 'p-4',
};

export interface CardProps extends ComponentProps<'section'> {
  padding?: CardPadding;
  /** Pressed-state and hover affordance for a whole tappable card. */
  isInteractive?: boolean;
  children: ReactNode;
}

export function Card({
  padding = 'default',
  isInteractive = false,
  className,
  children,
  ...sectionProps
}: CardProps) {
  return (
    <section
      {...sectionProps}
      className={cx(
        'rounded-control border border-border bg-surface',
        PADDING_CLASSES[padding],
        isInteractive && 'transition-colors hover:bg-band active:bg-band',
        className,
      )}
    >
      {children}
    </section>
  );
}
