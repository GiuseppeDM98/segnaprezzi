'use client';

/**
 * The only action trigger in the app. Owns the app's sole
 * spinner: the inline pending indicator. Renders a <button>, or a locale-aware
 * <Link> when `href` is given, with the same stamped-control look.
 */
import { motion } from 'motion/react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { Link } from '@/lib/i18n/navigation';
import { useAppMotion } from '@/lib/motion';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:brightness-95',
  secondary: 'border border-text/70 bg-surface text-text hover:bg-band',
  ghost: 'bg-transparent text-text underline decoration-border underline-offset-4 hover:bg-band',
  danger: 'bg-negative text-background hover:brightness-95',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-13 px-6 text-base',
};

const BASE_CLASSES =
  'inline-flex min-w-11 select-none items-center justify-center gap-2 rounded-control font-sans font-semibold leading-none transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-50';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the inline spinner and blocks interaction. */
  isPending?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ComponentProps<'button'>, keyof CommonProps> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: ComponentProps<typeof Link>['href'];
  'data-testid'?: string;
  onClick?: () => void;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', isPending = false, icon, className, children } = props;
  const { isReduced } = useAppMotion();
  const classes = cx(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className);
  const content = (
    <>
      {isPending ? <PendingSpinner /> : icon}
      <span>{children}</span>
    </>
  );

  if (props.href !== undefined) {
    const { href, onClick, 'data-testid': testId } = props;
    return (
      <Link href={href} onClick={onClick} data-testid={testId} className={classes}>
        {content}
      </Link>
    );
  }

  const { href: _href, variant: _v, size: _s, isPending: _p, icon: _i, ...buttonProps } = props;
  return (
    <motion.button
      type="button"
      whileTap={isReduced || buttonProps.disabled || isPending ? undefined : { scale: 0.97 }}
      {...(buttonProps as ComponentProps<typeof motion.button>)}
      aria-busy={isPending || undefined}
      disabled={buttonProps.disabled || isPending}
      className={classes}
    >
      {content}
    </motion.button>
  );
}

/** The app's one spinner: a quarter arc in the current text color. */
function PendingSpinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 animate-spin motion-reduce:animate-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6" className="opacity-25" />
      <path d="M14 8a6 6 0 0 0-6-6" />
    </svg>
  );
}
