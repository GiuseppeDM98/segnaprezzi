'use client';

/**
 * Integer stepper (Settings → carry-forward months). Two 44 px buttons
 * around a printed value; the value text is passed in pre-formatted so the
 * component never decides how "2 mesi" reads.
 */
import { Minus, Plus } from 'lucide-react';

import { cx } from '@/lib/cx';
import { IconButton } from './icon-button';

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Pre-formatted label of the current value ("2 mesi", "Disattivato"). */
  valueLabel: string;
  decrementLabel: string;
  incrementLabel: string;
  disabled?: boolean;
  className?: string;
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  valueLabel,
  decrementLabel,
  incrementLabel,
  disabled = false,
  className,
}: StepperProps) {
  return (
    <div className={cx('inline-flex items-center gap-1', className)}>
      <IconButton
        icon={<Minus />}
        label={decrementLabel}
        variant="outlined"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      />
      <output
        aria-live="polite"
        className="min-w-28 px-2 text-center font-mono text-[15px] text-text tabular-nums"
      >
        {valueLabel}
      </output>
      <IconButton
        icon={<Plus />}
        label={incrementLabel}
        variant="outlined"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      />
    </div>
  );
}
