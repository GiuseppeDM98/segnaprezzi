/*
 * Sync engine tests (Spec 06 §9.2).
 *
 * Three deliberate choices:
 * - Only `Date` is faked, never the timers. fake-indexeddb drives itself on
 *   real macrotasks, so faking setTimeout deadlocks Dexie mid-transaction;
 *   freezing the clock instead makes every `nextAttemptAt` an exact number
 *   and lets the backoff schedule be asserted by moving the clock forward
 *   and draining again, which is what the engine's own timer would do.
 * - The queue is a real IndexedDB (fake-indexeddb), not a mock: the
 *   transitions under test are precisely the ones that persist.
 * - The DOM is three stubs rather than happy-dom. happy-dom brings its own
 *   Blob and FormData classes, and a Blob that has been through IndexedDB
 *   comes back as Node's — which happy-dom's FormData then rejects. The
 *   engine only needs two event targets and a navigator.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ExtractPhotoResponse } from '@/lib/services/extract-photo-entry';
import { LAST_SYNC_AT_KEY, offlineDb, type PendingPhoto } from './db';
import { enqueuePendingPhoto, retryFailedPhoto } from './photo-queue';
import { drainPendingPhotos, startSyncEngine } from './sync';

const START_TIME = Date.parse('2026-08-21T10:00:00Z');

const EXTRACTION: ExtractPhotoResponse = {
  blobUrl: 'https://store.public.blob.vercel-storage.com/users/u/photos/p.webp',
  extraction: {
    productName: 'Latte intero 1L',
    brand: 'Granarolo',
    category: 'food',
    unitKind: 'volume',
    totalPriceCents: 149,
    packageSize: 1,
    unitPriceMilli: 1490,
    isPromo: false,
    promoKind: null,
    confidence: 0.94,
    rawText: 'Latte intero 1L 1,49 €',
    needsReview: false,
    reviewReasons: [],
  },
  suggestions: [],
  model: 'claude-haiku-4-5',
};

let disposeEngine: (() => void) | null = null;

/**
 * Install the smallest browser the engine can run in: a window and a
 * document to listen on, and a navigator whose connectivity we control.
 */
function stubBrowserGlobals(options: { isOnline: boolean }): void {
  vi.stubGlobal('window', new EventTarget());
  const documentStub = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('navigator', { onLine: options.isOnline });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START_TIME);
  stubBrowserGlobals({ isOnline: true });
  await offlineDb.pendingPhotos.clear();
  await offlineDb.syncMeta.clear();
});

afterEach(() => {
  disposeEngine?.();
  disposeEngine = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Enqueue one photo the way the capture flow does, with a tiny fake image. */
async function enqueuePhoto(sessionId = 'session-1'): Promise<PendingPhoto> {
  return enqueuePendingPhoto({
    sessionId,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
  });
}

function stubFetch(implementation: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(implementation);
  vi.stubGlobal('fetch', mock);
  return mock;
}

function okResponse(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(EXTRACTION), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function errorResponse(status: number): Promise<Response> {
  return Promise.resolve(new Response('{}', { status }));
}

/**
 * Poll `predicate` on real macrotasks until it holds.
 *
 * Not vi.waitFor(): with fake timers installed it advances them, which here
 * would move the frozen clock and make every `nextAttemptAt` assertion drift.
 */
async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitUntil timed out');
}

async function readPhoto(id: string): Promise<PendingPhoto> {
  const photo = await offlineDb.pendingPhotos.get(id);
  if (!photo) {
    throw new Error(`Photo ${id} disappeared from the queue`);
  }
  return photo;
}

describe('drainPendingPhotos', () => {
  test('should store the extraction and stamp lastSyncAt on success', async () => {
    stubFetch(okResponse);
    const photo = await enqueuePhoto();

    await drainPendingPhotos();

    const synced = await readPhoto(photo.id);
    expect(synced.status).toBe('extracted');
    expect(synced.extraction).toEqual(EXTRACTION);
    expect(synced.lastError).toBeUndefined();
    expect(await offlineDb.syncMeta.get(LAST_SYNC_AT_KEY)).toEqual({
      key: LAST_SYNC_AT_KEY,
      value: START_TIME,
    });
  });

  test('should back off 1s, 2s, 4s and 8s after consecutive retryable failures', async () => {
    stubFetch(() => errorResponse(503));
    const photo = await enqueuePhoto();

    const expectedDelays = [1_000, 2_000, 4_000, 8_000];
    let now = START_TIME;
    for (const [index, delay] of expectedDelays.entries()) {
      vi.setSystemTime(now);
      await drainPendingPhotos();

      const parked = await readPhoto(photo.id);
      expect(parked.status).toBe('queued');
      expect(parked.attempts).toBe(index + 1);
      expect(parked.nextAttemptAt).toBe(now + delay);
      now += delay;
    }
  });

  test('should leave a photo alone until its backoff has elapsed', async () => {
    const fetchMock = stubFetch(() => errorResponse(503));
    await enqueuePhoto();

    await drainPendingPhotos();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still inside the 1 s gate: the drain must find nothing due.
    vi.setSystemTime(START_TIME + 999);
    await drainPendingPhotos();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(START_TIME + 1_000);
    await drainPendingPhotos();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('should mark the photo failed after the fifth retryable failure', async () => {
    stubFetch(() => errorResponse(500));
    const photo = await enqueuePhoto();

    let now = START_TIME;
    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      vi.setSystemTime(now);
      await drainPendingPhotos();
      now += delay;
    }
    vi.setSystemTime(now);
    await drainPendingPhotos();

    const dead = await readPhoto(photo.id);
    expect(dead.status).toBe('failed');
    expect(dead.attempts).toBe(5);
    expect(dead.nextAttemptAt).toBeNull();
  });

  test('should fail immediately on HTTP 422 without scheduling a retry', async () => {
    const fetchMock = stubFetch(() => errorResponse(422));
    const photo = await enqueuePhoto();

    await drainPendingPhotos();

    const dead = await readPhoto(photo.id);
    expect(dead.status).toBe('failed');
    expect(dead.attempts).toBe(1);
    expect(dead.nextAttemptAt).toBeNull();

    // Nothing is due any more, so a later drain must not touch it.
    vi.setSystemTime(START_TIME + 60_000);
    await drainPendingPhotos();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('should never run more than two uploads at once', async () => {
    // Each request parks until the test releases it, so the number in flight
    // is observable rather than a matter of who won a microtask race.
    let inFlight = 0;
    let maxInFlight = 0;
    const parked: Array<() => void> = [];
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          parked.push(() => {
            inFlight -= 1;
            void okResponse().then(resolve);
          });
        }),
    );
    for (let index = 0; index < 6; index += 1) {
      await enqueuePhoto();
    }

    const drain = drainPendingPhotos();
    let isDrained = false;
    void drain.then(() => {
      isDrained = true;
    });
    while (!isDrained) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const release of parked.splice(0)) {
        release();
      }
    }
    await drain;

    expect(maxInFlight).toBe(2);
    expect(await offlineDb.pendingPhotos.where('status').equals('extracted').count()).toBe(6);
  });
});

describe('retryFailedPhoto', () => {
  test('should reset the attempt budget and let the next drain upload again', async () => {
    const fetchMock = stubFetch(() => errorResponse(413));
    const photo = await enqueuePhoto();
    await drainPendingPhotos();
    expect((await readPhoto(photo.id)).status).toBe('failed');

    fetchMock.mockImplementation(okResponse);
    await retryFailedPhoto(photo.id);

    const requeued = await readPhoto(photo.id);
    expect(requeued.status).toBe('queued');
    expect(requeued.attempts).toBe(0);
    expect(requeued.nextAttemptAt).toBeNull();

    await drainPendingPhotos();
    expect((await readPhoto(photo.id)).status).toBe('extracted');
  });
});

describe('startSyncEngine', () => {
  test('should re-queue interrupted uploads at startup and keep their attempts', async () => {
    stubFetch(() => errorResponse(503));
    const photo = await enqueuePhoto();
    // Simulate a page that died mid-upload on its third attempt.
    await offlineDb.pendingPhotos.update(photo.id, { status: 'uploading', attempts: 3 });

    disposeEngine = startSyncEngine();
    await waitUntil(async () => (await readPhoto(photo.id)).status === 'queued');

    const recovered = await readPhoto(photo.id);
    // 3 kept + this drain's own attempt, so the backoff is the fourth rung.
    expect(recovered.attempts).toBe(4);
    expect(recovered.nextAttemptAt).toBe(START_TIME + 8_000);
  });

  test('should drain a freshly captured photo while online', async () => {
    stubFetch(okResponse);
    disposeEngine = startSyncEngine();

    const photo = await enqueuePhoto();

    await waitUntil(async () => (await readPhoto(photo.id)).status === 'extracted');
  });

  test('should issue no request when a photo is enqueued while offline', async () => {
    stubBrowserGlobals({ isOnline: false });
    const fetchMock = stubFetch(okResponse);
    disposeEngine = startSyncEngine();

    const photo = await enqueuePhoto();
    await waitUntil(async () => (await offlineDb.pendingPhotos.count()) === 1);
    // Give every deferred trigger (engine start, enqueue hook) time to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await readPhoto(photo.id)).status).toBe('queued');
  });
});
