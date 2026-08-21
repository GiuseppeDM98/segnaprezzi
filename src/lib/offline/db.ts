/**
 * The offline photo queue's IndexedDB schema (Spec 03 §5.1).
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
  lastError?: string;
  /** Full /api/extract response, stored verbatim once status = 'extracted'.
   *  Immutable after write: it is the source for price_entries.ai_raw_json. */
  extraction?: ExtractPhotoResponse;
  /** Epoch milliseconds — doubles as the entry's recordedAt default. */
  createdAt: number;
}

export const offlineDb = new Dexie('segnaprezzi-offline') as Dexie & {
  pendingPhotos: EntityTable<PendingPhoto, 'id'>;
};

// Only queried fields are indexed; `blob` and `extraction` stay unindexed
// payloads (indexing a Blob would throw at runtime).
offlineDb.version(1).stores({
  pendingPhotos: 'id, sessionId, status, createdAt',
});
