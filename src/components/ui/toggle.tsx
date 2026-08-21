'use client';

/**
 * Switch for booleans (Spec 05 §6.1). A real button with role="switch";
 * the label is part of the hit area so the 44 px target holds.
 */
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { useAppMotion } from '@/lib/motion';

export interface ToggleProps {
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  label: string;
  /** Secondary explanation rendered under the label. */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  isChecked,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: ToggleProps) {
  const { spring } = useAppMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      disabled={disabled}
      onClick={() => onChange(!isChecked)}
      className={cx(
        'flex min-h-11 w-full items-center justify-between gap-4 text-left disabled:opacity-50',
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-sans font-medium text-[15px] text-text">{label}</span>
        {description && <span className="text-sm text-text-muted leading-snug">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors',
          isChecked ? 'border-accent bg-accent' : 'border-border bg-band',
        )}
      >
        <motion.span
          layout
          transition={spring}
          className={cx(
            'block size-5 rounded-full',
            isChecked ? 'ml-auto bg-accent-contrast' : 'bg-text-muted',
          )}
        />
      </span>
    </button>
  );
}
