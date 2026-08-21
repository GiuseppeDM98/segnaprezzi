/**
 * Shopping session state machine (Spec 03 §2).
 *
 * Design: a spesa starts on a phone with no connectivity, so the client mints
 * the session id at the first shutter press and the server materializes the
 * row lazily, the first time anything reaches it. Every entry point therefore
 * goes through findOrCreateShoppingSession, which is also where ownership and
 * "still open" are enforced — a session id from another user is reported as
 * not-found, never as forbidden, so the API never confirms that a foreign id
 * exists.
 */

import { buildUserPhotoPrefix, deleteEntryPhotos } from '@/lib/blob/photo-storage';
import type { Db, DbTransaction } from '@/lib/db/client';
import {
  createShoppingSession,
  discardOtherOpenShoppingSessions,
  getResumableShoppingSession,
  getShoppingSessionById,
  isShoppingSessionIdTaken,
  updateShoppingSession,
} from '@/lib/db/repositories/shopping-sessions';
import { getStoreById } from '@/lib/db/repositories/stores';
import type { ShoppingSession } from '@/lib/db/schema/app';
import { SessionClosedError, SessionNotFoundError, StoreNotFoundError } from '@/lib/errors';

/** Sessions in these statuses are terminal: nothing may be added to them. */
const CLOSED_STATUSES = new Set(['completed', 'discarded']);

/**
 * Find the user's session by its client-generated id, materializing the row
 * on first contact.
 *
 * @param db - Database or transaction; the confirm flow calls this inside its transaction
 * @param userId - Always from the server session, never from client input
 * @param sessionId - Client-generated nanoid(21)
 * @param storeId - Store chosen in the capture header, if any
 * @returns The open session row
 * @throws SessionNotFoundError when the id belongs to another user
 * @throws SessionClosedError when the session is completed or discarded
 * @throws StoreNotFoundError when storeId does not belong to the user
 */
export async function findOrCreateShoppingSession(
  db: Db | DbTransaction,
  userId: string,
  sessionId: string,
  storeId: string | null = null,
): Promise<ShoppingSession> {
  const existing = await getShoppingSessionById(db, userId, sessionId);

  if (existing) {
    if (CLOSED_STATUSES.has(existing.status)) {
      throw new SessionClosedError(sessionId, existing.status);
    }
    return existing;
  }

  // The id exists but not for this user: report not-found rather than
  // colliding on the primary key, and never confirm that a foreign id exists.
  if (await isShoppingSessionIdTaken(db, sessionId)) {
    throw new SessionNotFoundError(sessionId);
  }

  if (storeId) {
    const store = await getStoreById(db, userId, storeId);
    if (!store) {
      throw new StoreNotFoundError(storeId);
    }
  }

  const created = await createShoppingSession(db, userId, { id: sessionId, storeId });
  // Starting a new spesa abandons any unfinished one: two open sessions would
  // make the tray and the resume banner disagree about which spesa is "the"
  // current one, and photos would silently split across both.
  await discardOtherOpenShoppingSessions(db, userId, created.id);
  return created;
}

/**
 * Move an open session into `reviewing` — a resume aid, not a gate. Confirm
 * still accepts `active` sessions, because the client may never have been
 * online while the user was reviewing.
 */
export async function beginSessionReview(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<ShoppingSession> {
  const session = await findOrCreateShoppingSession(db, userId, sessionId);
  if (session.status === 'reviewing') {
    return session;
  }
  const updated = await updateShoppingSession(db, userId, sessionId, { status: 'reviewing' });
  return updated ?? session;
}

/** The newest session the user could still resume, or null (Spec 03 §2.3). */
export async function getResumableSession(db: Db, userId: string): Promise<ShoppingSession | null> {
  return getResumableShoppingSession(db, userId);
}

export interface DiscardShoppingSessionInput {
  sessionId: string;
  /** Blob URLs of already-extracted photos, so the server can clean them up. */
  blobUrls: string[];
}

/**
 * Abandon a spesa and clean up its uploaded photos.
 *
 * Idempotent by design: an all-offline spesa never materialized a row, and
 * discarding it must still succeed — the client has to be able to clear its
 * local queue either way.
 */
export async function discardShoppingSession(
  db: Db,
  userId: string,
  input: DiscardShoppingSessionInput,
): Promise<{ sessionId: string }> {
  const session = await getShoppingSessionById(db, userId, input.sessionId);

  if (session && session.status !== 'completed') {
    await updateShoppingSession(db, userId, input.sessionId, { status: 'discarded' });
  }

  await deleteOwnedPhotos(userId, input.blobUrls);
  return { sessionId: input.sessionId };
}

/**
 * Delete blobs the client says belong to this session, best effort.
 *
 * Two safeguards: URLs are filtered to the caller's own photo prefix (a
 * client must never be able to name someone else's blob), and failures are
 * logged and swallowed — an orphan blob is a cost nuisance, not a
 * correctness problem, and must not fail the user's discard.
 */
async function deleteOwnedPhotos(userId: string, blobUrls: string[]): Promise<void> {
  const prefix = buildUserPhotoPrefix(userId);
  const ownedUrls = blobUrls.filter((url) => {
    try {
      return new URL(url).pathname.replace(/^\//, '').startsWith(prefix);
    } catch {
      return false;
    }
  });

  if (ownedUrls.length === 0) {
    return;
  }

  try {
    await deleteEntryPhotos(ownedUrls);
  } catch (error) {
    console.error('Failed to delete discarded session photos', {
      userId,
      photoCount: ownedUrls.length,
      cause: error,
    });
  }
}
