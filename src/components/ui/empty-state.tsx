/**
 * Empty / error surface (Spec 05 §6.1): an icon or the logo mark, a title,
 * a body, and up to two actions. `tone="error"` is the app's only error
 * layout for content areas — plain language plus a retry.
 */
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { LogoMark } from './logo-mark';

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  /** A lucide icon; when omitted the logo mark is shown. */
  icon?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  tone?: 'default' | 'error';
  className?: string;
  'data-testid'?: string;
}

export function EmptyState({
  title,
  body,
  icon,
  action,
  secondaryAction,
  tone = 'default',
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      data-testid={rest['data-testid']}
      role={tone === 'error' ? 'alert' : undefined}
      className={cx(
        'flex flex-col items-center gap-4 px-6 py-10 text-center',
        'mx-auto max-w-sm',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cx(
            'inline-flex size-14 items-center justify-center rounded-full [&>svg]:size-7',
            tone === 'error' ? 'bg-negative-soft text-negative' : 'bg-band text-text-muted',
          )}
        >
          {icon}
        </span>
      ) : (
        <LogoMark size={56} />
      )}
      <div className="flex flex-col gap-2">
        <h2 className="text-balance font-sans font-semibold text-lg text-text leading-tight">
          {title}
        </h2>
        {body && <p className="text-pretty text-[15px] text-text-muted leading-relaxed">{body}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="flex w-full flex-col items-stretch gap-2 pt-1">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
