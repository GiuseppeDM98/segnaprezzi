'use client';

/**
 * Client half of the capture screen: session resume, store chip + picker
 * sheet, immersive viewfinder, tray with its queue status line
 * and the review CTA. The FAB's accent disc morphs into this screen
 * through the shared layoutId.
 *
 * Design: the spesa is client-owned. The session id is minted on the first
 * shutter press and never waits for the network; the shutter's only job is
 * to put a compressed photo in Dexie. The sync engine takes it from
 * there — the screen never uploads anything itself and never polls, it just
 * renders the live queue, so a lost connection changes only the status
 * chips, never what is on screen.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Store as StoreIcon, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { CameraView } from '@/components/capture/camera-view';
import { PhotoTray } from '@/components/capture/photo-tray';
import { QueueStatusLine } from '@/components/capture/queue-status-line';
import { StorePickerSheet } from '@/components/capture/store-picker-sheet';
import { useStoreOptions } from '@/components/capture/use-store-options';
import { Button } from '@/components/ui/button';
import { SCAN_MORPH_LAYOUT_ID } from '@/components/ui/fab';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { callAction, describeActionError } from '@/lib/call-action';
import { cx } from '@/lib/cx';
import { useRouter } from '@/lib/i18n/navigation';
import { useAppMotion } from '@/lib/motion';
import { compressPhoto } from '@/lib/offline/compress';
import {
  clearActiveSessionId,
  clearSessionPhotos,
  createSessionId,
  deletePendingPhoto,
  enqueuePendingPhoto,
  listSessionPhotos,
  readActiveSessionId,
  writeActiveSessionId,
} from '@/lib/offline/photo-queue';
import { drainPendingPhotos, retryAllFailedPhotos, retryFailedPhoto } from '@/lib/offline/sync';
import type { ScanContext } from '@/lib/services/capture-context';
import { createStore } from '../stores/actions';
import { discardShoppingSession } from './actions';

/** After this long a spesa is more likely forgotten than still in progress. */
const STALE_SESSION_MS = 24 * 60 * 60 * 1000;

export interface ScanScreenProps {
  context: ScanContext;
}

export function ScanScreen({ context }: ScanScreenProps) {
  const t = useTranslations('scan');
  const tOffline = useTranslations('offline');
  const tErrors = useTranslations('errors');
  const { toast } = useToast();
  const router = useRouter();
  const { isReduced, spring } = useAppMotion();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { stores, createStore: handleCreateStore } = useStoreOptions(
    context.stores,
    createStore,
    'supermarket',
  );
  const [storeId, setStoreId] = useState<string | null>(context.defaultStoreId);
  const [isStorePickerOpen, setIsStorePickerOpen] = useState(false);
  const [isResumeDismissed, setIsResumeDismissed] = useState(false);
  const [hasCapturedOnce, setHasCapturedOnce] = useState(false);

  // The tray is a live view of Dexie: statuses flip under it as the sync
  // engine drains, including from the service worker, with no polling here.
  const photos =
    useLiveQuery(
      () => (sessionId ? listSessionPhotos(sessionId) : Promise.resolve([])),
      [sessionId],
    ) ?? [];

  useEffect(() => {
    setSessionId(readActiveSessionId());
  }, []);

  /** Mint the spesa id on first use — no network call, works in airplane mode. */
  function ensureSessionId(): string {
    if (sessionId) {
      return sessionId;
    }
    const created = createSessionId();
    writeActiveSessionId(created);
    setSessionId(created);
    return created;
  }

  async function handleCapture(source: Blob): Promise<void> {
    const activeSessionId = ensureSessionId();
    setHasCapturedOnce(true);
    const compressed = await compressPhoto(source);
    // The shutter ends here. The sync engine observes the insert and takes
    // over — uploading now, or whenever signal returns.
    await enqueuePendingPhoto({
      sessionId: activeSessionId,
      storeId: storeId ?? undefined,
      blob: compressed.blob,
    });
  }

  // Why the catch: the retries are fired from a click and never awaited, so
  // an IndexedDB rejection would otherwise surface nowhere. The photos stay
  // queued locally either way; the toast says the retry did not take.
  async function handleRetry(photoId: string): Promise<void> {
    try {
      await retryFailedPhoto(photoId);
      await drainPendingPhotos();
    } catch (error) {
      console.error('Photo retry failed', { photoId, error });
      toast({ kind: 'error', message: tOffline('retryError') });
    }
  }

  async function handleRetryAll(): Promise<void> {
    try {
      await retryAllFailedPhotos(sessionId ?? undefined);
      await drainPendingPhotos();
    } catch (error) {
      console.error('Retry all failed', { sessionId, error });
      toast({ kind: 'error', message: tOffline('retryError') });
    }
  }

  async function handleDelete(photoId: string): Promise<void> {
    await deletePendingPhoto(photoId);
  }

  /*
   * Why the local queue is cleared only after the server answers: the blob
   * URLs of the uploaded photos live only in that queue. Clearing it after a
   * failed discard would leave those photos in storage with nothing left
   * that could ever delete them; keeping it lets the user try again.
   */
  async function handleDiscard(targetSessionId: string): Promise<void> {
    const localPhotos = await listSessionPhotos(targetSessionId);
    const result = await callAction(
      'discardShoppingSession',
      discardShoppingSession({
        sessionId: targetSessionId,
        blobUrls: localPhotos
          .map((photo) => photo.extraction?.blobUrl)
          .filter((url): url is string => Boolean(url)),
      }),
    );
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, t('resume.discardError')),
      });
      return;
    }
    await clearSessionPhotos(targetSessionId);
    if (readActiveSessionId() === targetSessionId) {
      clearActiveSessionId();
      setSessionId(null);
    }
    setIsResumeDismissed(true);
  }

  function handleResume(serverSessionId: string): void {
    writeActiveSessionId(serverSessionId);
    setSessionId(serverSessionId);
    setIsResumeDismissed(true);
  }

  // A spesa with photos queued on THIS device always wins over the server's
  // suggestion: those photos exist nowhere else and must not be orphaned.
  const serverSession = context.resumableSession;
  const shouldOfferResume =
    !isResumeDismissed &&
    serverSession !== null &&
    serverSession.id !== sessionId &&
    photos.length === 0;
  const isStale = serverSession !== null && Date.now() - serverSession.startedAt > STALE_SESSION_MS;
  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const reviewableCount = photos.length;

  return (
    <motion.div
      layoutId={isReduced ? undefined : SCAN_MORPH_LAYOUT_ID}
      transition={spring}
      className="fixed inset-0 z-30 overflow-hidden bg-camera"
      style={{ borderRadius: 0 }}
      data-testid="scan-screen"
    >
      <CameraView
        onCapture={handleCapture}
        onClose={() => router.push('/')}
        isHintVisible={!hasCapturedOnce}
        topBar={
          <div className="flex flex-1 items-center gap-2">
            <IconButton
              icon={<X />}
              label={t('close')}
              onClick={() => router.push('/')}
              className="bg-camera/50 text-camera-contrast hover:bg-camera/70"
            />
            <button
              type="button"
              onClick={() => setIsStorePickerOpen(true)}
              data-testid="store-chip"
              className={cx(
                'flex h-11 max-w-[60%] items-center gap-2 rounded-full px-3.5 font-sans font-medium text-[14px] backdrop-blur-sm',
                selectedStore
                  ? 'bg-camera-contrast text-camera'
                  : 'bg-camera/50 text-camera-contrast',
              )}
            >
              <StoreIcon aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate">{selectedStore?.name ?? t('chooseStore')}</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 opacity-70" />
            </button>
          </div>
        }
        bottomBar={({ isOnCamera }) => (
          <div className="flex flex-col gap-3">
            <PhotoTray
              photos={photos}
              onRetry={handleRetry}
              onDelete={handleDelete}
              isOnCamera={isOnCamera}
            />
            <QueueStatusLine
              sessionId={sessionId}
              onRetryAll={handleRetryAll}
              isOnCamera={isOnCamera}
            />
            {reviewableCount > 0 && (
              <Button href="/scan/review" size="lg" data-testid="review-cta" className="w-full">
                {t('review', { count: reviewableCount })}
              </Button>
            )}
          </div>
        )}
      />

      <StorePickerSheet
        isOpen={isStorePickerOpen}
        onClose={() => setIsStorePickerOpen(false)}
        stores={stores}
        selectedId={storeId}
        onSelect={setStoreId}
        onCreate={handleCreateStore}
        noneLabel={t('storePicker.none')}
        title={t('storePicker.title')}
      />

      <Sheet
        isOpen={shouldOfferResume}
        onClose={() => setIsResumeDismissed(true)}
        title={isStale ? t('stale.title') : t('resume.title')}
        description={isStale ? t('stale.body') : t('resume.body')}
      >
        {serverSession && (
          <div className="flex flex-col gap-2">
            <Button onClick={() => handleResume(serverSession.id)} size="lg">
              {t('resume.resume')}
            </Button>
            <Button variant="secondary" onClick={() => void handleDiscard(serverSession.id)}>
              {t('resume.discard')}
            </Button>
          </div>
        )}
      </Sheet>
    </motion.div>
  );
}
