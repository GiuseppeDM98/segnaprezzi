/**
 * The enqueue/dequeue API of the offline photo queue (Spec 03 §5.2).
 *
 * Spec 03 owns this data contract; Spec 06's sync engine decides *when* to
 * call these — connectivity listeners, backoff and service-worker
 * integration are deliberately not here.
 */
import { nanoid } from 'nanoid';

import type { ExtractPhotoResponse } from '@/lib/services/extract-photo-entry';
import { offlineDb, type PendingPhoto } from './db';

export const MAX_UPLOAD_ATTEMPTS = 5;

/**
 * Where this device remembers which spesa is in progress.
 *
 * localStorage rather than a server round-trip: the first shutter press has
 * to work with the phone in airplane mode (Spec 03 §2.2), so the session id
 * is minted and kept locally until something reaches the server.
 */
export const ACTIVE_SESSION_STORAGE_KEY = 'segnaprezzi.activeSessionId';

/** The spesa in progress on this device, or null. */
export function readActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
}

/** Adopt a session id as this device's spesa in progress. */
export function writeActiveSessionId(sessionId: string): void {
  localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
}

/** Forget the spesa in progress — after confirm or discard. */
export function clearActiveSessionId(): void {
  localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
}

/** Mint the id of a brand-new spesa. Client-side, no network involved. */
export function createSessionId(): string {
  return nanoid();
}

/** Add a freshly compressed photo to the queue, status 'queued'. */
export async function enqueuePendingPhoto(input: {
  sessionId: string;
  storeId?: string;
  blob: Blob;
}): Promise<PendingPhoto> {
  const photo: PendingPhoto = {
    id: nanoid(),
    sessionId: input.sessionId,
    storeId: input.storeId,
    blob: input.blob,
    status: 'queued',
    attempts: 0,
    createdAt: Date.now(),
  };
  await offlineDb.pendingPhotos.add(photo);
  return photo;
}

/** All photos of one session, oldest first — powers the tray and the review screen. */
export function listSessionPhotos(sessionId: string): Promise<PendingPhoto[]> {
  return offlineDb.pendingPhotos.where('sessionId').equals(sessionId).sortBy('createdAt');
}

/** Photos still travelling — powers the queue badge in the tab bar. */
export function countQueuedPhotos(): Promise<number> {
  return offlineDb.pendingPhotos.where('status').anyOf('queued', 'uploading').count();
}

/**
 * Claim the oldest queued photo for upload, atomically flipping it to
 * 'uploading'. Runs in a Dexie transaction so two concurrent sync ticks
 * (e.g. online event + manual retry) cannot claim the same photo.
 */
export function takeNextQueuedPhoto(): Promise<PendingPhoto | undefined> {
  return offlineDb.transaction('rw', offlineDb.pendingPhotos, async () => {
    const queuedPhotos = await offlineDb.pendingPhotos
      .where('status')
      .equals('queued')
      .sortBy('createdAt');
    const nextPhoto = queuedPhotos[0];
    if (!nextPhoto) {
      return undefined;
    }
    await offlineDb.pendingPhotos.update(nextPhoto.id, { status: 'uploading' });
    return { ...nextPhoto, status: 'uploading' as const };
  });
}

/** Store the server response and mark the photo ready for review. */
export async function markPhotoExtracted(
  id: string,
  response: ExtractPhotoResponse,
): Promise<void> {
  await offlineDb.pendingPhotos.update(id, {
    status: 'extracted',
    extraction: response,
    lastError: undefined,
  });
}

/**
 * Record a failed attempt. Retryable failures go back to 'queued' until
 * MAX_UPLOAD_ATTEMPTS is reached; everything else parks as 'failed' for
 * user-initiated retry or deletion.
 */
export async function markPhotoFailed(
  id: string,
  errorCode: string,
  isRetryable: boolean,
): Promise<void> {
  const photo = await offlineDb.pendingPhotos.get(id);
  if (!photo) {
    return;
  }
  const attempts = photo.attempts + 1;
  const status = isRetryable && attempts < MAX_UPLOAD_ATTEMPTS ? 'queued' : 'failed';
  await offlineDb.pendingPhotos.update(id, { status, attempts, lastError: errorCode });
}

/** User-initiated retry from the tray: reset the attempt budget. */
export async function retryFailedPhoto(id: string): Promise<void> {
  await offlineDb.pendingPhotos.update(id, {
    status: 'queued',
    attempts: 0,
    lastError: undefined,
  });
}

export async function deletePendingPhoto(id: string): Promise<void> {
  await offlineDb.pendingPhotos.delete(id);
}

/** Wipe a whole session's photos — after confirm or discard. */
export async function clearSessionPhotos(sessionId: string): Promise<void> {
  await offlineDb.pendingPhotos.where('sessionId').equals(sessionId).delete();
}
