/**
 * The single-photo uploader (Spec 03 §5.4). Spec 06's sync engine decides
 * when to call it; Spec 03 calls it fire-and-forget right after enqueueing
 * whenever the browser believes it is online.
 */
import type { ExtractPhotoResponse } from '@/lib/services/extract-photo-entry';
import type { PendingPhoto } from './db';
import { markPhotoExtracted, markPhotoFailed } from './photo-queue';

/**
 * Upload one pending photo to /api/extract and persist the outcome in Dexie.
 *
 * Never throws: every outcome lands in the photo's status. Spec 06's sync
 * engine decides when to call this; Spec 03 calls it fire-and-forget right
 * after enqueueing when navigator.onLine is true.
 */
export async function uploadPendingPhoto(photo: PendingPhoto): Promise<void> {
  const formData = new FormData();
  formData.append('photo', photo.blob, photo.id);
  formData.append('photoId', photo.id);
  formData.append('sessionId', photo.sessionId);
  if (photo.storeId) {
    formData.append('storeId', photo.storeId);
  }

  // 30 s abort guard: supermarket connectivity can hang a request forever,
  // and a hung upload would block the whole queue.
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), 30_000);

  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      body: formData,
      signal: abortController.signal,
    });

    if (response.ok) {
      const payload = (await response.json()) as ExtractPhotoResponse;
      await markPhotoExtracted(photo.id, payload);
      return;
    }

    // Retryable: HTTP 408, 429 and >= 500 are transient (timeouts, rate
    // limits, upstream outages); any other 4xx means this exact photo will
    // never succeed unchanged. Spec 06's sync engine uses this exact
    // classification — keep the two in lockstep.
    const isRetryable =
      response.status === 408 || response.status === 429 || response.status >= 500;
    const errorCode = await readErrorCode(response);
    await markPhotoFailed(photo.id, errorCode, isRetryable);
  } catch {
    // fetch rejects on network failure or the 30 s abort — both retryable.
    await markPhotoFailed(photo.id, 'network', true);
  } finally {
    clearTimeout(abortTimer);
  }
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    return body.error?.code ?? `http-${response.status}`;
  } catch {
    return `http-${response.status}`;
  }
}
