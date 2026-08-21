'use client';

/**
 * Text / decimal input (Spec 05 §6.1). Money mode right-aligns, switches to
 * the print face with tabular figures and sets inputmode="decimal" so the
 * numeric keypad comes up; a prefix/suffix (€, /kg) sits inside the frame.
 */
import { type ComponentProps, type ReactNode, type Ref, useState } from 'react';

import { cx } from '@/lib/cx';

export interface InputProps extends Omit<ComponentProps<'input'>, 'prefix' | 'size'> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Right-aligned tabular decimal entry for money and quantities. */
  isMoney?: boolean;
  /** Larger keypad-friendly variant for the fuel form. */
  size?: 'md' | 'lg';
  /** Briefly tints the frame to show the value was just derived. */
  isHighlighted?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({
  prefix,
  suffix,
  isMoney = false,
  size = 'md',
  isHighlighted = false,
  className,
  ref,
  ...inputProps
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-control border bg-surface px-3 text-text transition-[background-color,border-color,box-shadow]',
        size === 'lg' ? 'h-14' : 'h-11',
        isFocused ? 'border-text' : 'border-border',
        isHighlighted && 'bg-accent-soft',
        inputProps['aria-invalid'] && 'border-negative',
        inputProps.disabled && 'opacity-50',
        className,
      )}
    >
      {prefix && <span className="shrink-0 font-mono text-sm text-text-muted">{prefix}</span>}
      <input
        ref={ref}
        {...inputProps}
        inputMode={inputProps.inputMode ?? (isMoney ? 'decimal' : undefined)}
        autoComplete={inputProps.autoComplete ?? (isMoney ? 'off' : undefined)}
        onFocus={(event) => {
          setIsFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setIsFocused(false);
          inputProps.onBlur?.(event);
        }}
        className={cx(
          'min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-muted/70',
          isMoney
            ? cx('text-right font-mono', size === 'lg' ? 'text-2xl' : 'text-base')
            : 'font-sans text-base',
        )}
      />
      {suffix && <span className="shrink-0 font-mono text-sm text-text-muted">{suffix}</span>}
    </div>
  );
}
