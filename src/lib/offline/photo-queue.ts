/**
 * The enqueue/dequeue API of the offline photo queue.
 *
 * This module owns the data contract; the sync engine decides *when* to
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
 * to work with the phone in airplane mode, so the session id
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
 * Claim the oldest photo that is due for an attempt, atomically flipping it
 * to 'uploading' and counting the attempt. Runs in a Dexie transaction so
 * two concurrent sync workers cannot claim the same photo.
 *
 * @param now - Epoch ms the due gate is evaluated against; a photo whose
 *   `nextAttemptAt` is still in the future is left for a later drain.
 */
export function takeNextQueuedPhoto(now: number = Date.now()): Promise<PendingPhoto | undefined> {
  return offlineDb.transaction('rw', offlineDb.pendingPhotos, async () => {
    const queuedPhotos = await offlineDb.pendingPhotos
      .where('status')
      .equals('queued')
      .sortBy('createdAt');
    const nextPhoto = queuedPhotos.find((photo) => isPhotoDue(photo, now));
    if (!nextPhoto) {
      return undefined;
    }
    const attempts = nextPhoto.attempts + 1;
    await offlineDb.pendingPhotos.update(nextPhoto.id, { status: 'uploading', attempts });
    return { ...nextPhoto, status: 'uploading' as const, attempts };
  });
}

/** True when the backoff gate has expired (or was never set — pre-v2 rows). */
export function isPhotoDue(photo: PendingPhoto, now: number): boolean {
  return photo.nextAttemptAt == null || photo.nextAttemptAt <= now;
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
    lastErrorMessage: null,
    nextAttemptAt: null,
  });
}

/**
 * Park a photo for a later attempt: back to 'queued', invisible to the drain
 * until `nextAttemptAt`. The backoff schedule itself is the sync engine's
 * policy — this only writes the outcome.
 */
export async function reschedulePhoto(
  id: string,
  nextAttemptAt: number,
  errorCode: string,
  message: string,
): Promise<void> {
  await offlineDb.pendingPhotos.update(id, {
    status: 'queued',
    lastError: errorCode,
    lastErrorMessage: message,
    nextAttemptAt,
  });
}

/**
 * Give up on a photo: it parks as 'failed' and only a user-initiated retry
 * moves it again.
 */
export async function markPhotoFailed(
  id: string,
  errorCode: string,
  message: string,
): Promise<void> {
  await offlineDb.pendingPhotos.update(id, {
    status: 'failed',
    lastError: errorCode,
    lastErrorMessage: message,
    nextAttemptAt: null,
  });
}

/** User-initiated retry from the tray: reset the attempt budget. */
export async function retryFailedPhoto(id: string): Promise<void> {
  await offlineDb.pendingPhotos.update(id, {
    status: 'queued',
    attempts: 0,
    lastError: undefined,
    lastErrorMessage: null,
    nextAttemptAt: null,
  });
}

/**
 * Reset every failed photo, optionally only those of one session — the
 * "Riprova tutti" action of the Scan queue line.
 *
 * @returns How many photos were re-queued.
 */
export async function retryAllFailedPhotos(sessionId?: string): Promise<number> {
  const failed = await offlineDb.pendingPhotos.where('status').equals('failed').toArray();
  const targets = sessionId ? failed.filter((photo) => photo.sessionId === sessionId) : failed;
  for (const photo of targets) {
    await retryFailedPhoto(photo.id);
  }
  return targets.length;
}

/**
 * Crash recovery: an 'uploading' record cannot legitimately survive a
 * restart — its request died with the page — so every one of them goes back
 * to 'queued'. `attempts` is kept: the dead attempt counts.
 *
 * @returns How many photos were recovered.
 */
export async function recoverInterruptedUploads(): Promise<number> {
  const interrupted = await offlineDb.pendingPhotos.where('status').equals('uploading').toArray();
  for (const photo of interrupted) {
    await offlineDb.pendingPhotos.update(photo.id, { status: 'queued', nextAttemptAt: null });
  }
  return interrupted.length;
}

export async function deletePendingPhoto(id: string): Promise<void> {
  await offlineDb.pendingPhotos.delete(id);
}

/** Wipe a whole session's photos — after confirm or discard. */
export async function clearSessionPhotos(sessionId: string): Promise<void> {
  await offlineDb.pendingPhotos.where('sessionId').equals(sessionId).delete();
}
