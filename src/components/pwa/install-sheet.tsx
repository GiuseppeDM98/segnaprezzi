'use client';

/**
 * The contextual install pitch, for Android and desktop
 * Chromium where a stashed `beforeinstallprompt` can be replayed.
 *
 * Tasteful and dismissible by contract: it appears after a completed spesa —
 * the one moment the user has felt the value — and "Non ora" closes it for
 * thirty days. The nag budget itself lives in use-pwa-install.ts.
 */
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

export interface InstallSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onInstall: () => void;
}

export function InstallSheet({ isOpen, onClose, onInstall }: InstallSheetProps) {
  const t = useTranslations('pwa.install');

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={t('title')} description={t('body')}>
      <div className="flex flex-col gap-2" data-testid="install-sheet">
        <Button size="lg" icon={<Download className="size-4" />} onClick={onInstall}>
          {t('cta')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('notNow')}
        </Button>
      </div>
    </Sheet>
  );
}
