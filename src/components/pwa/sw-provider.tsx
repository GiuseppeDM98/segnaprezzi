'use client';

/**
 * The one place the PWA machinery is switched on (Spec 06 §5.3, §7, §8).
 *
 * Mounted once by the locale layout, above every route, because all three
 * jobs it owns must outlive any single screen: the service worker
 * registration and its update handshake, the sync engine's page-side
 * triggers, and the capture of `beforeinstallprompt` (which fires early and
 * is lost forever if nobody claims it).
 *
 * It renders only the install sheets. The update toast lives inside the app
 * shell instead, because it needs the toast provider (SwUpdateToast).
 */
import { type ReactNode, useEffect, useState } from 'react';
import { startSyncEngine } from '@/lib/offline/sync';
import {
  canShowInstallSheet,
  recordInstallSheetShown,
  startInstallPromptCapture,
  subscribeToSessionCompleted,
  usePwaInstall,
} from '@/lib/offline/use-pwa-install';
import { InstallSheet } from './install-sheet';
import { IosInstallSheet } from './ios-install-sheet';
import { startServiceWorker } from './sw-registration';

export function SwProvider({ children }: { children: ReactNode }) {
  useEffect(() => startServiceWorker(), []);
  useEffect(() => startSyncEngine(), []);
  useEffect(() => startInstallPromptCapture(), []);

  return (
    <>
      {children}
      <ContextualInstallSheet />
    </>
  );
}

/**
 * The install pitch that follows a completed spesa, in whichever form the
 * platform allows. Kept separate from SwProvider so the sheets subscribe to
 * install state without re-rendering the whole app on every change.
 */
function ContextualInstallSheet() {
  const { canInstall, isStandalone, isIos, promptInstall } = usePwaInstall();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    return subscribeToSessionCompleted(() => {
      const isOffered = !isStandalone && (canInstall || isIos);
      if (!isOffered || !canShowInstallSheet()) {
        return;
      }
      recordInstallSheetShown();
      setIsOpen(true);
    });
  }, [canInstall, isStandalone, isIos]);

  if (isIos) {
    return <IosInstallSheet isOpen={isOpen} onClose={() => setIsOpen(false)} />;
  }
  return (
    <InstallSheet
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      onInstall={() => {
        setIsOpen(false);
        void promptInstall();
      }}
    />
  );
}
