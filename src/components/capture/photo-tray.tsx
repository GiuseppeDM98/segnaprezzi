'use client';

/**
 * The horizontal strip of captured photos (Spec 05 §6.3): one thumbnail per
 * photo with a status chip mapping exactly the four queue statuses —
 * queued · uploading · extracted · failed. Failed chips retry on tap; a tap
 * on any thumbnail opens the preview/delete sheet. New thumbnails spring in
 * from the shutter with the house spring.
 */
import { AlertCircle, Check, Clock, CloudUpload, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';
import { cx } from '@/lib/cx';
import { useAppMotion } from '@/lib/motion';
import type { PendingPhoto, PendingPhotoStatus } from '@/lib/offline/db';

/** Error codes that mean the photo itself is unusable, not the connection. */
const INVALID_PHOTO_CODES = new Set(['PHOTO_TOO_LARGE', 'UNSUPPORTED_PHOTO_TYPE', 'INVALID_INPUT']);

const STATUS_TONE: Record<PendingPhotoStatus, ChipTone> = {
  queued: 'neutral',
  uploading: 'accent',
  extracted: 'positive',
  failed: 'negative',
};

const STATUS_ICON: Record<PendingPhotoStatus, typeof Check> = {
  queued: Clock,
  uploading: CloudUpload,
  extracted: Check,
  failed: AlertCircle,
};

export interface PhotoTrayProps {
  photos: PendingPhoto[];
  onRetry: (photoId: string) => void;
  onDelete: (photoId: string) => void;
  /** Dark chrome when the tray sits over the viewfinder. */
  isOnCamera?: boolean;
}

export function PhotoTray({ photos, onRetry, onDelete, isOnCamera = false }: PhotoTrayProps) {
  const t = useTranslations('scan');
  const tCommon = useTranslations('common');
  const { isReduced, spring, fade } = useAppMotion();
  const thumbnailUrls = useObjectUrls(photos);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = photos.find((photo) => photo.id === previewId) ?? null;

  if (photos.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t('tray.label')}>
      <span
        className={cx(
          'font-mono text-[12px] uppercase tracking-wide',
          isOnCamera ? 'text-camera-contrast/80' : 'text-text-muted',
        )}
        data-testid="tray-count"
      >
        {t('tray.count', { count: photos.length })}
      </span>
      <ul className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        <AnimatePresence initial={false}>
          {photos.map((photo) => {
            const Icon = STATUS_ICON[photo.status];
            return (
              <motion.li
                key={photo.id}
                layout={!isReduced}
                initial={isReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={isReduced ? fade : spring}
                className="flex w-[88px] shrink-0 flex-col gap-1.5"
              >
                <button
                  type="button"
                  onClick={() =>
                    photo.status === 'failed' ? onRetry(photo.id) : setPreviewId(photo.id)
                  }
                  aria-label={
                    photo.status === 'failed'
                      ? t('tray.retry')
                      : `${t('tray.preview')} · ${t(`status.${photo.status}`)}`
                  }
                  className="relative aspect-square overflow-hidden rounded-control border border-camera-contrast/20 bg-camera"
                >
                  {/* biome-ignore lint/performance/noImgElement: the source is a local
                      blob: URL for a photo that never reached a server — next/image
                      cannot optimize it and would only add a failing request. */}
                  <img
                    src={thumbnailUrls[photo.id]}
                    alt=""
                    className={cx(
                      'h-full w-full object-cover',
                      photo.status === 'uploading' && 'opacity-70',
                    )}
                  />
                </button>
                <Chip
                  variant="status"
                  tone={STATUS_TONE[photo.status]}
                  icon={<Icon />}
                  data-testid={`photo-status-${photo.status}`}
                  className="self-start"
                >
                  {t(`status.${photo.status}`)}
                </Chip>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <Sheet isOpen={preview !== null} onClose={() => setPreviewId(null)} title={t('tray.preview')}>
        {preview && (
          <div className="flex flex-col gap-4">
            {/* biome-ignore lint/performance/noImgElement: local blob: URL, see above */}
            <img
              src={thumbnailUrls[preview.id]}
              alt=""
              className="max-h-[55dvh] w-full rounded-control bg-camera object-contain"
            />
            <p className="font-sans text-[14px] text-text-muted">
              {t(statusMessageKey(preview.status, preview.lastError))}
            </p>
            <div className="flex gap-2">
              {preview.status === 'failed' && (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    onRetry(preview.id);
                    setPreviewId(null);
                  }}
                >
                  {t('tray.retry')}
                </Button>
              )}
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                className="flex-1"
                onClick={() => {
                  onDelete(preview.id);
                  setPreviewId(null);
                }}
              >
                {t('tray.delete')}
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setPreviewId(null)}>
              {tCommon('close')}
            </Button>
          </div>
        )}
      </Sheet>
    </section>
  );
}

/** The `scan.*` message key describing a photo's place in the pipeline. */
function statusMessageKey(status: PendingPhotoStatus, lastError: string | undefined): string {
  switch (status) {
    case 'queued':
      return 'queue.offline';
    case 'uploading':
      return 'queue.uploading';
    case 'extracted':
      return 'queue.extracted';
    default:
      if (lastError === 'EXTRACTION_FAILED') {
        return 'errors.extractionFailed';
      }
      if (lastError && INVALID_PHOTO_CODES.has(lastError)) {
        return 'errors.invalidPhoto';
      }
      return 'errors.uploadFailed';
  }
}

/**
 * Object URLs for the queued blobs, keyed by photo id.
 *
 * Cached in a ref rather than recomputed per render: an object URL pins its
 * blob in memory until revoked, so recreating them whenever the tray
 * re-renders would leak a full-size photo per render — on a device whose
 * memory budget is the reason we compress in the first place — and would
 * blank every thumbnail for a frame. The whole cache is revoked on unmount.
 */
function useObjectUrls(photos: PendingPhoto[]): Record<string, string> {
  const cacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  const urls: Record<string, string> = {};
  for (const photo of photos) {
    const cached = cacheRef.current.get(photo.id);
    const url = cached ?? URL.createObjectURL(photo.blob);
    cacheRef.current.set(photo.id, url);
    urls[photo.id] = url;
  }
  return urls;
}
