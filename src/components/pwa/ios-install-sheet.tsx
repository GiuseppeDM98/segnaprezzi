'use client';

/**
 * Add-to-Home-Screen instructions for iOS.
 *
 * Safari fires no `beforeinstallprompt`, so the only honest install UI is a
 * pointer at its own share sheet. The eviction warning is not decoration:
 * Safari wipes script-writable storage — the whole photo queue — after seven
 * days without interaction for a web app that is not on the Home Screen.
 */
import { AlertTriangle, PlusSquare, Share } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

export interface IosInstallSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function IosInstallSheet({ isOpen, onClose }: IosInstallSheetProps) {
  const t = useTranslations('pwa.install');

  const steps = [
    { key: 'iosStep1', icon: <Share aria-hidden="true" className="size-4" /> },
    { key: 'iosStep2', icon: <PlusSquare aria-hidden="true" className="size-4" /> },
    { key: 'iosStep3', icon: null },
  ] as const;

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={t('iosTitle')} description={t('body')}>
      <div className="flex flex-col gap-4" data-testid="ios-install-sheet">
        <ol className="zebra -mx-1">
          {steps.map((step, index) => (
            <li key={step.key} className="flex min-h-12 items-center gap-3 px-3">
              <span className="font-mono text-[13px] text-text-muted tabular-nums">
                {index + 1}
              </span>
              <span className="flex flex-1 items-center gap-2 font-sans text-[15px] text-text">
                {t(step.key)}
                {step.icon}
              </span>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2.5 font-sans text-[13px] text-text leading-snug">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          {t('iosWarning')}
        </p>
        <Button variant="ghost" onClick={onClose}>
          {t('notNow')}
        </Button>
      </div>
    </Sheet>
  );
}
