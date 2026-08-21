/**
 * The offline photo queue's IndexedDB schema (Spec 03 §5.1, Spec 06 §5.1).
 *
 * Design: supermarkets have terrible connectivity, so a captured photo is
 * durable locally before any network call is attempted. Each row carries its
 * own id — generated at capture time — which is reused as the Blob pathname
 * and later as price_entries.id, making the whole pipeline idempotent under
 * retries (§6.5).
 *
 * Client-only module: it is never imported by server code.
 */
import Dexie, { type EntityTable } from 'dexie';

import type { ExtractPhotoResponse } from '@/lib/services/extract-photo-entry';

export type PendingPhotoStatus = 'queued' | 'uploading' | 'extracted' | 'failed';

export interface PendingPhoto {
  /** nanoid(21), generated client-side. Becomes price_entries.id on confirm
   *  and names the Blob path — the idempotency key of the whole pipeline. */
  id: string;
  sessionId: string;
  storeId?: string;
  /** Compressed image from compressPhoto(): image/webp, or image/jpeg on Safari < 17. */
  blob: Blob;
  status: PendingPhotoStatus;
  /** Completed upload+extract attempts. The sync engine (Spec 06) backs off on this. */
  attempts: number;
  /** Short classification code, e.g. "network", "http_413" (Spec 06 §5.2). */
  lastError?: string;
  /** Human-readable detail for the failed-item UI; `lastError` stays the code. */
  lastErrorMessage?: string | null;
  /** Epoch ms gate for backoff. `null` (or absent, pre-v2) means due now. */
  nextAttemptAt?: number | null;
  /** Full /api/extract response, stored verbatim once status = 'extracted'.
   *  Immutable after write: it is the source for price_entries.ai_raw_json. */
  extraction?: ExtractPhotoResponse;
  /** Epoch milliseconds — doubles as the entry's recordedAt default. */
  createdAt: number;
}

/** Key-value sidecar for the sync engine's own bookkeeping (Spec 06 §5.1). */
export interface SyncMetaRecord {
  key: string;
  value: unknown;
}

/** The one key in use in v1: epoch ms of the last successful extraction. */
export const LAST_SYNC_AT_KEY = 'lastSyncAt';

export const offlineDb = new Dexie('segnaprezzi-offline') as Dexie & {
  pendingPhotos: EntityTable<PendingPhoto, 'id'>;
  syncMeta: EntityTable<SyncMetaRecord, 'key'>;
};

// Only queried fields are indexed; `blob` and `extraction` stay unindexed
// payloads (indexing a Blob would throw at runtime). `nextAttemptAt` is
// deliberately NOT indexed: its resting value is null, which IndexedDB
// cannot key, so the drain filters it in memory over an already-short list.
offlineDb.version(1).stores({
  pendingPhotos: 'id, sessionId, status, createdAt',
});

/*
 * Version 2 (Spec 06): backoff gate + human-readable error, and the syncMeta
 * table. Records written by version 1 are due immediately — a queue that
 * survived an app upgrade has been waiting long enough.
 */
offlineDb
  .version(2)
  .stores({
    pendingPhotos: 'id, sessionId, status, createdAt',
    syncMeta: 'key',
  })
  .upgrade((transaction) =>
    transaction
      .table<PendingPhoto>('pendingPhotos')
      .toCollection()
      .modify((photo) => {
        photo.nextAttemptAt = null;
        photo.lastErrorMessage = null;
      }),
  );
