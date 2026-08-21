'use client';

/**
 * The horizontal strip of captured photos under the viewfinder (Spec 03 §3.2).
 *
 * It is the only feedback the user gets that a photo made it out of the
 * camera and how far it has travelled, so every queue status is visible here
 * — including the failures the sync engine cannot resolve on its own.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Link } from '@/lib/i18n/navigation';
import type { PendingPhoto, PendingPhotoStatus } from '@/lib/offline/db';

/** Error codes that mean the photo itself is unusable, not the connection. */
const INVALID_PHOTO_CODES = new Set(['PHOTO_TOO_LARGE', 'UNSUPPORTED_PHOTO_TYPE', 'INVALID_INPUT']);

export interface PhotoTrayProps {
  photos: PendingPhoto[];
  onRetry: (photoId: string) => void;
  onDelete: (photoId: string) => void;
}

export function PhotoTray({ photos, onRetry, onDelete }: PhotoTrayProps) {
  const t = useTranslations('scan');
  const thumbnailUrls = useObjectUrls(photos);
  const hasExtractedPhotos = photos.some((photo) => photo.status === 'extracted');

  if (photos.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3" aria-label={t('tray.label')}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm" data-testid="tray-count">
          {t('tray.count', { count: photos.length })}
        </span>
        {hasExtractedPhotos && (
          <Link
            href="/scan/review"
            className="rounded-full bg-accent px-4 py-2 font-medium text-accent-contrast text-sm"
          >
            {t('tray.review')}
          </Link>
        )}
      </div>

      <ul className="flex gap-3 overflow-x-auto pb-1">
        {photos.map((photo) => (
          <li key={photo.id} className="flex w-28 shrink-0 flex-col gap-1">
            {/* biome-ignore lint/performance/noImgElement: the source is a local
                blob: URL for a photo that never reached a server — next/image
                cannot optimize it and would only add a failing request. */}
            <img
              src={thumbnailUrls[photo.id]}
              alt=""
              className="h-28 w-28 rounded-xl object-cover"
            />
            <span className="text-text-muted text-xs" data-testid={`photo-status-${photo.status}`}>
              {t(statusMessageKey(photo.status, photo.lastError))}
            </span>
            {photo.status === 'failed' && (
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => onRetry(photo.id)} className="text-accent">
                  {t('tray.retry')}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(photo.id)}
                  className="text-text-muted"
                >
                  {t('tray.delete')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The `scan.*` message key describing a photo's place in the pipeline (§12). */
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
