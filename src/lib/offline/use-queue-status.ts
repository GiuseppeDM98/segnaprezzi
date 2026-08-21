'use client';

/**
 * Live queue status (Spec 06 §5.5).
 *
 * Design: Dexie's useLiveQuery re-runs the query on every write to the
 * observed tables, so a status flip in the service worker's drain reaches
 * the Scan and Review screens with no polling and no refresh.
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { LAST_SYNC_AT_KEY, offlineDb, type PendingPhoto } from './db';

export interface QueueStatus {
  queuedCount: number;
  uploadingCount: number;
  extractedCount: number;
  failedCount: number;
  /** True while anything is queued or uploading — drives the Scan indicator. */
  hasPendingWork: boolean;
  /** Epoch ms of the last successful extraction (syncMeta), null if never. */
  lastSyncAt: number | null;
}

const EMPTY_STATUS: QueueStatus = {
  queuedCount: 0,
  uploadingCount: 0,
  extractedCount: 0,
  failedCount: 0,
  hasPendingWork: false,
  lastSyncAt: null,
};

/**
 * Subscribe to queue counters, optionally scoped to one shopping session
 * (the Scan screen passes the active sessionId; global consumers such as the
 * Dashboard cached-data banner pass none).
 */
export function useQueueStatus(sessionId?: string): QueueStatus {
  const status = useLiveQuery(async () => {
    const photos = sessionId
      ? await offlineDb.pendingPhotos.where('sessionId').equals(sessionId).toArray()
      : await offlineDb.pendingPhotos.toArray();
    const lastSync = await offlineDb.syncMeta.get(LAST_SYNC_AT_KEY);
    return toQueueStatus(photos, lastSync?.value);
  }, [sessionId]);

  // useLiveQuery returns undefined for the first render (and forever where
  // IndexedDB is unavailable, e.g. Firefox private mode): an empty queue is
  // the honest reading in both cases.
  return status ?? EMPTY_STATUS;
}

/** Pure counter fold — exported so the sync tests can assert on it directly. */
export function toQueueStatus(photos: PendingPhoto[], lastSyncValue: unknown): QueueStatus {
  const queuedCount = photos.filter((photo) => photo.status === 'queued').length;
  const uploadingCount = photos.filter((photo) => photo.status === 'uploading').length;
  return {
    queuedCount,
    uploadingCount,
    extractedCount: photos.filter((photo) => photo.status === 'extracted').length,
    failedCount: photos.filter((photo) => photo.status === 'failed').length,
    hasPendingWork: queuedCount + uploadingCount > 0,
    lastSyncAt: typeof lastSyncValue === 'number' ? lastSyncValue : null,
  };
}
