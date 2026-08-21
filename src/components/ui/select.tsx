'use client';

/**
 * Styled native <select> — the native picker has the best
 * mobile ergonomics, so only the closed frame is ours.
 */
import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cx } from '@/lib/cx';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<ComponentProps<'select'>, 'children'> {
  options: SelectOption[];
  /** Optional first option with an empty value (e.g. "Nessuno"). */
  placeholderOption?: string;
}

export function Select({ options, placeholderOption, className, ...selectProps }: SelectProps) {
  return (
    <div className={cx('relative', className)}>
      <select
        {...selectProps}
        className={cx(
          'h-11 w-full appearance-none rounded-control border border-border bg-surface pr-10 pl-3 font-sans text-base text-text transition-colors focus:border-text',
          selectProps['aria-invalid'] && 'border-negative',
          selectProps.disabled && 'opacity-50',
        )}
      >
        {placeholderOption !== undefined && <option value="">{placeholderOption}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
}
