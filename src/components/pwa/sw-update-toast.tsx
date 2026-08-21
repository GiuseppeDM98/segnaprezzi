'use client';

/**
 * Announces a waiting service worker.
 *
 * It lives in the app shell rather than in SwProvider because the toast
 * outlet does: the update prompt must look like every other toast, above the
 * tab bar, never a modal. It renders nothing itself.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useToast } from '@/components/ui/toast';
import {
  applyServiceWorkerUpdate,
  dismissServiceWorkerUpdate,
  hasWaitingUpdate,
  subscribeToSwUpdate,
} from './sw-registration';

export function SwUpdateToast() {
  const t = useTranslations('pwa.update');
  const { toast } = useToast();
  const isWaiting = useSyncExternalStore(subscribeToSwUpdate, hasWaitingUpdate, () => false);
  // One announcement per app start: the toast is persistent, so re-raising
  // it on any re-render would stack duplicates behind the first.
  const hasAnnounced = useRef(false);

  useEffect(() => {
    if (!isWaiting || hasAnnounced.current) {
      return;
    }
    hasAnnounced.current = true;
    toast({
      kind: 'info',
      message: t('title'),
      isPersistent: true,
      secondaryAction: { label: t('later'), onClick: dismissServiceWorkerUpdate },
      action: { label: t('action'), onClick: applyServiceWorkerUpdate },
    });
  }, [isWaiting, t, toast]);

  return null;
}
