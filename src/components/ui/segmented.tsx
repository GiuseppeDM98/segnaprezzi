'use client';

/**
 * Segmented control for short single-choice sets (unit kind, theme,
 * language, store kind). Native radios under styled labels: arrow-key
 * navigation and form semantics come for free; the highlighter wash slides
 * between segments with the house spring.
 */
import { motion } from 'motion/react';
import { useId } from 'react';

import { cx } from '@/lib/cx';
import { useAppMotion } from '@/lib/motion';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: 'md' | 'lg';
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: SegmentedProps<T>) {
  const { spring } = useAppMotion();
  const groupId = useId();

  return (
    <fieldset className={cx('m-0 min-w-0 border-0 p-0', className)}>
      <legend className="sr-only">{label}</legend>
      {/* Why the inner div: a fieldset with display:grid still reserves
          space for its legend in some engines; the grid lives one level in. */}
      <div
        className={cx(
          'grid w-full rounded-control border border-border bg-surface p-0.5',
          size === 'lg' ? 'h-12' : 'h-11',
        )}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <label
              key={option.value}
              className={cx(
                'relative isolate flex cursor-pointer items-center justify-center rounded-[0.25rem] px-2 font-sans font-medium text-sm transition-colors',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                isSelected ? 'text-text' : 'text-text-muted hover:text-text',
              )}
            >
              <input
                type="radio"
                name={groupId}
                value={option.value}
                checked={isSelected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {isSelected && (
                <motion.span
                  layoutId={groupId}
                  transition={spring}
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-[0.25rem] border border-accent/50 bg-accent-soft"
                />
              )}
              <span className="truncate">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
