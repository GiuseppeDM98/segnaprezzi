'use client';

/**
 * Header of a sub-screen (Spec 05 §4): back button, title, optional
 * caption and trailing actions. Sticky, respects the top safe-area inset.
 */
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/lib/cx';
import { useRouter } from '@/lib/i18n/navigation';

export interface ScreenHeaderProps {
  title: string;
  caption?: ReactNode;
  /** Where "back" goes when there is no history to pop (deep link). */
  backHref?: '/' | '/products' | '/history' | '/settings' | '/scan';
  actions?: ReactNode;
  className?: string;
}

export function ScreenHeader({
  title,
  caption,
  backHref = '/',
  actions,
  className,
}: ScreenHeaderProps) {
  const t = useTranslations('common');
  const router = useRouter();

  function handleBack(): void {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(backHref);
    }
  }

  return (
    <header
      className={cx(
        'sticky top-0 z-20 bg-background/95 pt-safe backdrop-blur-sm',
        'border-border border-b border-dashed',
        className,
      )}
    >
      <div className="flex min-h-14 items-center gap-1 px-2">
        <IconButton icon={<ArrowLeft />} label={t('back')} onClick={handleBack} />
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate font-sans font-semibold text-[17px] text-text leading-tight">
            {title}
          </h1>
          {caption && <div className="truncate text-[13px] text-text-muted">{caption}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}
