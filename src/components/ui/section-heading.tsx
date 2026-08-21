/**
 * A printout's column header: uppercase print face over a double rule.
 * This IS the section heading (an <h2> by default), never a kicker above
 * one — the heading carries its own weight.
 */
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

export interface SectionHeadingProps {
  children: ReactNode;
  /** Right-aligned caption or control on the same rule (e.g. a toggle chip). */
  trailing?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  id?: string;
  className?: string;
}

export function SectionHeading({
  children,
  trailing,
  as: Tag = 'h2',
  id,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cx('rule-double flex items-end justify-between gap-3 pb-1.5', className)}>
      <Tag
        id={id}
        className="font-mono font-semibold text-[12px] text-text-muted uppercase leading-none tracking-[0.12em]"
      >
        {children}
      </Tag>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );
}
