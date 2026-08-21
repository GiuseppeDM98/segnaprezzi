/**
 * The single-photo transport.
 *
 * Design: this module owns the HTTP call to /api/extract and the
 * retryable/non-retryable classification of its failures — nothing else. The
 * sync engine owns what happens next (backoff, attempt budget, persistence),
 * because that policy has to be identical whether the drain runs in the page
 * or in the service worker's Background Sync handler.
 */
import type { ExtractPhotoResponse } from '@/lib/services/extract-photo-entry';
import type { PendingPhoto } from './db';

/** 30 s cap per attempt: supermarket connectivity can hang a request forever. */
const REQUEST_TIMEOUT_MS = 30_000;

export type UploadOutcome =
  | { kind: 'extracted'; response: ExtractPhotoResponse }
  | { kind: 'error'; errorCode: string; message: string; isRetryable: boolean };

/**
 * Upload one pending photo to /api/extract.
 *
 * Never throws: every outcome — including a dead network — comes back as an
 * `UploadOutcome` for the caller to persist.
 */
export async function uploadPendingPhoto(photo: PendingPhoto): Promise<UploadOutcome> {
  const formData = new FormData();
  formData.append('photo', photo.blob, photo.id);
  formData.append('photoId', photo.id);
  formData.append('sessionId', photo.sessionId);
  if (photo.storeId) {
    formData.append('storeId', photo.storeId);
  }

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      body: formData,
      signal: abortController.signal,
    });

    if (response.ok) {
      const payload = (await response.json()) as ExtractPhotoResponse;
      return { kind: 'extracted', response: payload };
    }

    // Retryable: HTTP 408, 429 and >= 500 are transient (timeouts, rate
    // limits, upstream outages); any other 4xx means this exact photo will
    // never succeed unchanged.
    const isRetryable =
      response.status === 408 || response.status === 429 || response.status >= 500;
    return {
      kind: 'error',
      errorCode: await readErrorCode(response),
      message: `HTTP ${response.status}`,
      isRetryable,
    };
  } catch (error) {
    // fetch rejects on network failure or the 30 s abort — both retryable.
    return {
      kind: 'error',
      errorCode: 'network',
      message: error instanceof Error ? error.message : 'Network error',
      isRetryable: true,
    };
  } finally {
    clearTimeout(abortTimer);
  }
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    return body.error?.code ?? `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}
