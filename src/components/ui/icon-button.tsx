'use client';

/**
 * Icon-only action (Spec 05 §6.1). The accessible name is mandatory — it is
 * the aria-label and the tooltip — so an icon can never ship unnamed.
 */
import { motion } from 'motion/react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { useAppMotion } from '@/lib/motion';

export type IconButtonVariant = 'plain' | 'outlined' | 'filled';
export type IconButtonSize = 'md' | 'lg';

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  plain: 'bg-transparent text-text hover:bg-band',
  outlined: 'border border-border bg-surface text-text hover:bg-band',
  filled: 'bg-accent text-accent-contrast hover:brightness-95',
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  md: 'size-11',
  lg: 'size-13',
};

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: ReactNode;
  /** Required accessible name, already localized. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

export function IconButton({
  icon,
  label,
  variant = 'plain',
  size = 'md',
  className,
  ...buttonProps
}: IconButtonProps) {
  const { isReduced } = useAppMotion();
  return (
    <motion.button
      type="button"
      whileTap={isReduced || buttonProps.disabled ? undefined : { scale: 0.94 }}
      {...(buttonProps as ComponentProps<typeof motion.button>)}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex [&>svg]:size-5">
        {icon}
      </span>
    </motion.button>
  );
}
