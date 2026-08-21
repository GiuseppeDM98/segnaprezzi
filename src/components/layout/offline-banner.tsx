'use client';

/**
 * The connectivity pill (Spec 05 §5.13). Offline is a state, never an
 * error: the pill slides from under the top safe-area, stays while offline
 * with the queued count, switches to "syncing" on reconnect and slides away
 * with a success toast once the queue is empty. Spec 06's sync engine drives
 * this exact component and the `offline.*` keys — no duplicate chip.
 */
import { CloudOff, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { useAppMotion } from '@/lib/motion';
import { countQueuedPhotos } from '@/lib/offline/photo-queue';

/** How often the reconnect state re-reads the queue while it drains. */
const SYNC_POLL_MS = 1500;
/** Give the optimistic uploads this long before declaring the queue synced. */
const SYNC_TIMEOUT_MS = 15_000;

type ConnectivityState = 'online' | 'offline' | 'syncing';

export function OfflineBanner() {
  const t = useTranslations('offline');
  const { toast } = useToast();
  const { isReduced, spring, fade } = useAppMotion();
  const [state, setState] = useState<ConnectivityState>('online');
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    async function refreshQueue(): Promise<number> {
      try {
        const count = await countQueuedPhotos();
        setQueuedCount(count);
        return count;
      } catch {
        // IndexedDB unavailable (private mode): nothing is queued locally.
        return 0;
      }
    }

    function handleOffline(): void {
      setState('offline');
      void refreshQueue();
    }

    let pollHandle: number | undefined;
    let timeoutHandle: number | undefined;

    function stopPolling(): void {
      window.clearInterval(pollHandle);
      window.clearTimeout(timeoutHandle);
    }

    async function handleOnline(): Promise<void> {
      const pending = await refreshQueue();
      if (pending === 0) {
        setState('online');
        return;
      }
      setState('syncing');
      pollHandle = window.setInterval(async () => {
        const remaining = await refreshQueue();
        if (remaining === 0) {
          stopPolling();
          setState('online');
          toast({ kind: 'success', message: t('synced') });
        }
      }, SYNC_POLL_MS);
      timeoutHandle = window.setTimeout(() => {
        stopPolling();
        setState('online');
      }, SYNC_TIMEOUT_MS);
    }

    if (!navigator.onLine) {
      handleOffline();
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      stopPolling();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [t, toast]);

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
                ? queuedCount > 0
                  ? t('offlineWithQueue', { count: queuedCount })
                  : t('offline')
                : t('syncing', { count: queuedCount })}
            </span>
          </motion.output>
        )}
      </AnimatePresence>
    </div>
  );
}
