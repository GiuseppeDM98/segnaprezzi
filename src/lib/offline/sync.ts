/**
 * The offline sync engine.
 *
 * Design: capture is local-first, so the queue is the app's real source of
 * truth while shopping and the network is an opportunistic consumer of it.
 * The engine therefore never blocks a capture and never asks the user to
 * press anything: it drains on app start, on `online`, on tab focus, right
 * after an enqueue, and — where Background Sync exists — even after the tab
 * is gone. Every drain is idempotent (the photo id is the idempotency key),
 * which is what lets the page and the service worker both hold a valid
 * claim on the same queue.
 *
 * Client-only module: it runs in the page and in the service worker, and
 * imports nothing from next/*, db/ or services/.
 */
import { LAST_SYNC_AT_KEY, offlineDb } from './db';
import {
  MAX_UPLOAD_ATTEMPTS,
  markPhotoExtracted,
  markPhotoFailed,
  recoverInterruptedUploads,
  reschedulePhoto,
  takeNextQueuedPhoto,
} from './photo-queue';
import { uploadPendingPhoto } from './upload-photo';

/*
 * Delays applied after failed attempt N (1-indexed). Deterministic, with no
 * jitter: one client uploading two photos at a time has no thundering-herd
 * problem, and determinism is what makes the fake-timer tests exact.
 *
 * With MAX_UPLOAD_ATTEMPTS = 5 the fifth failure parks the photo as `failed`
 * rather than waiting again, so the delays that can actually elapse are
 * 1/2/4/8 s. The 16 s entry is kept as the schedule's last rung in case the
 * attempt budget is ever raised.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/** At most two /api/extract requests in flight: two ~400 KB uploads saturate
 *  a weak uplink without starving it. */
const DRAIN_CONCURRENCY = 2;

/** Web Lock name shared by the page engine and the service worker handler. */
const SYNC_LOCK_NAME = 'segnaprezzi-sync';

/** Background Sync tag; the service worker's `sync` handler matches on it. */
export const PHOTO_SYNC_TAG = 'segnaprezzi-photo-sync';

/** The Background Sync API is Chromium-only and absent from TypeScript's DOM lib. */
interface BackgroundSyncManager {
  register(tag: string): Promise<void>;
}

/** Guards the drain where the Web Locks API is unavailable. */
let isDraining = false;
/** Timer for the earliest `nextAttemptAt` still in the queue. */
let backoffTimer: ReturnType<typeof setTimeout> | undefined;
/** The disposer of the running engine — `startSyncEngine` is idempotent. */
let disposeEngine: (() => void) | null = null;
/** `navigator.storage.persist()` is asked once per page load, not per photo. */
let hasRequestedPersistence = false;

/**
 * Start the sync engine: recover interrupted uploads, attach the four
 * page-side triggers (online, tab focus, enqueue, Background Sync), and
 * run an initial drain. Idempotent —
 * subsequent calls return the existing disposer.
 *
 * @returns Disposer that detaches every listener (used by tests and HMR).
 */
export function startSyncEngine(): () => void {
  if (disposeEngine) {
    return disposeEngine;
  }

  function handleOnline(): void {
    void drainPendingPhotos();
  }

  function handleVisibilityChange(): void {
    // Mobile browsers freeze timers in the background, so a scheduled
    // backoff drain may simply never have run — this is the catch-up.
    if (document.visibilityState === 'visible') {
      void drainPendingPhotos();
    }
  }

  // Observing the table rather than wrapping enqueuePendingPhoto() keeps
  // the capture flow calling the queue's primitive directly.
  function handlePhotoCreated(this: { onsuccess?: (primKey: string) => void }): void {
    this.onsuccess = () => {
      void handleEnqueue();
    };
  }

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  offlineDb.pendingPhotos.hook('creating', handlePhotoCreated);

  void recoverInterruptedUploads().then(() => drainPendingPhotos());

  disposeEngine = () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    offlineDb.pendingPhotos.hook('creating').unsubscribe(handlePhotoCreated);
    clearTimeout(backoffTimer);
    backoffTimer = undefined;
    disposeEngine = null;
  };
  return disposeEngine;
}

/**
 * Drain every due queued photo with concurrency 2, then arm a timer for the
 * earliest photo still serving its backoff.
 *
 * Exported for the service worker's `sync` handler; the page reaches it
 * through `startSyncEngine`'s triggers. Returns as soon as another context
 * is already draining — the Web Lock, not a flag, is what makes that safe
 * across page and worker.
 */
export async function drainPendingPhotos(): Promise<void> {
  // `navigator.onLine === false` is the one reliable half of that flag: it
  // means there is definitely no network. Attempting anyway would spend an
  // attempt from every photo's budget of five on a request that cannot
  // leave the device — the `online` event will call us back soon enough.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }

  await withSyncLock(async () => {
    const workers = Array.from({ length: DRAIN_CONCURRENCY }, () => runDrainWorker());
    await Promise.all(workers);
    await scheduleNextAttempt();
  });
}

/** Pull photos off the queue until nothing is due, one attempt at a time. */
async function runDrainWorker(): Promise<void> {
  while (true) {
    const photo = await takeNextQueuedPhoto(Date.now());
    if (!photo) {
      return;
    }

    const outcome = await uploadPendingPhoto(photo);
    if (outcome.kind === 'extracted') {
      await markPhotoExtracted(photo.id, outcome.response);
      await writeSyncMeta(LAST_SYNC_AT_KEY, Date.now());
      continue;
    }

    // `photo.attempts` already counts this attempt: the claim incremented it.
    const canRetry = outcome.isRetryable && photo.attempts < MAX_UPLOAD_ATTEMPTS;
    if (canRetry) {
      const delay =
        RETRY_DELAYS_MS[photo.attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await reschedulePhoto(photo.id, Date.now() + delay, outcome.errorCode, outcome.message);
      continue;
    }
    await markPhotoFailed(photo.id, outcome.errorCode, outcome.message);
  }
}

/**
 * Arm a single timer for the earliest photo still waiting out its backoff,
 * so a queue with nothing due does not spin and nothing waits for the next
 * connectivity event to be retried.
 */
async function scheduleNextAttempt(): Promise<void> {
  clearTimeout(backoffTimer);
  backoffTimer = undefined;

  const queued = await offlineDb.pendingPhotos.where('status').equals('queued').toArray();
  const gates = queued
    .map((photo) => photo.nextAttemptAt)
    .filter((gate): gate is number => typeof gate === 'number');
  if (gates.length === 0) {
    return;
  }

  const delay = Math.max(0, Math.min(...gates) - Date.now());
  backoffTimer = setTimeout(() => {
    backoffTimer = undefined;
    void drainPendingPhotos();
  }, delay);
}

/**
 * Run `body` while holding the cross-context sync lock, or return without
 * running it when someone else already holds it.
 *
 * Where the Web Locks API is missing, a module-scoped flag guards the page
 * context alone; an overlap with the service worker is then theoretically
 * possible and harmless, because retrying a photo id is idempotent end to
 * end.
 */
async function withSyncLock(body: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) {
        await body();
      }
    });
    return;
  }

  if (isDraining) {
    return;
  }
  isDraining = true;
  try {
    await body();
  } finally {
    isDraining = false;
  }
}

/** Everything that must happen once a freshly captured photo hits the queue. */
async function handleEnqueue(): Promise<void> {
  requestPersistentStorage();
  registerBackgroundSync();
  if (navigator.onLine) {
    await drainPendingPhotos();
  }
}

/**
 * Ask the browser to exempt this origin's storage from eviction.
 *
 * Best effort by design: Chromium grants it silently for installed apps,
 * Safari ignores it outright (its 7-day eviction rule is why the iOS install
 * sheet exists at all). Never awaited — the shutter must not
 * wait on a permission heuristic.
 */
function requestPersistentStorage(): void {
  if (hasRequestedPersistence || typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return;
  }
  hasRequestedPersistence = true;
  void navigator.storage.persist().catch(() => {
    // A refused or unsupported request changes nothing: the queue still works.
  });
}

/**
 * Register a Background Sync so the queue drains even if the tab is closed
 * before signal returns. Chromium-only progressive enhancement; everywhere
 * else the four page-driven triggers cover the same ground on next open.
 *
 * Not awaited: `serviceWorker.ready` never settles when no worker is
 * registered (dev, or a browser without service workers).
 */
function registerBackgroundSync(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  void navigator.serviceWorker.ready
    .then((registration) => {
      const syncManager = (
        registration as ServiceWorkerRegistration & { sync?: BackgroundSyncManager }
      ).sync;
      return syncManager?.register(PHOTO_SYNC_TAG);
    })
    .catch(() => {
      // Background Sync can be denied by permissions policy; the page-driven
      // triggers remain, so there is nothing to report.
    });
}

/** Write one bookkeeping value; the queue-status hook reads it live. */
async function writeSyncMeta(key: string, value: unknown): Promise<void> {
  await offlineDb.syncMeta.put({ key, value });
}

// Queue writes are not redefined here: capture calls
// enqueuePendingPhoto() from photo-queue.ts, and manual retry is
// retryFailedPhoto(), re-exported so sync consumers have one import point.
export { retryAllFailedPhotos, retryFailedPhoto } from './photo-queue';
