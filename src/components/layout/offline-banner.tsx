'use client';

/**
 * The connectivity pill (Spec 05 §5.13 · Spec 06 §6.1). Offline is a state,
 * never an error: the pill slides from under the top safe-area, stays while
 * offline with the queued count, switches to "syncing" while the engine
 * drains and slides away with a success toast once the queue is empty.
 *
 * Spec 06 replaced the original 1.5 s polling loop with the live queue
 * query: IndexedDB now notifies on every status change, including the ones
 * written by the service worker's Background Sync drain, which no poll in
 * the page could have seen at all.
 */
import { CloudOff, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { useToast } from '@/components/ui/toast';
import { useAppMotion } from '@/lib/motion';
import { useOnlineStatus } from '@/lib/offline/use-online-status';
import { useQueueStatus } from '@/lib/offline/use-queue-status';

type ConnectivityState = 'online' | 'offline' | 'syncing';

export function OfflineBanner() {
  const t = useTranslations('offline');
  const { toast } = useToast();
  const { isReduced, spring, fade } = useAppMotion();
  const isOnline = useOnlineStatus();
  const { queuedCount, uploadingCount, hasPendingWork } = useQueueStatus();

  const state: ConnectivityState = !isOnline ? 'offline' : hasPendingWork ? 'syncing' : 'online';
  const pendingCount = queuedCount + uploadingCount;

  // "Synced" is only worth saying to someone who watched it sync — not to
  // someone who never had a queue in the first place.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (state === 'syncing') {
      wasSyncing.current = true;
      return;
    }
    if (state === 'online' && wasSyncing.current) {
      wasSyncing.current = false;
      toast({ kind: 'success', message: t('synced') });
    }
  }, [state, t, toast]);

  const isVisible = state !== 'online';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center pt-safe">
      <AnimatePresence>
        {isVisible && (
          <motion.output
            data-testid="offline-banner"
            initial={isReduced ? { opacity: 0 } : { opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={isReduced ? { opacity: 0 } : { opacity: 0, y: -24 }}
            transition={isReduced ? fade : spring}
            className="pointer-events-auto mt-2 inline-flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border border-warning/30 bg-warning-soft px-3.5 py-2 font-sans text-[13px] text-text shadow-raised"
          >
            {state === 'offline' ? (
              <CloudOff aria-hidden="true" className="size-4 shrink-0 text-warning" />
            ) : (
              <RefreshCw
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin text-warning motion-reduce:animate-none"
              />
            )}
            <span className="leading-snug">
              {state === 'offline'
                ? pendingCount > 0
                  ? t('offlineWithQueue', { count: pendingCount })
                  : t('offline')
                : t('syncing', { count: pendingCount })}
            </span>
          </motion.output>
        )}
      </AnimatePresence>
    </div>
  );
}
