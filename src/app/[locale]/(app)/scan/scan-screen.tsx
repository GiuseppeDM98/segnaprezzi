'use client';

/**
 * Client half of the capture screen: session resume, store picker, camera,
 * tray (Spec 03 §2.3, §3.2).
 *
 * Design: the spesa is client-owned. The session id is minted on the first
 * shutter press and never waits for the network; uploads are fired and
 * forgotten. Everything the user sees comes from Dexie, so a lost connection
 * changes only the status chips, never what is on screen.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { CameraCapture } from '@/components/capture/camera-capture';
import { PhotoTray } from '@/components/capture/photo-tray';
import { compressPhoto } from '@/lib/offline/compress';
import type { PendingPhoto } from '@/lib/offline/db';
import {
  clearActiveSessionId,
  clearSessionPhotos,
  createSessionId,
  deletePendingPhoto,
  enqueuePendingPhoto,
  listSessionPhotos,
  readActiveSessionId,
  retryFailedPhoto,
  writeActiveSessionId,
} from '@/lib/offline/photo-queue';
import { uploadPendingPhoto } from '@/lib/offline/upload-photo';
import type { ScanContext } from '@/lib/services/capture-context';
import { discardShoppingSession } from './actions';

/** After this long a spesa is more likely forgotten than still in progress. */
const STALE_SESSION_MS = 24 * 60 * 60 * 1000;

export interface ScanScreenProps {
  context: ScanContext;
}

export function ScanScreen({ context }: ScanScreenProps) {
  const t = useTranslations('scan');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [storeId, setStoreId] = useState<string | undefined>(context.defaultStoreId ?? undefined);
  const [isResumeDismissed, setIsResumeDismissed] = useState(false);

  const refreshPhotos = useCallback(async (activeSessionId: string) => {
    setPhotos(await listSessionPhotos(activeSessionId));
  }, []);

  useEffect(() => {
    const storedSessionId = readActiveSessionId();
    if (!storedSessionId) {
      return;
    }
    setSessionId(storedSessionId);
    void refreshPhotos(storedSessionId);
  }, [refreshPhotos]);

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
    const compressed = await compressPhoto(source);
    const photo = await enqueuePendingPhoto({
      sessionId: activeSessionId,
      storeId,
      blob: compressed.blob,
    });
    await refreshPhotos(activeSessionId);

    // Fire-and-forget: the shutter must never wait for the network. Spec 06's
    // sync engine owns retries; this is only the optimistic first attempt.
    if (navigator.onLine) {
      void uploadPendingPhoto(photo).then(() => refreshPhotos(activeSessionId));
    }
  }

  async function handleRetry(photoId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    await retryFailedPhoto(photoId);
    await refreshPhotos(sessionId);
    const photo = (await listSessionPhotos(sessionId)).find((item) => item.id === photoId);
    if (photo && navigator.onLine) {
      await uploadPendingPhoto(photo);
      await refreshPhotos(sessionId);
    }
  }

  async function handleDelete(photoId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    await deletePendingPhoto(photoId);
    await refreshPhotos(sessionId);
  }

  async function handleDiscard(targetSessionId: string): Promise<void> {
    const localPhotos = await listSessionPhotos(targetSessionId);
    await discardShoppingSession({
      sessionId: targetSessionId,
      blobUrls: localPhotos
        .map((photo) => photo.extraction?.blobUrl)
        .filter((url): url is string => Boolean(url)),
    });
    await clearSessionPhotos(targetSessionId);
    if (readActiveSessionId() === targetSessionId) {
      clearActiveSessionId();
      setSessionId(null);
    }
    setPhotos([]);
    setIsResumeDismissed(true);
  }

  function handleResume(serverSessionId: string): void {
    writeActiveSessionId(serverSessionId);
    setSessionId(serverSessionId);
    void refreshPhotos(serverSessionId);
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

  return (
    <div className="flex flex-col gap-4">
      {shouldOfferResume && serverSession && (
        <section className="flex flex-col gap-2 rounded-2xl bg-surface-raised p-4">
          <h2 className="font-medium">{isStale ? t('stale.title') : t('resume.title')}</h2>
          <p className="text-sm text-text-muted">{isStale ? t('stale.body') : t('resume.body')}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleResume(serverSession.id)}
              className="rounded-full bg-accent px-4 py-2 font-medium text-accent-contrast text-sm"
            >
              {t('resume.resume')}
            </button>
            <button
              type="button"
              onClick={() => handleDiscard(serverSession.id)}
              className="rounded-full border border-border px-4 py-2 text-sm"
            >
              {t('resume.discard')}
            </button>
          </div>
        </section>
      )}

      {context.stores.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          {t('storePicker.label')}
          <select
            value={storeId ?? ''}
            onChange={(event) => setStoreId(event.target.value || undefined)}
            className="flex-1 rounded-lg border border-border bg-surface p-2"
          >
            <option value="">{t('storePicker.none')}</option>
            {context.stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <CameraCapture onCapture={handleCapture} />

      <PhotoTray photos={photos} onRetry={handleRetry} onDelete={handleDelete} />

      {sessionId && photos.length > 0 && (
        <button
          type="button"
          onClick={() => handleDiscard(sessionId)}
          className="self-start text-sm text-text-muted underline"
        >
          {t('discardSession')}
        </button>
      )}
    </div>
  );
}
