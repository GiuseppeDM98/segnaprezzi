'use client';

/**
 * Label + control + hint + error wrapper. Wires
 * aria-describedby / aria-invalid for whatever control it receives through
 * the render prop, so no form has to remember the accessibility plumbing.
 */
import { type ReactNode, useId } from 'react';

import { cx } from '@/lib/cx';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  isRequired?: boolean;
  /** Caption shown on the trailing side of the label row (e.g. "calcolato"). */
  trailing?: ReactNode;
  className?: string;
  children: (controlProps: FieldControlProps) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  isRequired = false,
  trailing,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-sans font-medium text-[15px] text-text leading-tight">
          {label}
          {isRequired && (
            <span aria-hidden="true" className="ml-0.5 text-accent-ink">
              *
            </span>
          )}
        </label>
        {trailing}
      </div>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': isRequired ? true : undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-sm text-text-muted leading-snug">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="font-medium text-negative text-sm leading-snug">
          {error}
        </p>
      )}
    </div>
  );
}
