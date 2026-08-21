'use client';

/**
 * The zero-pressure install entry point in Settings (Spec 06 §7.2).
 *
 * Unlike the contextual sheet it has no cooldown and no lifetime cap,
 * because the user came looking for it. It renders nothing at all when the
 * app is already installed or the platform offers no way to install.
 */
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { usePwaInstall } from '@/lib/offline/use-pwa-install';
import { IosInstallSheet } from './ios-install-sheet';

export function InstallRow() {
  const t = useTranslations('pwa.install');
  const { canInstall, isStandalone, isIos, promptInstall } = usePwaInstall();
  const [isIosSheetOpen, setIsIosSheetOpen] = useState(false);

  if (isStandalone || (!canInstall && !isIos)) {
    return null;
  }

  return (
    <div
      data-testid="install-row"
      className="flex flex-col gap-3 rounded-control border border-border bg-surface p-3 tablet:flex-row tablet:items-center tablet:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-sans font-medium text-[15px] text-text">{t('title')}</span>
        <span className="font-sans text-[13px] text-text-muted leading-snug">{t('body')}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          icon={<Download className="size-4" />}
          onClick={() => (isIos ? setIsIosSheetOpen(true) : void promptInstall())}
          data-testid="install-cta"
        >
          {t('cta')}
        </Button>
      </div>
      <IosInstallSheet isOpen={isIosSheetOpen} onClose={() => setIsIosSheetOpen(false)} />
    </div>
  );
}
