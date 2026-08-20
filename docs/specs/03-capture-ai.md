# Spec 03 — Capture & AI Extraction

> **Status**: Approved · **Last updated**: 2026-08-20
> **Depends on**: Spec 01 (scaffold), Spec 02 (database, repositories, auth)
> **Contract**: This spec elaborates on Spec 00 §6 (domain model), §8 (AI
> extraction summary), and §9 (route map). It must never contradict
> `docs/specs/00-overview.md`. All code follows
> `docs/DEVELOPMENT_GUIDELINES.md` and `docs/COMMENTS.md`.

---

## 1. Goal & Scope

This spec turns a photo of an Italian shelf price tag into a confirmed
`price_entries` row — plus the two non-photo entry paths (manual form, fuel
quick form). It is the heart of the app: everything downstream (Spec 04's
inflation engine, Spec 05's charts) consumes the entries produced here.

**In scope**

- Shopping session lifecycle (`shopping_sessions` state machine).
- In-app camera capture with framing guide, photo tray, and file-input fallback.
- Client-side compression (`src/lib/offline/compress.ts`).
- The Dexie offline queue **data contract** and its enqueue/dequeue API,
  including the single-photo uploader.
- `POST /api/extract`: Blob upload + `claude-haiku-4-5` structured extraction
  + product-match suggestions.
- The extraction system prompt, Zod schema, gateway code, and cross-checks.
- Product matching (Sørensen–Dice) with unit-test table.
- Review screen **data/action contract** (`confirmShoppingSession`).
- Manual entry (`/add/manual`) and fuel quick form (`/add/fuel`) contracts.
- Error taxonomy and i18n copy hooks.

**Out of scope**

- The background sync **engine** — connectivity listeners, backoff scheduling,
  Serwist integration (Spec 06). Spec 03 ships `uploadPendingPhoto()` for one
  photo; Spec 06 decides *when* to call it.
- Visual design polish of every screen (Spec 05). Spec 03 must ship
  *functional* `/scan`, `/scan/review`, `/add/manual`, `/add/fuel` pages that
  Spec 05 restyles without changing contracts.
- Barcode scanning, receipt OCR (roadmap, Spec 00 §3).

### 1.1 End-to-end flow

```
   [Camera / file-input fallback]              (client, /scan)
              │  shutter tap
              ▼
   compressPhoto()                             WebP ≤ ~400 KB, ≤ 1600 px
              │
              ▼
   Dexie "segnaprezzi-offline"                 pendingPhotos, status 'queued'
   .pendingPhotos.add(...)                     id = nanoid(21) — the future entry id
              │
              │  when online (Spec 06 scheduler; Spec 03: immediate attempt)
              ▼
   uploadPendingPhoto() ──► POST /api/extract  multipart: photo + ids + store ctx
                                   │  requireUser()
                                   ├─► Vercel Blob put()      users/{userId}/photos/{entryId}.webp
                                   ├─► claude-haiku-4-5       structured output → ExtractionResult
                                   ├─► flagExtractionForReview()   cross-check, confidence
                                   └─► suggestProductMatches()     top-3 catalog suggestions
                                   │
              ┌────────────────────┘
              ▼
   { blobUrl, extraction, suggestions, model } stored on pendingPhoto, status 'extracted'
              │
              ▼
   /scan/review                                editable cards, match picker, badges
              │  user confirms batch
              ▼
   confirmShoppingSession() Server Action      transaction:
              │                                  create missing products
              ▼                                  insert price_entries (source 'photo')
   session status 'completed'                    link photo_url, set completed_at
              │
              ▼
   Dexie queue cleared for the session
```

### 1.2 Files created by this spec

| Path | Layer | Purpose |
|---|---|---|
| `src/app/[locale]/(app)/scan/page.tsx` | app | Capture screen: session resume, camera mount, tray |
| `src/app/[locale]/(app)/scan/actions.ts` | app | `discardShoppingSession` |
| `src/app/[locale]/(app)/scan/review/page.tsx` | app | Review screen shell |
| `src/app/[locale]/(app)/scan/review/actions.ts` | app | `confirmShoppingSession`, `beginSessionReview` |
| `src/app/[locale]/(app)/add/manual/page.tsx` + `actions.ts` | app | Manual entry form + `createManualEntry` |
| `src/app/[locale]/(app)/add/fuel/page.tsx` + `actions.ts` | app | Fuel quick form + `createFuelEntry` |
| `src/app/api/extract/route.ts` | app | `POST /api/extract` route handler |
| `src/components/capture/use-camera.ts` | client | getUserMedia lifecycle hook |
| `src/components/capture/camera-capture.tsx` | client | Viewfinder, shutter, flash |
| `src/components/capture/framing-guide.tsx` | client | Tag-shaped overlay |
| `src/components/capture/photo-tray.tsx` | client | Thumbnail strip with status chips |
| `src/lib/offline/db.ts` | client | Dexie database + `PendingPhoto` type |
| `src/lib/offline/photo-queue.ts` | client | Enqueue/dequeue API surface |
| `src/lib/offline/upload-photo.ts` | client | Single-photo upload to `/api/extract` |
| `src/lib/offline/compress.ts` | client | Photo compression util |
| `src/lib/ai/extraction-schema.ts` | gateway | `ExtractionResult` Zod schema |
| `src/lib/ai/extraction-prompt.ts` | gateway | System prompt (verbatim from §7.1) |
| `src/lib/ai/extract-price-tag.ts` | gateway | Anthropic call + error mapping |
| `src/lib/ai/flag-extraction.ts` | pure | Cross-check → `needsReview` |
| `src/lib/blob/photo-storage.ts` | gateway | Vercel Blob put/del |
| `src/lib/services/extract-photo-entry.ts` | service | Orchestrates upload + AI + matching |
| `src/lib/services/match-products.ts` | service (pure) | Fuzzy product matching |
| `src/lib/services/shopping-session-lifecycle.ts` | service | find-or-create / review / discard |
| `src/lib/services/confirm-shopping-session.ts` | service | Batch confirm transaction |
| `src/lib/services/create-price-entry.ts` | service | Shared by manual + fuel paths |
| `src/lib/domain/fuel-products.ts` | domain | Fuel quick-pick constants |
| `messages/it.json`, `messages/en.json` | i18n | New keys (§12) |

Repositories (`src/lib/db/repositories/*`) come from Spec 02; this spec only
adds query functions to them where noted.

---

## 2. Shopping Session Lifecycle

A *spesa* (shopping trip) groups photos and entries. `shopping_sessions.status`
is the enum from Spec 00 §6: `active | reviewing | completed | discarded`.

### 2.1 State machine

```
                    first shutter press (client generates session id)
                              │
                              ▼
                         ┌────────┐  beginSessionReview  ┌───────────┐
              ┌─────────►│ active │─────────────────────►│ reviewing │
              │          └───┬────┘   "add more photos"  └─────┬─────┘
              │              │      ◄──────────────────────────┤
              │              │ discard                         │ confirm
              │              ▼                                 ▼
              │        ┌───────────┐                    ┌───────────┐
              │        │ discarded │◄───── discard ─────│ completed │ ✗ (terminal,
              │        └───────────┘                    └───────────┘    no discard)
              └── (new session auto-discards any other active/reviewing one)
```

- `completed` and `discarded` are terminal.
- `reviewing` is a resume aid, not a gate: `confirmShoppingSession` accepts
  sessions in `active` **or** `reviewing` (a user can confirm while offline
  review never got a chance to sync the status change).

### 2.2 Client-generated session ids & lazy materialization

Sessions must start with zero connectivity (Spec 00: offline-first). Therefore:

1. On the **first shutter press** with no current session, the client generates
   a session id with `nanoid()` and stores it in
   `localStorage["segnaprezzi.activeSessionId"]`. No network call happens.
2. The server **materializes** the `shopping_sessions` row lazily: the service
   `findOrCreateShoppingSession(userId, sessionId, storeId?)` (called by
   `/api/extract` and, defensively, by `confirmShoppingSession`) inserts the
   row with `status 'active'`, `started_at = now` if it does not exist. If the
   row exists but belongs to another user, throw `SessionNotFoundError`
   (respond as not-found — never reveal foreign ids exist).
3. **One active session per user**: when `findOrCreateShoppingSession` inserts
   a *new* session, it first sets any other `active`/`reviewing` session of
   that user to `discarded`. Starting a new spesa abandons the unfinished one.
   This is a service-level rule, not a DB constraint (libSQL partial unique
   indexes would fight the lazy-materialization flow).

### 2.3 Resume behavior

- `/scan` load, client side: if `localStorage["segnaprezzi.activeSessionId"]`
  is set, resume silently — the photo tray re-populates from Dexie
  (`listSessionPhotos`).
- `/scan` load, server side: the page's server component fetches the user's
  newest `active | reviewing` session. If it differs from the client's id
  (other device, cleared storage), show a resume banner: *"You have an
  unfinished spesa"* with **Resume** (adopt that id into localStorage) and
  **Discard** actions. A session with local queued photos always wins over the
  server suggestion.
- **Stale sessions**: a session whose `started_at` is older than 24 h gets a
  "Still shopping?" banner suggesting discard. No automatic server-side
  transition — data is never silently thrown away.

### 2.4 Abandoning

`discardShoppingSession` Server Action (`src/app/[locale]/(app)/scan/actions.ts`):

```typescript
discardShoppingSession(input: {
  sessionId: string;
  /** Blob URLs of already-extracted photos, so the server can clean them up. */
  blobUrls: string[];
}): Promise<ActionResult<{ sessionId: string }>>
```

Behavior (service `discardShoppingSession` in
`src/lib/services/shopping-session-lifecycle.ts`):

1. If the session row does not exist (all-offline spesa, nothing uploaded):
   no-op success — discard is idempotent.
2. If it exists and belongs to the user and is not `completed`: set
   `status 'discarded'`.
3. Delete `blobUrls` best-effort via the Blob gateway, but only URLs whose
   pathname starts with `users/{userId}/photos/` — never let a client delete
   another user's blobs. Log and swallow deletion failures (orphan blobs are
   a cost nuisance, not a correctness problem; a cleanup job is a roadmap
   item).
4. The client then runs `clearSessionPhotos(sessionId)` on Dexie and clears
   `localStorage["segnaprezzi.activeSessionId"]`.

### 2.5 Lifecycle actions summary

| Action | File | Transition |
|---|---|---|
| *(implicit)* first shutter press | client only | — → client-side session |
| `findOrCreateShoppingSession` | service, called by `/api/extract` & confirm | — → `active` (row created) |
| `beginSessionReview({ sessionId })` | `scan/review/actions.ts` | `active` → `reviewing` (fired on entering `/scan/review` while online; skipped offline) |
| `confirmShoppingSession(...)` | `scan/review/actions.ts` | `active`/`reviewing` → `completed` |
| `discardShoppingSession(...)` | `scan/actions.ts` | `active`/`reviewing` → `discarded` |

All actions return Spec 01 §9's `ActionResult<T>`
(`{ ok: true; data: T } | { ok: false; error: ActionError }`) from
`src/lib/errors.ts` — this spec defines no result type of its own, and the
error classes it throws (`SessionNotFoundError`, `SessionClosedError`,
`StoreNotFoundError`, `ProductNotFoundError`) are `DomainError` subclasses in
that same file.

Actions are thin: `requireUser()` (Spec 02 helper), parse input with Zod
(`safeParse`; invalid → `{ ok: false, error }` with code `INVALID_INPUT`),
call the service, map domain errors (`SessionNotFoundError` →
`SESSION_NOT_FOUND`, `SessionClosedError` → `SESSION_CLOSED`, …) via
`toActionError()`, `revalidatePath` the affected routes on success.

The error codes this spec introduces are folded into Spec 01's
`DomainErrorCode` union following its add-a-code checklist: extend the union,
add the `errors.<CODE>` message to **both** `messages/it.json` and
`messages/en.json`, and extend the HTTP status mapping. The full list:

| New code | HTTP | i18n key |
|---|---|---|
| `INVALID_INPUT` | 400 | `errors.INVALID_INPUT` |
| `INVALID_DATE` | 400 | `errors.INVALID_DATE` |
| `INVALID_PRICE` | 400 | `errors.INVALID_PRICE` |
| `INVALID_SIZE` | 400 | `errors.INVALID_SIZE` |
| `INVALID_STORE_KIND` | 400 | `errors.INVALID_STORE_KIND` |
| `INCONSISTENT_FUEL_PRICES` | 400 | `errors.INCONSISTENT_FUEL_PRICES` |
| `SESSION_NOT_FOUND` | 404 | `errors.SESSION_NOT_FOUND` |
| `STORE_NOT_FOUND` | 404 | `errors.STORE_NOT_FOUND` |
| `PRODUCT_NOT_FOUND` | 404 | `errors.PRODUCT_NOT_FOUND` |
| `SESSION_CLOSED` | 409 | `errors.SESSION_CLOSED` |
| `PHOTO_TOO_LARGE` | 413 | `errors.PHOTO_TOO_LARGE` |
| `UNSUPPORTED_PHOTO_TYPE` | 415 | `errors.UNSUPPORTED_PHOTO_TYPE` |
| `EXTRACTION_UNAVAILABLE` | 503 | `errors.EXTRACTION_UNAVAILABLE` |

`UNAUTHORIZED` (401) and `EXTRACTION_FAILED` (422) already exist in Spec 01's
union — this spec reuses them unchanged.

---

## 3. Camera Capture

Custom in-app camera on `/scan` — a full-bleed viewfinder, not the OS camera
app, so the user never leaves the flow between items in the cart.

### 3.1 `use-camera.ts` hook

```typescript
type CameraState = 'idle' | 'requesting' | 'streaming' | 'denied' | 'unavailable';
```

- On mount, call `navigator.mediaDevices.getUserMedia` with:

```typescript
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    // 'ideal', not 'exact': 'exact' throws OverconstrainedError on laptops
    // and front-camera-only devices instead of falling back gracefully.
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};
```

- Map failures: no `navigator.mediaDevices` / `NotFoundError` →
  `'unavailable'`; `NotAllowedError` / `SecurityError` → `'denied'`.
- Stop all tracks on unmount **and** on `visibilitychange` → hidden (battery:
  a live camera stream in a background tab drains phones fast); re-acquire on
  visible.
- Expose `{ state, videoRef, capturePhoto, retryPermission }`.
- `capturePhoto()`: draw the current video frame onto a canvas at
  `videoWidth × videoHeight`, `canvas.toBlob('image/jpeg', 0.92)`, return the
  Blob. Compression to WebP happens in `compressPhoto` (§4) — capture stays
  fast so the shutter feels instant.

### 3.2 Capture UX (`camera-capture.tsx`, `framing-guide.tsx`, `photo-tray.tsx`)

| Element | Behavior |
|---|---|
| Viewfinder | Full-bleed `<video playsInline muted autoPlay>`; **tap anywhere on the viewfinder shoots**, same as the shutter button (gloved/one-hand use) |
| Shutter button | ≥ 64 px circular button, bottom center, above the tray |
| Framing guide | Centered rounded rectangle, ~85% viewport width, **2:1 aspect** (Italian shelf tags are wide and short), semi-transparent scrim outside the rectangle, caption i18n key `scan.camera.frameHint`. Purely visual — no cropping in v1 |
| Confirmation flash | 120 ms white overlay (Motion opacity spring) + `navigator.vibrate?.(40)` |
| Photo tray | Horizontal thumbnail strip along the bottom: thumbnails via `URL.createObjectURL(pendingPhoto.blob)` (revoke on unmount), per-photo status chip (§12), badge with session photo count, primary CTA `scan.tray.review` → `/scan/review` |
| Store picker | Compact header control; optional; defaults to the user's most recently used non-fuel store; selection is written to each subsequently enqueued `pendingPhotos.storeId` |

On shutter: `capturePhoto()` → `compressPhoto()` → `enqueuePendingPhoto()` →
if `navigator.onLine`, fire-and-forget `uploadPendingPhoto()` (§5.4). The
shutter never waits for the network.

### 3.3 Fallback & permission-denied UX

Graceful degradation to the OS-native path:

```html
<input type="file" accept="image/*" capture="environment" />
```

| Camera state | UI |
|---|---|
| `'unavailable'` (no API, no camera, non-secure context) | Render the file input styled as the primary "Take photo" button — same downstream pipeline (`compressPhoto` handles HEIC/JPEG from the OS picker) |
| `'denied'` | Panel with `scan.camera.permissionDenied.title` / `.body` (explains why the camera is needed), a **Retry** button (`retryPermission()` re-invokes getUserMedia), and the file input as `scan.camera.permissionDenied.useLibrary` secondary action |

The file-input path is also the E2E-testable path (§13.6).

---

## 4. Client-Side Compression — `src/lib/offline/compress.ts`

Full implementation (this is the contract — implement exactly this):

```typescript
/**
 * Client-side photo compression for the capture pipeline.
 *
 * Design: phone cameras produce 8–50 MP images, but Claude reads a shelf tag
 * perfectly well at ≤ 1600 px. Compressing on-device before queueing keeps
 * IndexedDB small, lets uploads survive supermarket connectivity, and caps
 * Anthropic image-token cost (tokens ≈ width × height / 750, see Spec 03 §7.5).
 */

const MAX_DIMENSION_PX = 1600;
const TARGET_BYTES = 400 * 1024;
const INITIAL_QUALITY = 0.8;
const RETRY_QUALITY = 0.65;

export interface CompressedPhoto {
  blob: Blob;
  /** Actual encoding: 'image/webp', or 'image/jpeg' on browsers that cannot encode WebP. */
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Compress a camera photo into an upload-ready image.
 *
 * @param source - Raw photo from the camera or file input (any browser-decodable
 *   image, including HEIC on Safari)
 * @returns Photo with longest edge ≤ 1600 px, targeting ≤ 400 KB
 * @throws DOMException when the source cannot be decoded as an image
 */
export async function compressPhoto(source: Blob): Promise<CompressedPhoto> {
  // 'from-image' bakes the EXIF orientation into the pixels, so portrait
  // phone shots do not arrive sideways at the model.
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });

  try {
    const { width, height } = fitWithinMaxDimension(
      bitmap.width,
      bitmap.height,
      MAX_DIMENSION_PX,
    );

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Cannot acquire 2d context for photo compression');
    }
    context.drawImage(bitmap, 0, 0, width, height);

    let blob = await encodeCanvas(canvas, INITIAL_QUALITY);

    // One retry at lower quality is enough: tags are flat, high-contrast
    // subjects that compress well, so a second step rarely changes the
    // outcome — and the /api/extract 5 MB cap is the real safety net.
    if (blob.size > TARGET_BYTES) {
      blob = await encodeCanvas(canvas, RETRY_QUALITY);
    }

    return { blob, mimeType: blob.type, width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Scale (width, height) to fit within maxDimension, preserving aspect ratio.
 * Never upscales.
 */
export function fitWithinMaxDimension(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / longestEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encodeCanvas(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
  // Safari < 17 silently ignores the requested type and encodes PNG when it
  // cannot produce WebP; JPEG at the same quality is the closest substitute
  // that keeps uploads small.
  if (webp.type === 'image/webp') {
    return webp;
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
```

Notes:

- `OffscreenCanvas` is supported by every browser this PWA targets
  (Safari ≥ 16.4, Chrome ≥ 69, Firefox ≥ 105) and works in workers, which
  Spec 06 may exploit.
- The pipeline therefore produces **`image/webp` or `image/jpeg`, nothing
  else** — `/api/extract` rejects other content types (§6.2).

---

## 5. Offline Queue Data Model (client)

The sync **engine** (when to upload, backoff, connectivity events, Serwist) is
Spec 06. Spec 03 defines the **data contract** and the API surface Spec 06
orchestrates. The `dexie` dependency is introduced by this spec (Spec 06 adds
only `dexie-react-hooks`).

### 5.1 Dexie database — `src/lib/offline/db.ts`

```typescript
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
```

The `ExtractPhotoResponse` import is **type-only** — it is erased at build
time, so the client bundle never pulls server code.

### 5.2 Queue API — `src/lib/offline/photo-queue.ts`

```typescript
import { nanoid } from 'nanoid';
import { offlineDb, type PendingPhoto } from './db';
import type { ExtractPhotoResponse } from '@/lib/services/extract-photo-entry';

export const MAX_UPLOAD_ATTEMPTS = 5;

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
```

### 5.3 Status semantics

| Status | Meaning | Set by |
|---|---|---|
| `queued` | Waiting for upload (fresh, or retryable failure with attempts left) | `enqueuePendingPhoto`, `markPhotoFailed`, `retryFailedPhoto` |
| `uploading` | Claimed by an in-flight `/api/extract` call | `takeNextQueuedPhoto` |
| `extracted` | Server response stored; ready for review | `markPhotoExtracted` |
| `failed` | Non-retryable error, or retry budget exhausted; user must retry/delete | `markPhotoFailed` |

A page reload while `uploading` leaves a stuck claim; at startup the Spec 06
sync engine **unconditionally** resets every `uploading` photo back to
`queued`, keeping its `attempts` count. (Spec 03's immediate-attempt path
tolerates this: retries are idempotent, §6.5.)

### 5.4 Single-photo uploader — `src/lib/offline/upload-photo.ts`

```typescript
import type { ExtractPhotoResponse } from '@/lib/services/extract-photo-entry';
import { markPhotoExtracted, markPhotoFailed } from './photo-queue';
import type { PendingPhoto } from './db';

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
```

---

## 6. `POST /api/extract`

Route handler: `src/app/api/extract/route.ts`. Thin per the architecture
rules — parse, call `extractPhotoEntry` (service), map errors.

### 6.1 Request

`multipart/form-data`, authenticated via `requireUser()` (Spec 02):

| Field | Type | Required | Notes |
|---|---|---|---|
| `photo` | file | ✅ | `image/webp` or `image/jpeg`, ≤ 5 MB |
| `photoId` | text | ✅ | nanoid(21), client-generated (`pendingPhotos.id`) — the idempotency key |
| `sessionId` | text | ✅ | nanoid(21), client-generated |
| `storeId` | text | — | Store chosen in the capture header; must belong to the user |
| `storeKind` | text | — | `supermarket \| fuel_station \| other`; prompt hint when no `storeId` is given. When `storeId` is present the server derives the kind from the store row and ignores this field |

Zod schema for the text fields (`nanoidSchema = z.string().regex(/^[A-Za-z0-9_-]{21}$/)`):

```typescript
const extractRequestSchema = z.object({
  photoId: nanoidSchema,
  sessionId: nanoidSchema,
  storeId: nanoidSchema.optional(),
  storeKind: z.enum(['supermarket', 'fuel_station', 'other']).optional(),
});
```

### 6.2 Validation & rejection rules

| Check | Failure response |
|---|---|
| Session valid (`requireUser`) | `401 UNAUTHORIZED` |
| Text fields parse | `400 INVALID_INPUT` |
| `photo` present and is a `File` | `400 INVALID_INPUT` |
| `photo.size ≤ 5 * 1024 * 1024` | `413 PHOTO_TOO_LARGE` |
| `photo.type` ∈ {`image/webp`, `image/jpeg`} | `415 UNSUPPORTED_PHOTO_TYPE` |
| `storeId` (if given) belongs to the user | `404 STORE_NOT_FOUND` |
| Session exists → belongs to the user | `404 SESSION_NOT_FOUND` |
| Session not `completed`/`discarded` | `409 SESSION_CLOSED` |

Error body shape, uniform: `{ "error": { "code": string, "message": string } }`.

### 6.3 Photo storage — decision

**Decision: Vercel Blob with `access: 'public'` and a deterministic,
unguessable path.**

```
users/{userId}/photos/{entryId}.webp        entryId = photoId from the client
```

- `put(..., { access: 'public', addRandomSuffix: false, allowOverwrite: true })`.
- **Why public**: `@vercel/blob` private blobs require a signed fetch for
  every render — a server round-trip per thumbnail on the review screen and
  history views. Public blob URLs are served from Vercel's CDN directly.
- **Why no random suffix**: the random suffix exists to make public URLs
  unguessable, but it breaks idempotency (each retry would mint a new URL and
  orphan the previous upload). Our path already contains two nanoid(21)
  components (`userId`, `entryId`) — ≈126 bits of entropy, the same
  capability-URL security model as a random suffix — while
  `addRandomSuffix: false` + `allowOverwrite: true` makes retries overwrite
  the same object. Same guarantee, plus idempotency.
- **Privacy tradeoff (document in README)**: anyone who obtains a photo URL
  can view that photo without authentication. URLs are unguessable and only
  ever shown to their owner, but they are bearer tokens: sharing one shares
  the photo. Acceptable for v1 (photos are shelf tags, not personal images).
  **Roadmap item (v1.1)**: switch to `access: 'private'` with short-lived
  signed URLs proxied through an authenticated route handler.
- The pathname keeps the `.webp` extension even for the Safari JPEG fallback
  (§4): the stored `contentType` — passed explicitly to `put()` — is what
  browsers and the Anthropic call rely on; the extension is only a naming
  convention.

Gateway — `src/lib/blob/photo-storage.ts`:

```typescript
import { del, put } from '@vercel/blob';

/**
 * Upload a compressed entry photo. Deterministic path + overwrite makes
 * client retries idempotent: the same photoId always lands on the same URL.
 */
export async function uploadEntryPhoto(input: {
  userId: string;
  entryId: string;
  body: ArrayBuffer;
  contentType: 'image/webp' | 'image/jpeg';
}): Promise<string> {
  const { url } = await put(
    `users/${input.userId}/photos/${input.entryId}.webp`,
    input.body,
    {
      access: 'public',
      contentType: input.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );
  return url;
}

/** Best-effort bulk delete — callers must pre-filter URLs to the user's prefix. */
export async function deleteEntryPhotos(urls: string[]): Promise<void> {
  await del(urls);
}
```

### 6.4 Orchestration — `src/lib/services/extract-photo-entry.ts`

```typescript
export interface ExtractPhotoEntryInput {
  userId: string;
  photoId: string;
  sessionId: string;
  storeId: string | null;
  storeKind: 'supermarket' | 'fuel_station' | 'other' | null;
  photoBytes: ArrayBuffer;
  photoContentType: 'image/webp' | 'image/jpeg';
}

export interface ProductSuggestion {
  productId: string;
  name: string;
  brand: string | null;
  score: number;
}

export interface ExtractPhotoResponse {
  blobUrl: string;
  extraction: ReviewedExtraction; // ExtractionResult + needsReview + reviewReasons (§7.4)
  suggestions: ProductSuggestion[]; // top 3, may be empty
  /** Model that produced the extraction — stored to price_entries.ai_model on confirm. */
  model: string;
}

export async function extractPhotoEntry(
  input: ExtractPhotoEntryInput,
): Promise<ExtractPhotoResponse>;
```

Steps, in order:

1. If `storeId` given: load the store (`getStoreById(db, userId, storeId)`,
   Spec 02 stores repository), derive `storeKind` from `store.kind`; missing →
   `StoreNotFoundError`.
2. `findOrCreateShoppingSession(userId, sessionId, storeId)` (§2.2) — also
   enforces ownership and open status.
3. `uploadEntryPhoto(...)` → `blobUrl`. Upload happens **before** the AI call
   so a retryable AI failure re-uses (overwrites) the same blob on retry.
4. `extractPriceTag(...)` (§7.3) → `ExtractionResult`.
5. `flagExtractionForReview(...)` (§7.4) → `ReviewedExtraction`.
6. Load match candidates: `listProducts(db, userId, { includeArchived: false })`
   (Spec 02 products repository) plus, when `storeId` is present, the recency
   set from the one repository function this spec adds to
   `src/lib/db/repositories/price-entries.ts` (one query — never N+1),
   called with `since = now − 90 days`:

   ```typescript
   listProductIdsWithEntriesAtStoreSince(
     db: Db,
     userId: string,
     storeId: string,
     since: Date,
   ): Promise<string[]>
   ```
7. `suggestProductMatches(...)` (§8) → top-3 suggestions.
8. Return `{ blobUrl, extraction, suggestions, model: EXTRACTION_MODEL }`.

**Nothing is written to Turso except the lazily materialized session row.**
Entries appear only on confirm (§9) — the extraction response lives in Dexie
until then.

### 6.5 Idempotency

The client-generated `photoId` makes retries safe end-to-end:

- Same `photoId` → same Blob path → `allowOverwrite: true` overwrites instead
  of duplicating.
- Extraction is stateless — re-running it costs a fraction of a cent (§7.5)
  and touches no DB state.
- At confirm time the same id becomes `price_entries.id`, and inserts use
  `onConflictDoNothing` (§9.3) — a double confirm cannot duplicate entries.

### 6.6 Responses

**200** — `ExtractPhotoResponse` (§6.4) as JSON.

| Status | `error.code` | Retryable (client rule §5.4) |
|---|---|---|
| 400 | `INVALID_INPUT` | no |
| 401 | `UNAUTHORIZED` | no |
| 404 | `SESSION_NOT_FOUND`, `STORE_NOT_FOUND` | no |
| 409 | `SESSION_CLOSED` | no |
| 413 | `PHOTO_TOO_LARGE` | no |
| 415 | `UNSUPPORTED_PHOTO_TYPE` | no |
| 422 | `EXTRACTION_FAILED` — non-retryable `AiGatewayError` (refusal, malformed output, invalid request), surfaced as Spec 01's `ExtractionError` | no |
| 503 | `EXTRACTION_UNAVAILABLE` — retryable `AiGatewayError` (429/5xx/timeout upstream); include `Retry-After: 30` | yes |

### 6.7 Route handler skeleton

```typescript
// src/app/api/extract/route.ts
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();

    const formData = await request.formData();
    const fields = extractRequestSchema.safeParse({
      photoId: formData.get('photoId'),
      sessionId: formData.get('sessionId'),
      storeId: formData.get('storeId') ?? undefined,
      storeKind: formData.get('storeKind') ?? undefined,
    });
    if (!fields.success) {
      return errorResponse(400, 'INVALID_INPUT', fields.error.message);
    }

    const photo = formData.get('photo');
    if (!(photo instanceof File)) {
      return errorResponse(400, 'INVALID_INPUT', 'Missing photo file');
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return errorResponse(413, 'PHOTO_TOO_LARGE', 'Photo exceeds 5 MB');
    }
    if (photo.type !== 'image/webp' && photo.type !== 'image/jpeg') {
      return errorResponse(415, 'UNSUPPORTED_PHOTO_TYPE', `Got ${photo.type}`);
    }

    const result = await extractPhotoEntry({
      userId: user.id,
      photoId: fields.data.photoId,
      sessionId: fields.data.sessionId,
      storeId: fields.data.storeId ?? null,
      storeKind: fields.data.storeKind ?? null,
      photoBytes: await photo.arrayBuffer(),
      photoContentType: photo.type,
    });
    return Response.json(result);
  } catch (error) {
    // UnauthorizedError → 401 UNAUTHORIZED; other domain errors → §6.6 table;
    // unknown → 500.
    return mapExtractError(error);
  }
}
```

---

## 7. AI Extraction

The extraction model is **`claude-haiku-4-5`** (locked decision, Spec 00 §3 —
do not substitute another model), called through `@anthropic-ai/sdk` with the
structured-output `messages.parse` + `zodOutputFormat` pattern. Haiku 4.5
needs no `thinking` parameter for this task.

### 7.1 System prompt — verbatim

This exact text is the value of `EXTRACTION_SYSTEM_PROMPT` in
`src/lib/ai/extraction-prompt.ts`:

```text
You read photos of Italian supermarket shelf price tags (segnaprezzi /
cartellini) and extract structured pricing data. Each photo shows ONE price
tag; if several tags are visible, extract the one most centered and in focus.

MONEY IS ALWAYS INTEGERS
- totalPriceCents: the price actually paid for the package, in euro cents.
  Italian tags use comma decimals: "€ 2,49" → 249.
- unitPriceMilli: the price per BASE unit, in thousandths of a euro
  (milli-euros): "2,34 €/kg" → 2340 · "1,799 €/L" → 1799 · "0,45 €/pz" → 450.

BASE UNITS AND NORMALIZATION
- Base units are kg (unitKind "weight"), L (unitKind "volume"), piece
  (unitKind "count" — pz, pezzi, confezioni, rotoli, lavaggi).
- Tags quoting €/100 g, €/hg (all'etto) or €/100 mL: multiply by 10.
  "0,89 €/100 g" → 8900 (that is 8,90 €/kg).
- Tags quoting €/g or €/mL: multiply by 1000. Tags quoting €/cl: multiply
  by 100.
- packageSize is the package content in base units: "500 g" → 0.5 ·
  "1,5 L" → 1.5 · "6 pezzi" → 6 · "4 rotoli" → 4.
- Multipacks ("6 × 1,5 L", "confezione da 6"): packageSize is the TOTAL
  content (6 × 1,5 L → 9), totalPriceCents is the price of the whole pack,
  unitPriceMilli stays per single base unit.

PROMOTIONS (very common on Italian tags)
- "OFFERTA", "SCONTO", "SOTTOCOSTO", "PROMO", "PREZZO RIBASSATO", "RISPARMI",
  a percentage like "-30%", or a crossed-out higher price → isPromo true,
  promoKind "discount".
- Loyalty-card prices — "PREZZO SOCI", "PER TE SOCIO", "Fidaty" (Esselunga),
  "Carta Insieme" (Conad), "Socio Coop", "Carta Fedeltà" → isPromo true,
  promoKind "loyalty".
- Multi-buy — "2x1", "3x2", "prendi 3 paghi 2", "secondo pezzo -50%" →
  isPromo true, promoKind "bundle".
- Coupon-gated prices ("con coupon", app vouchers) → promoKind "coupon".
- When a full price and a promotional price are both printed, extract the
  price the user actually pays today (the promotional one). The crossed-out
  full price goes in rawText only.
- Promo tags often print a unit price computed from the OLD full price. The
  invariant is: unitPriceMilli × packageSize = totalPriceCents × 10. If the
  printed unit price breaks it, recompute unitPriceMilli from the
  promotional total and packageSize.
- isPromo false → promoKind null.

SPECIAL TAG TYPES
- Deposit ("cauzione", "vuoto a rendere"): never add the deposit to
  totalPriceCents; mention it in rawText.
- Scale labels from the deli/produce counter (weighed goods; their barcodes
  start with "2" and embed price or weight): the printed price is for that
  specific weighed piece — use the printed weight as packageSize and the
  printed total as totalPriceCents.
- Fuel price boards (store kind fuel_station): unitKind "volume", category
  "fuel", the €/L figure (3 decimals) → unitPriceMilli; set totalPriceCents 0
  and packageSize 0 — no quantity is shown on a price board.

CATEGORY — exactly one of:
food · beverages · household · personal-care · health · clothing · fuel ·
transport · utilities · recreation · pets · other
(Water, juice, coffee, wine, beer → beverages. Detergents, paper towels,
foil → household. Shampoo, toothpaste → personal-care. Pet food, litter →
pets. When unsure → other, and lower your confidence.)

OTHER FIELDS
- productName: concise name as printed, WITHOUT the brand ("Spaghetti n.5
  500g", "Passata di pomodoro"). brand: the brand if printed ("Barilla",
  "Mutti"), else null. Private labels ("Esselunga", "Coop", "Conad") are
  brands too.
- rawText: verbatim transcription of ALL legible text on the tag, one line
  per printed line. This is the audit trail the user sees when correcting
  your extraction.
- confidence: 0..1 — your confidence that productName, totalPriceCents and
  unitPriceMilli are all correct.

UNREADABLE OR WRONG PHOTOS
If the photo is blurry, occluded, or not a price tag at all: set confidence
below 0.3, transcribe whatever is legible into rawText, and use 0 for any
price or size you cannot read. Never invent a price that is not printed.
```

`src/lib/ai/extraction-prompt.ts` carries this checklist comment above the
constant:

```typescript
// WARNING: the category list in this prompt must stay in sync with
// CATEGORY_IDS in src/lib/domain/categories.ts and with both message files
// (see the taxonomy checklist in docs/specs/00-overview.md §6).
```

### 7.2 Zod schema — `src/lib/ai/extraction-schema.ts`

Mirrors the field list of Spec 00 §8. `UNIT_KINDS` and `PROMO_KINDS` are
imported from the Spec 02 domain modules (`src/lib/domain/units`,
`src/lib/domain/entries`) — never re-declared here. `totalPriceCents`,
`unitPriceMilli`, and `packageSize` allow `0` as the "not legible" sentinel
the prompt mandates — confirm-time validation (§9.2) requires positive
values, forcing the user to fill the gap on the review screen.

```typescript
import { z } from 'zod';
import { CATEGORY_IDS } from '@/lib/domain/categories';
import { PROMO_KINDS } from '@/lib/domain/entries';
import { UNIT_KINDS } from '@/lib/domain/units';

export const extractionResultSchema = z.object({
  productName: z.string().min(1),
  brand: z.string().nullable(),
  category: z.enum(CATEGORY_IDS),
  unitKind: z.enum(UNIT_KINDS),
  totalPriceCents: z.number().int().min(0)
    .describe('Euro cents, integer. 0 only when the price is not legible.'),
  packageSize: z.number().min(0)
    .describe('Package content in base units (kg, L, or pieces). 0 when not legible.'),
  unitPriceMilli: z.number().int().min(0)
    .describe('Milli-euros (1/1000 EUR) per base unit. 0 only when not legible.'),
  isPromo: z.boolean(),
  promoKind: z.enum(PROMO_KINDS).nullable(),
  confidence: z.number().min(0).max(1),
  rawText: z.string(),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
```

### 7.3 Gateway — `src/lib/ai/extract-price-tag.ts`

Full implementation:

```typescript
/**
 * Anthropic gateway: one photo in, one ExtractionResult out.
 *
 * Design: this module is the only place that talks to the Anthropic API.
 * It maps every failure mode onto AiGatewayError (internal to src/lib/ai/)
 * with an isRetryable flag, so the service and the offline queue can share
 * one retry policy without knowing SDK internals. The service/route layer
 * translates AiGatewayError into Spec 01's ExtractionError / HTTP responses.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '@/lib/env';
import { EXTRACTION_SYSTEM_PROMPT } from './extraction-prompt';
import { extractionResultSchema, type ExtractionResult } from './extraction-schema';

export const EXTRACTION_MODEL = 'claude-haiku-4-5';

export type ExtractionFailureCode =
  | 'rate-limited'
  | 'timeout'
  | 'upstream-unavailable'
  | 'refused'
  | 'invalid-request'
  | 'malformed-output';

export class AiGatewayError extends Error {
  constructor(
    readonly failureCode: ExtractionFailureCode,
    readonly isRetryable: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AiGatewayError';
  }
}

const anthropicClient = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: 30_000,
  // The offline queue owns the retry policy (attempts + backoff). Letting the
  // SDK also retry would multiply attempts and hold the serverless function
  // open past its budget.
  maxRetries: 0,
});

export interface ExtractPriceTagInput {
  imageBase64: string;
  mediaType: 'image/webp' | 'image/jpeg';
  storeKind: 'supermarket' | 'fuel_station' | 'other' | null;
}

/**
 * Extract structured price-tag data from one photo.
 *
 * @param input - Base64 photo + optional store-kind hint for the prompt
 * @param client - Injected for tests; defaults to the module singleton
 * @returns The parsed extraction (schema-validated by the SDK)
 * @throws AiGatewayError for every failure mode, retryable flag set
 */
export async function extractPriceTag(
  input: ExtractPriceTagInput,
  client: Anthropic = anthropicClient,
): Promise<ExtractionResult> {
  try {
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 1500,
      // Temperature 0: this is transcription, not generation — the correct
      // output is fully determined by the pixels, and sampling variety only
      // adds transposed digits. It also makes retries reproducible.
      temperature: 0,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mediaType,
                data: input.imageBase64,
              },
            },
            { type: 'text', text: buildUserInstruction(input.storeKind) },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(extractionResultSchema) },
    });

    if (response.stop_reason === 'refusal') {
      throw new AiGatewayError('refused', false, 'Model refused to process the photo');
    }
    if (!response.parsed_output) {
      throw new AiGatewayError(
        'malformed-output',
        false,
        `No parseable extraction (stop_reason: ${response.stop_reason})`,
      );
    }
    return response.parsed_output;
  } catch (error) {
    throw toAiGatewayError(error);
  }
}

function buildUserInstruction(storeKind: ExtractPriceTagInput['storeKind']): string {
  const storeContext = storeKind ? `Store kind: ${storeKind}. ` : '';
  return `${storeContext}Extract the price tag data from this photo.`;
}

/** Map SDK failures onto AiGatewayError. Order matters: most specific first. */
function toAiGatewayError(error: unknown): AiGatewayError {
  if (error instanceof AiGatewayError) {
    return error;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiGatewayError('rate-limited', true, 'Anthropic rate limit', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiGatewayError('timeout', true, 'Anthropic request timed out', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiGatewayError('upstream-unavailable', true, 'Cannot reach Anthropic', {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    // 5xx (incl. 529 overloaded) is Anthropic's problem — retry. Anything in
    // the 4xx range (bad request, auth misconfiguration) will fail identically
    // on retry, so fail fast and surface it.
    const isServerSide = typeof error.status === 'number' && error.status >= 500;
    return new AiGatewayError(
      isServerSide ? 'upstream-unavailable' : 'invalid-request',
      isServerSide,
      `Anthropic API error ${error.status}: ${error.message}`,
      { cause: error },
    );
  }
  return new AiGatewayError('malformed-output', false, 'Unexpected extraction failure', {
    cause: error,
  });
}
```

Notes:

- `client.messages.parse` + `output_config: { format: zodOutputFormat(...) }`
  is the current structured-output pattern of `@anthropic-ai/sdk` — do not
  use tool-forcing tricks or any deprecated `output_format` parameter.
- No prompt caching: the system prompt (~700 tokens) is below the cacheable
  minimum, and captures arrive minutes apart — a 5-minute-TTL cache would
  almost never hit.
- `AiGatewayError` never leaves `src/lib/ai/`: the service/route layer
  translates it into Spec 01's error contract (§6.6) — `isRetryable` → 503
  `EXTRACTION_UNAVAILABLE`, else Spec 01's `ExtractionError` → 422
  `EXTRACTION_FAILED`.

### 7.4 Cross-check → `needsReview` — `src/lib/ai/flag-extraction.ts`

Pure function, unit-tested, applied by the service after every extraction:

```typescript
import type { ExtractionResult } from './extraction-schema';

/** Allowed relative gap between the printed total and unit × size (2%). */
const CROSS_CHECK_TOLERANCE = 0.02;
const MIN_CONFIDENCE = 0.6;

export type ReviewReason = 'price-mismatch' | 'low-confidence';

export interface ReviewedExtraction extends ExtractionResult {
  needsReview: boolean;
  reviewReasons: ReviewReason[];
}

/**
 * Flag extractions the user must double-check before confirming.
 *
 * The invariant unitPriceMilli × packageSize = totalPriceCents × 10 holds on
 * a correct tag (both sides are milli-euros for the whole package). A gap
 * beyond 2% means a misread digit, a promo tag whose unit price refers to
 * the old full price, or a unit mix-up — all worth a human look.
 */
export function flagExtractionForReview(extraction: ExtractionResult): ReviewedExtraction {
  const reviewReasons: ReviewReason[] = [];

  // Skip the cross-check when any value is the 0 "not legible" sentinel —
  // the prompt forces confidence < 0.3 in that case, which flags below.
  const hasAllPrices =
    extraction.totalPriceCents > 0 &&
    extraction.unitPriceMilli > 0 &&
    extraction.packageSize > 0;

  if (hasAllPrices) {
    const totalMilli = extraction.totalPriceCents * 10;
    const derivedMilli = extraction.unitPriceMilli * extraction.packageSize;
    if (Math.abs(derivedMilli - totalMilli) > CROSS_CHECK_TOLERANCE * totalMilli) {
      reviewReasons.push('price-mismatch');
    }
  }

  if (extraction.confidence < MIN_CONFIDENCE) {
    reviewReasons.push('low-confidence');
  }

  return {
    ...extraction,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
}
```

Worked example: tag "Spaghetti n.5 — €0,89 · 1,78 €/kg · 500 g" →
`|1780 × 0.5 − 890| = 0` → clean. Tag misread as `unitPriceMilli 1980` →
`|990 − 890| = 100 > 0.02 × 890` → `price-mismatch`, badge on the review card.

### 7.5 Cost

`claude-haiku-4-5` pricing: **$1 / MTok input, $5 / MTok output**. Image
tokens ≈ width × height / 750.

| Item | Typical | Worst case |
|---|---|---|
| Image (compressed, §4) | 1600 × 900 → ~1,900 tok | 1600 × 1200 → ~2,550 tok |
| System + user prompt | ~900 tok | ~900 tok |
| Output (structured JSON) | ~250 tok | ~350 tok |
| **Cost per photo** | **≈ $0.004 (< €0.005)** | ≈ $0.005 |
| 200 photos / month | **≈ €0.50–0.80** | < €1 |
| Heavy user, 500 photos / month | ≈ €1.70 | ≈ €2.50 |

Extraction cost is a rounding error next to hosting; no budget guard is
needed in v1 beyond the 5 MB upload cap.

---

## 8. Product Matching — `src/lib/services/match-products.ts`

Pure functions (no I/O — the service passes candidates in), so the whole
module is table-testable.

### 8.1 Implementation

```typescript
/**
 * Fuzzy matching between an AI extraction and the user's product catalog.
 *
 * Sørensen–Dice over character bigrams was chosen over Levenshtein because
 * shelf tags and catalog names differ mostly by word order and extra tokens
 * ("Spaghetti Barilla N.5" vs "Barilla spaghetti n5 500 g"), not by typos.
 * We only keep word-internal bigrams (none spanning a space), which makes
 * the score insensitive to word order — exactly the invariance we want.
 */

export interface MatchCandidate {
  id: string;
  name: string;
  brand: string | null;
  /** True when the product has an entry at the capture store in the last 90 days. */
  hasRecentEntryAtStore: boolean;
}

export interface ProductSuggestion {
  productId: string;
  name: string;
  brand: string | null;
  score: number;
}

const SUGGESTION_THRESHOLD = 0.4;
const MAX_SUGGESTIONS = 3;
const EXACT_BRAND_BONUS = 0.15;
const STORE_RECENCY_BONUS = 0.05;

/**
 * Normalize a product name for comparison: lowercase, strip diacritics
 * (NFD + remove combining marks: "qualità" → "qualita"), turn punctuation
 * into spaces ("n.5" → "n 5"), collapse whitespace.
 */
export function normalizeProductName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sørensen–Dice similarity over word-internal character bigrams:
 * dice = 2 × |A ∩ B| / (|A| + |B|), with multiset intersection.
 * Returns 0..1. Strings shorter than one bigram only match exactly.
 */
export function calculateDiceSimilarity(a: string, b: string): number {
  if (a === b) {
    return a.length > 0 ? 1 : 0;
  }
  const bigramsA = collectBigrams(a);
  const bigramsB = collectBigrams(b);
  const totalA = sumCounts(bigramsA);
  const totalB = sumCounts(bigramsB);
  if (totalA === 0 || totalB === 0) {
    return 0;
  }
  let sharedCount = 0;
  for (const [bigram, countA] of bigramsA) {
    sharedCount += Math.min(countA, bigramsB.get(bigram) ?? 0);
  }
  return (2 * sharedCount) / (totalA + totalB);
}

/**
 * Rank catalog candidates against an extraction.
 *
 * rawScore = dice("brand name" vs "brand name") + bonuses:
 * +0.15 when both brands are present and equal after normalization,
 * +0.05 when the candidate was recently bought at the same store.
 * The ≥ 0.4 threshold and the ranking use the UNCAPPED rawScore — so the
 * recency bonus still breaks ties between perfect dice matches — while the
 * reported `score` field is capped at 1. Top 3 returned.
 */
export function suggestProductMatches(
  extraction: { productName: string; brand: string | null },
  candidates: MatchCandidate[],
): ProductSuggestion[] {
  const target = normalizeProductName(`${extraction.brand ?? ''} ${extraction.productName}`);
  const targetBrand = extraction.brand === null ? null : normalizeProductName(extraction.brand);

  const scoredCandidates = candidates.map((candidate) => {
    const candidateText = normalizeProductName(`${candidate.brand ?? ''} ${candidate.name}`);
    let rawScore = calculateDiceSimilarity(target, candidateText);

    const candidateBrand =
      candidate.brand === null ? null : normalizeProductName(candidate.brand);
    if (targetBrand !== null && targetBrand !== '' && targetBrand === candidateBrand) {
      rawScore += EXACT_BRAND_BONUS;
    }
    if (candidate.hasRecentEntryAtStore) {
      rawScore += STORE_RECENCY_BONUS;
    }

    return {
      rawScore,
      suggestion: {
        productId: candidate.id,
        name: candidate.name,
        brand: candidate.brand,
        score: Math.min(rawScore, 1),
      },
    };
  });

  return scoredCandidates
    .filter((candidate) => candidate.rawScore >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, MAX_SUGGESTIONS)
    .map((candidate) => candidate.suggestion);
}

function collectBigrams(text: string): Map<string, number> {
  const bigrams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const bigram = text.slice(i, i + 2);
    if (bigram.includes(' ')) {
      continue;
    }
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  return bigrams;
}

function sumCounts(bigrams: Map<string, number>): number {
  let total = 0;
  for (const count of bigrams.values()) {
    total += count;
  }
  return total;
}
```

The candidate pool: **all non-archived products of the user** (`is_archived = 0`).
Personal catalogs stay small (hundreds, not millions) — scoring them all per
photo is microseconds; no pre-indexing.

### 8.2 Unit-test table — `src/lib/services/match-products.test.ts`

```typescript
import { describe, expect, test } from 'vitest';
import { calculateDiceSimilarity, normalizeProductName, suggestProductMatches } from './match-products';

function candidate(id: string, name: string, brand: string | null, isRecent = false) {
  return { id, name, brand, hasRecentEntryAtStore: isRecent };
}

describe('normalizeProductName', () => {
  test.each([
    ['Spaghetti Barilla N.5', 'spaghetti barilla n 5'],
    ['Caffè Qualità Rossa', 'caffe qualita rossa'],
    ['Acqua  Naturale 1,5L', 'acqua naturale 1 5l'],
    ['PASSATA (700 g)', 'passata 700 g'],
  ])('should normalize %j to %j', (raw, expected) => {
    expect(normalizeProductName(raw)).toBe(expected);
  });
});

describe('suggestProductMatches', () => {
  test.each([
    // [description, extractedName, extractedBrand, candidateName, candidateBrand, isSuggested, minScore]
    ['same product, different word order and pack size',
      'Spaghetti N.5', 'Barilla', 'Spaghetti n.5 500g', 'Barilla', true, 0.8],
    ['abbreviated catalog name rescued by the brand bonus',
      'Latte Parzialmente Scremato', 'Granarolo', 'Latte PS 1L', 'Granarolo', true, 0.5],
    ['diacritics stripped on both sides',
      'Caffè Qualità Rossa', 'Lavazza', 'Caffe Qualita Rossa Macinato 250g', 'Lavazza', true, 0.7],
    ['same brand, different product — suggested but low (brand bonus pulls it over)',
      'Passata', 'Mutti', 'Polpa di Pomodoro 400g', 'Mutti', true, 0.4],
    ['unrelated product, different brand',
      'Acqua Naturale 1,5L', 'San Benedetto', 'Coca-Cola 1.5L', 'Coca-Cola', false, 0],
  ])('%s', (_description, name, brand, candidateName, candidateBrand, isSuggested, minScore) => {
    const suggestions = suggestProductMatches(
      { productName: name, brand },
      [candidate('p1', candidateName, candidateBrand)],
    );

    if (isSuggested) {
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].score).toBeGreaterThanOrEqual(minScore);
    } else {
      expect(suggestions).toHaveLength(0);
    }
  });

  test('should rank the recently-bought-here product first on equal names', () => {
    const suggestions = suggestProductMatches(
      { productName: 'Passata di pomodoro', brand: 'Mutti' },
      [
        candidate('elsewhere', 'Passata di pomodoro', 'Mutti', false),
        candidate('here', 'Passata di pomodoro', 'Mutti', true),
      ],
    );

    expect(suggestions[0].productId).toBe('here');
  });

  test('should cap the score at 1 and return at most 3 suggestions', () => {
    const twins = ['a', 'b', 'c', 'd'].map((id) =>
      candidate(id, 'Spaghetti n.5', 'Barilla', true),
    );

    const suggestions = suggestProductMatches(
      { productName: 'Spaghetti n.5', brand: 'Barilla' },
      twins,
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].score).toBe(1);
  });

  test('should return exact similarity 1 for identical normalized strings', () => {
    expect(calculateDiceSimilarity('barilla spaghetti', 'barilla spaghetti')).toBe(1);
  });
});
```

---

## 9. Review Screen Contract

The review UI itself (cards, animations, layout) is built in Spec 05 —
Spec 03 ships a functional version and freezes the **data and action
contract** below.

### 9.1 Data contract (client-side)

The review screen loads `listSessionPhotos(sessionId)` from Dexie and builds
one draft per photo with `status 'extracted'`:

```typescript
// Client-side view model — lives in React state on /scan/review.
export interface ReviewEntryDraft {
  /** = pendingPhotos.id = future price_entries.id */
  id: string;
  blobUrl: string;
  /** User-editable copy of extraction fields (name, prices, category, promo…). */
  fields: ExtractionResult;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  suggestions: ProductSuggestion[];
  /** null until the user picks; preselected to suggestions[0] when its score ≥ 0.7. */
  selectedProduct:
    | { kind: 'existing'; productId: string }
    | { kind: 'new'; name: string; brand: string | null; category: CategoryId; unitKind: UnitKind }
    | null;
}
```

Rules:

- **Editable extraction cards**: every field of `fields` is editable; editing
  `totalPriceCents` or `packageSize` live-recomputes `unitPriceMilli`
  (`calculateUnitPriceMilli` from Spec 02's `src/lib/domain/money.ts`,
  `Math.round(totalPriceCents * 10 / packageSize)`) unless the user edited the
  unit price by hand. Values of `0` (unreadable sentinel) render as empty
  inputs that must be filled before confirm.
- **Match picker**: shows the top-3 `suggestions` (name, brand, score as a
  subtle percentage), a "New product" option prefilled from `fields`
  (`review.newProduct`), and a search over the full catalog (component
  built in Spec 05).
- **`needsReview` badge**: cards with `needsReview` show the badge
  (`review.needsReview`) plus a per-reason hint line (§12); the confirm
  CTA scrolls to the first unresolved card if any card has empty required
  fields or no product selection.
- Edits stay in React state; `pendingPhotos.extraction` is never mutated — it
  is the immutable AI payload that becomes `ai_raw_json`. (Losing edits on a
  hard reload is accepted in v1; review is a single sitting.)
- Photos with status `queued`/`uploading`/`failed` appear as placeholder cards
  with their status chip — the batch can only be confirmed when every photo of
  the session is `extracted` or explicitly deleted.

### 9.2 `confirmShoppingSession` — Server Action

Location: `src/app/[locale]/(app)/scan/review/actions.ts`. Signature and Zod
input:

```typescript
export async function confirmShoppingSession(
  input: ConfirmShoppingSessionInput,
): Promise<ActionResult<{ sessionId: string; entryIds: string[]; createdProductIds: string[] }>>;
```

```typescript
import { z } from 'zod';
import { CATEGORY_IDS } from '@/lib/domain/categories';
import { PROMO_KINDS } from '@/lib/domain/entries';
import { UNIT_KINDS } from '@/lib/domain/units';

const nanoidSchema = z.string().regex(/^[A-Za-z0-9_-]{21}$/);

const productPickSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), productId: nanoidSchema }),
  z.object({
    kind: z.literal('new'),
    name: z.string().min(1).max(200),
    brand: z.string().min(1).max(100).nullable(),
    category: z.enum(CATEGORY_IDS),
    unitKind: z.enum(UNIT_KINDS),
  }),
]);

const confirmEntrySchema = z
  .object({
    id: nanoidSchema, // client photo id → price_entries.id (idempotency key)
    product: productPickSchema,
    recordedAt: z.number().int().positive(), // epoch ms; default = photo createdAt
    totalPriceCents: z.number().int().min(1).max(1_000_000),
    packageSize: z.number().positive().max(10_000),
    unitPriceMilli: z.number().int().min(1).max(100_000_000),
    isPromo: z.boolean(),
    promoKind: z.enum(PROMO_KINDS).nullable(),
    photoUrl: z
      .url()
      .refine(
        (url) => new URL(url).hostname.endsWith('.public.blob.vercel-storage.com'),
        'photoUrl must be a Vercel Blob URL',
      )
      .nullable(),
    aiConfidence: z.number().min(0).max(1).nullable(),
    aiModel: z.string().max(100).nullable(),
    aiRawJson: z.string().max(20_000).nullable(),
  })
  .refine((entry) => entry.isPromo || entry.promoKind === null, {
    message: 'promoKind requires isPromo',
  });

export const confirmShoppingSessionSchema = z.object({
  sessionId: nanoidSchema,
  /** One store per session (v1): applied to the session and every entry. */
  storeId: nanoidSchema.nullable(),
  entries: z.array(confirmEntrySchema).min(1).max(100),
});

export type ConfirmShoppingSessionInput = z.infer<typeof confirmShoppingSessionSchema>;
```

The client fills `photoUrl`, `aiConfidence`, `aiModel`, `aiRawJson` from the
stored `ExtractPhotoResponse`: `photoUrl = blobUrl`,
`aiConfidence = extraction.confidence` (the *original* one, even after edits),
`aiModel = model`, `aiRawJson = JSON.stringify(extraction)`.

### 9.3 Behavior — service `confirmShoppingSession`

`src/lib/services/confirm-shopping-session.ts`, one `db.transaction`:

1. `findOrCreateShoppingSession(userId, sessionId, storeId)` — ownership
   enforced; status `completed` → **idempotent success**: return the ids of
   the already-inserted entries without writing anything; status `discarded`
   → `SessionClosedError`.
2. For every `product.kind === 'new'` pick: look up the user's products by
   normalized `name` + `brand` (`normalizeProductName`, §8) — if an exact
   normalized match exists, **reuse it** instead of creating a duplicate;
   otherwise insert with a fresh nanoid. Two identical "new" picks inside the
   same batch also collapse to one product.
3. Verify every `kind === 'existing'` productId belongs to the user
   (`ProductNotFoundError` otherwise) — one `IN (...)` query, not N+1.
4. Insert all `price_entries` with `id` from the input, `source 'photo'`,
   `session_id = sessionId`, `store_id = storeId`, `currency 'EUR'`, and the
   photo/AI columns from the input — using
   `.onConflictDoNothing({ target: priceEntries.id })` so a double-submit or
   replayed confirm inserts nothing twice.
5. Update the session: `store_id = storeId`, `status 'completed'`,
   `completed_at = now`.
6. Return `{ sessionId, entryIds, createdProductIds }`.

On `{ ok: true }` the client: `clearSessionPhotos(sessionId)`, clear
`localStorage["segnaprezzi.activeSessionId"]`, navigate to `/` with the
success toast; the action itself calls `revalidatePath` for `/`, `/history`,
and `/products`.

---

## 10. Manual Entry — `/add/manual`

Online-only in v1 (decided here): manual and fuel entries need product/store
lookups, so the forms require connectivity; offline queueing of manual entries
is a Spec 06+ roadmap item. Photos remain the offline-first path.

### 10.1 Form contract

| Field | Control | Default |
|---|---|---|
| Product | Picker over the user's catalog (search) **or** inline create (name, brand, category, unitKind) | — |
| Store | Picker over the user's stores, or none ("generic purchase") | Last used store |
| Date | Date-time input | Now |
| Total price | Currency input (comma decimals) → `totalPriceCents` | — |
| Package size + unit | Number + unit label from the product's `unitKind` (kg/L/pieces; g/mL accepted and converted client-side) | — |
| Unit price | Auto-computed `calculateUnitPriceMilli(totalPriceCents, packageSize)`, live; **overridable** — a manual edit stops auto-recompute | computed |
| Promo | Toggle `isPromo`; when on, a `promoKind` segmented control (`discount / loyalty / coupon / bundle`) | off |

The client shows a non-blocking warning (same 2% cross-check as §7.4) when an
overridden unit price disagrees with total ÷ size — warn, never block: some
tags genuinely disagree.

### 10.2 `createManualEntry` — Server Action

`src/app/[locale]/(app)/add/manual/actions.ts` → service
`createPriceEntry` (`src/lib/services/create-price-entry.ts`, shared with the
fuel path, parameterized by `source`).

```typescript
export const createManualEntrySchema = z
  .object({
    product: productPickSchema, // §9.2 — same union
    storeId: nanoidSchema.nullable(),
    recordedAt: z.number().int().positive(),
    totalPriceCents: z.number().int().min(1).max(1_000_000),
    packageSize: z.number().positive().max(10_000),
    unitPriceMilli: z.number().int().min(1).max(100_000_000),
    isPromo: z.boolean(),
    promoKind: z.enum(PROMO_KINDS).nullable(),
  })
  .refine((entry) => entry.isPromo || entry.promoKind === null);

export async function createManualEntry(
  input: CreateManualEntryInput,
): Promise<ActionResult<{ entryId: string }>>;
```

Behavior: resolve/create the product (same dedupe rule as §9.3 step 2),
verify store ownership, insert one `price_entries` row with a **server-
generated** nanoid, `source 'manual'`, `session_id NULL`, `photo_url NULL`,
`ai_* NULL`. No idempotency key needed — the form is online and single-shot
(the UI disables the submit button while pending).

### 10.3 Validation rules

| Field | Rule | Error code |
|---|---|---|
| `recordedAt` | ≥ 2020-01-01, ≤ now + 5 min (clock skew allowance) | `INVALID_DATE` |
| `totalPriceCents` | integer, 1 … 1,000,000 (€0.01 … €10,000) | `INVALID_PRICE` |
| `packageSize` | > 0, ≤ 10,000 base units | `INVALID_SIZE` |
| `unitPriceMilli` | integer, 1 … 100,000,000 | `INVALID_PRICE` |
| `promoKind` | `null` unless `isPromo` | `INVALID_INPUT` |
| `storeId` | must belong to the user when given | `STORE_NOT_FOUND` |
| `product.productId` | must belong to the user | `PRODUCT_NOT_FOUND` |

(`recordedAt ≥ 2020-01-01` — decided here: keeps typos like year 0202 out of
the index without blocking realistic backfilling.)

---

## 11. Fuel Quick Form — `/add/fuel`

Refueling is the highest-frequency non-supermarket purchase; the form is
optimized to be filled at the pump in under ten seconds.

### 11.1 Quick-pick fuel products — `src/lib/domain/fuel-products.ts`

```typescript
// WARNING: adding a fuel here requires labels in messages/it.json and
// messages/en.json under addFuel.products.*.
export const FUEL_QUICK_PICKS = [
  { key: 'benzina-95', canonicalName: 'Benzina 95' },
  { key: 'diesel', canonicalName: 'Diesel' },
  { key: 'gpl', canonicalName: 'GPL' },
] as const;

export type FuelQuickPickKey = (typeof FUEL_QUICK_PICKS)[number]['key'];
```

Decided: the **stored** product name is the canonical Italian one (fixed,
locale-independent — switching UI language must not fork the product catalog);
button **labels** are localized (`addFuel.products.benzina-95`, …). Products
are **lazily created per user**: on first use of a pick, the service looks up
the user's products for `category 'fuel'` + exact canonical name; missing →
create with `category 'fuel'`, `unit_kind 'volume'`, `brand NULL`.

### 11.2 Two-of-three price entry

The user enters **any two** of: price per liter, liters, total — the third is
computed live (client) and re-validated (server). The UI tracks the two
most-recently edited fields as authoritative and recomputes the third on every
keystroke, using the domain helpers. `src/lib/domain/money.ts` is created by
Spec 02 §4.1 (`calculateUnitPriceMilli`, `toCents`, `toMilli`,
`centsToMilli`); this spec only **adds** the two fuel helpers to it:

```typescript
// src/lib/domain/money.ts — file owned by Spec 02; this spec adds:
export function calculateFuelTotalCents(unitPriceMilli: number, liters: number): number {
  return Math.round((unitPriceMilli * liters) / 10);
}
export function calculateFuelLiters(totalPriceCents: number, unitPriceMilli: number): number {
  // Pumps display 2–3 decimals; 3 keeps the round-trip loss below a cent.
  return Math.round(((totalPriceCents * 10) / unitPriceMilli) * 1000) / 1000;
}
```

**Precision note**: pump unit prices have three decimals — this is exactly why
`unit_price_milli` exists. €1.799/L → `1799`; a cents column would corrupt
every fuel entry.

### 11.3 `createFuelEntry` — Server Action

`src/app/[locale]/(app)/add/fuel/actions.ts`:

```typescript
export const createFuelEntrySchema = z.object({
  fuel: z.enum(['benzina-95', 'diesel', 'gpl']),
  /** Store of kind 'fuel_station'; optional but encouraged. */
  storeId: nanoidSchema.nullable(),
  recordedAt: z.number().int().positive(),
  unitPriceMilli: z.number().int().min(1).max(10_000),   // ≤ €10/L
  liters: z.number().min(0.1).max(200),                   // → package_size
  totalPriceCents: z.number().int().min(1).max(50_000),   // ≤ €500
});

export async function createFuelEntry(
  input: CreateFuelEntryInput,
): Promise<ActionResult<{ entryId: string }>>;
```

Behavior:

1. Validate the store, when given, exists, belongs to the user, **and has
   `kind 'fuel_station'`** (`STORE_NOT_FOUND` / `INVALID_STORE_KIND`).
2. Cross-validate the triple: `|unitPriceMilli × liters − totalPriceCents × 10| ≤ 10`
   (±1 cent, absorbing pump rounding) → else `INCONSISTENT_FUEL_PRICES`.
3. Get-or-create the fuel product (§11.1).
4. Insert via `createPriceEntry`: `source 'fuel'`, `package_size = liters`,
   `is_promo 0`, `session_id NULL`, `photo_url NULL`.

---

## 12. Error Taxonomy & UX Copy Hooks

What the user sees for every failure mode. Keys go in **both**
`messages/it.json` and `messages/en.json`; copy below is the shipping copy.

| Scenario | Detection | Queue/UI behavior | i18n key | EN copy | IT copy |
|---|---|---|---|---|---|
| Photo unreadable / not a tag | `confidence < 0.6` or `0` sentinels | Extracted but flagged; badge on review card | `review.lowConfidence` | "Hard to read — check the numbers" | "Foto difficile da leggere — controlla i numeri" |
| Total ≠ unit × size | cross-check §7.4 | Badge on review card | `review.priceMismatch` | "Price and unit price don't add up" | "Prezzo e prezzo al kg non tornano" |
| `needsReview` badge label | either reason | Badge | `review.needsReview` | "Check this one" | "Da controllare" |
| Network fail / offline | fetch rejects | Photo stays `queued`; tray chip; retried by Spec 06 | `scan.queue.offline` | "Saved — will upload when you're back online" | "Salvata — la carichiamo appena torni online" |
| Upstream busy (429/5xx) | 503 `EXTRACTION_UNAVAILABLE` | Back to `queued`, auto-retry (≤ 5 attempts) | `scan.queue.retrying` | "Upload hiccup — retrying" | "Problema di caricamento — riprovo" |
| Extraction refused/failed | 422 `EXTRACTION_FAILED` | Status `failed`; tray chip with retake/delete | `scan.errors.extractionFailed` | "Couldn't read this photo. Retake it or add the item manually." | "Non riesco a leggere questa foto. Riscattala o inserisci il prodotto a mano." |
| Retry budget exhausted | 5 failed attempts | Status `failed`; manual retry resets budget | `scan.errors.uploadFailed` | "Upload failed. Tap to retry." | "Caricamento non riuscito. Tocca per riprovare." |
| Photo too large / wrong type | 413/415 | Status `failed` (guard — compression should prevent this) | `scan.errors.invalidPhoto` | "This photo can't be processed" | "Questa foto non può essere elaborata" |
| Camera permission denied | `NotAllowedError` | Fallback panel §3.3 | `scan.camera.permissionDenied.title` / `.body` / `.retry` / `.useLibrary` | "Camera access needed" / "segnaprezzi uses the camera to photograph price tags. Nothing is uploaded without your review." / "Try again" / "Choose from library" | "Serve l'accesso alla fotocamera" / "segnaprezzi usa la fotocamera per fotografare i cartellini. Nulla viene caricato senza la tua conferma." / "Riprova" / "Scegli dalla libreria" |
| No camera available | `NotFoundError` etc. | File input as primary | `scan.camera.unavailable` | "Take a photo" | "Scatta una foto" |
| Framing hint | — | Caption under guide | `scan.camera.frameHint` | "Fit the price tag in the frame" | "Inquadra il cartellino" |
| Fuel triple inconsistent | `INCONSISTENT_FUEL_PRICES` | Inline form error | `addFuel.errors.inconsistent` | "These numbers don't match — check one of them" | "I numeri non tornano — ricontrollane uno" |

Toast/badge components come from Spec 05; Spec 03 wires the keys.

---

## 13. Tests

Unit tests are colocated (`*.test.ts`), E2E under `tests/e2e/` (Spec 00 §10).

### 13.1 `src/lib/ai/extract-price-tag.test.ts` — mocked Anthropic client

Mock at the client boundary — never hit the network:

```typescript
const parse = vi.fn();
const mockClient = { messages: { parse } } as unknown as Anthropic;
```

| Case | Fixture / arrangement | Assertion |
|---|---|---|
| Happy path | `parse` resolves `{ stop_reason: 'end_turn', parsed_output: validExtraction }` | Returns the extraction; `parse` called with `model 'claude-haiku-4-5'`, `temperature 0`, base64 image block, `output_config.format` present |
| Store-kind hint | input `storeKind 'fuel_station'` | User text content contains `"Store kind: fuel_station"` |
| Refusal | `{ stop_reason: 'refusal', parsed_output: null }` | Throws `AiGatewayError` `failureCode 'refused'`, `isRetryable false` |
| Malformed output | `{ stop_reason: 'max_tokens', parsed_output: null }` | `failureCode 'malformed-output'`, not retryable |
| Rate limited | `parse` rejects with an `Anthropic.RateLimitError` instance | `failureCode 'rate-limited'`, retryable |
| Timeout | rejects with `Anthropic.APIConnectionTimeoutError` | `failureCode 'timeout'`, retryable |
| Overloaded (529) | rejects with `Anthropic.APIError`, `status 529` | `failureCode 'upstream-unavailable'`, retryable |
| Bad request | rejects with `Anthropic.BadRequestError` (`status 400`) | `failureCode 'invalid-request'`, not retryable |
| Unknown error | rejects with `new Error('boom')` | `failureCode 'malformed-output'`, not retryable, `cause` preserved |

Construct SDK error instances with the real classes (e.g.
`new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, 'x', new Headers())`)
so the `instanceof` mapping is what's actually under test.

### 13.2 `src/lib/ai/flag-extraction.test.ts`

Clean tag (0% gap) · gap exactly at 2% (not flagged — strict `>`) · gap above
2% → `price-mismatch` · `confidence 0.59` → `low-confidence` · both reasons
together · `0` sentinels skip the cross-check but keep the confidence flag.

### 13.3 `src/lib/services/match-products.test.ts`

The table from §8.2, verbatim.

### 13.4 `src/lib/services/confirm-shopping-session.test.ts`

Run against an **in-memory libSQL database** with the real Drizzle
repositories (`@libsql/client` `createClient({ url: ':memory:' })` + migrations
applied in `beforeEach`) — realistic SQL semantics (`onConflictDoNothing`,
transactions) with zero fake-repo maintenance.

| Test | Asserts |
|---|---|
| should create new products and entries and complete the session | rows exist, `source 'photo'`, `status 'completed'`, `completed_at` set, `store_id` propagated |
| should reuse an existing product on normalized name+brand match | no duplicate product row |
| should collapse two identical "new" picks in one batch | one product, two entries |
| should be idempotent when confirmed twice with the same input | second call `ok`, row counts unchanged |
| should return success without writes when the session is already completed | idempotent replay |
| should reject another user's session | `SessionNotFoundError` |
| should reject a discarded session | `SessionClosedError` |
| should reject an existing productId owned by another user | `ProductNotFoundError` |

Action-level (Zod) tests: `promoKind` without `isPromo` rejected; `photoUrl`
outside `*.public.blob.vercel-storage.com` rejected.

### 13.5 `src/lib/offline/compress.test.ts`

jsdom/happy-dom have no real canvas, so the unit test covers the pure
geometry: `fitWithinMaxDimension` (no-op under the cap, downscale over it,
aspect preserved, never upscales, rounding). The full pipeline —
EXIF orientation, WebP output, ≤ 400 KB target, JPEG fallback — is covered in
the real browser by the Playwright spec (§13.6), which asserts on the
uploaded file's type and size via route interception.

### 13.6 `tests/e2e/capture-flow.spec.ts` (Playwright)

The critical path, using the file-input fallback (deterministic — no camera in
CI) and `page.route('/api/extract', ...)` returning a fixture
`ExtractPhotoResponse`: upload fixture photo → tray shows `extracted` chip →
review shows the card with suggestion → pick suggestion → confirm → entry
visible in `/history`. A second scenario: fixture with `needsReview: true`
asserts the badge and the blocked-confirm scroll behavior.

---

## 14. Definition of Done

- [ ] All files from §1.2 exist at the exact paths, pass `pnpm biome check`
      and `pnpm typecheck`.
- [ ] `/scan` captures via getUserMedia on a phone, falls back to the file
      input when denied/unavailable, and never blocks the shutter on network.
- [ ] Photos are compressed to ≤ 1600 px WebP (JPEG on old Safari) targeting
      ≤ 400 KB before entering Dexie.
- [ ] Airplane-mode test: shoot 3 photos offline → all `queued`; going online
      + reload, `uploadPendingPhoto` drains them (Spec 03 immediate-attempt
      path) and the review screen shows 3 extracted cards.
- [ ] `POST /api/extract` enforces every rule in §6.2 and returns the §6.6
      error shapes; retrying the same `photoId` overwrites the same Blob path.
- [ ] The system prompt in `src/lib/ai/extraction-prompt.ts` matches §7.1
      verbatim; the model id is `claude-haiku-4-5`; `temperature 0`;
      `max_tokens 1500`; structured output via `messages.parse` +
      `zodOutputFormat`.
- [ ] Cross-check and confidence flags produce `needsReview` badges on review
      cards.
- [ ] `confirmShoppingSession` is transactional and idempotent; confirmed
      entries carry `source 'photo'`, `photo_url`, `ai_confidence`,
      `ai_model`, `ai_raw_json`.
- [ ] Manual and fuel forms create entries with `source 'manual'` / `'fuel'`;
      fuel two-of-three math is live and server-validated (±1 cent).
- [ ] Every i18n key from §12 exists in `messages/it.json` **and**
      `messages/en.json`.
- [ ] All tests from §13 pass: `pnpm test` (Vitest) and `pnpm test:e2e`
      (Playwright).
- [ ] `pnpm build` succeeds; no service imports `next/*`; no repository
      contains business rules; comments follow `docs/COMMENTS.md`.

---

## Implementation Prompt

Paste this into a fresh Claude Code session to implement this spec:

```text
You are implementing Spec 03 (Capture & AI Extraction) of segnaprezzi.

Before writing any code, read IN FULL, in this order:
1. AGENTS.md and CLAUDE.md (project conventions and current status)
2. docs/specs/00-overview.md — the canonical contract: names, money rules,
   category taxonomy, route map. Never contradict it.
3. docs/specs/03-capture-ai.md — the spec you are implementing.
4. docs/DEVELOPMENT_GUIDELINES.md and docs/COMMENTS.md — layered
   architecture, naming, error handling, and comment discipline for every
   line you write.

Then implement docs/specs/03-capture-ai.md completely:
- Create every file in its §1.2 inventory at the exact path, with the exact
  exported names, schemas, prompt text (§7.1 verbatim), and behaviors.
- The extraction model is claude-haiku-4-5 with structured outputs via
  client.messages.parse + zodOutputFormat — exactly as §7.3 shows. Do not
  substitute the model or the API pattern.
- Money is integers everywhere: total_price_cents, unit_price_milli. Never
  floats for money.
- Route handlers and Server Actions stay thin: Zod at the boundary, services
  orchestrate, repositories persist, gateways talk to Anthropic/Blob.
- Write all tests in §13 and make them pass: pnpm test and pnpm test:e2e.
- Verify quality gates: pnpm biome check, pnpm typecheck, pnpm build.
- Commit with conventional commits, one logical change per commit
  (e.g. "feat: add offline photo queue", "feat: add /api/extract pipeline").
- When done, update the "Current status" section of CLAUDE.md to record that
  Spec 03 is implemented, and note any deliberate deviations.
If the spec is ambiguous or conflicts with 00-overview, stop and ask before
inventing a resolution.
```

**Recommended model:** Claude Opus 5
**Recommended effort:** high

**Prerequisites:** Spec 01 (Foundation & Scaffold) and Spec 02 (Database &
Auth) must already be implemented — this spec consumes their repositories,
`requireUser()`, `src/lib/env.ts`, and the Drizzle schema. Spec 04 is
independent (parallel-safe); Specs 05 and 06 build on this one.




