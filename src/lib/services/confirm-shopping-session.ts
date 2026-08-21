/**
 * Batch confirm of a reviewed spesa (Spec 03 §9.3).
 *
 * Design: one transaction turns a tray of reviewed extractions into products
 * and price entries and closes the session. It is the only place in the
 * capture pipeline that writes observations, and it is replay-safe on two
 * levels — an already-completed session returns its existing entry ids
 * without writing, and the inserts themselves ignore ids that are already
 * there. Both matter because the confirm request can be retried by a phone
 * that never saw the response.
 */
import type { Db } from '@/lib/db/client';
import {
  createPriceEntriesIgnoringDuplicates,
  listPriceEntryIdsBySession,
} from '@/lib/db/repositories/price-entries';
import { updateDefaultPackageSizes } from '@/lib/db/repositories/products';
import {
  getShoppingSessionById,
  updateShoppingSession,
} from '@/lib/db/repositories/shopping-sessions';
import type { PromoKind } from '@/lib/domain/entries';
import type { ProductPick } from '@/lib/domain/schemas';
import { resolveProductPicks } from './create-price-entry';
import { findOrCreateShoppingSession } from './shopping-session-lifecycle';

export interface ConfirmEntryInput {
  /** The client photo id — becomes price_entries.id and is the idempotency key. */
  id: string;
  product: ProductPick;
  /** Epoch milliseconds UTC. */
  recordedAt: number;
  totalPriceCents: number;
  packageSize: number;
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
  photoUrl: string | null;
  aiConfidence: number | null;
  aiModel: string | null;
  aiRawJson: string | null;
}

export interface ConfirmShoppingSessionInput {
  sessionId: string;
  /** One store per session in v1: applied to the session and to every entry. */
  storeId: string | null;
  entries: ConfirmEntryInput[];
}

export interface ConfirmShoppingSessionResult {
  sessionId: string;
  entryIds: string[];
  createdProductIds: string[];
}

/**
 * Persist a reviewed batch and complete the session.
 *
 * @param db - Database handle; the whole batch runs in one transaction
 * @param userId - Always from the server session
 * @returns The session id, the entry ids, and any products created on the way
 * @throws SessionNotFoundError when the session belongs to another user
 * @throws SessionClosedError when the session was discarded
 * @throws ProductNotFoundError when an `existing` product pick is not the user's
 */
export async function confirmShoppingSession(
  db: Db,
  userId: string,
  input: ConfirmShoppingSessionInput,
): Promise<ConfirmShoppingSessionResult> {
  return db.transaction(async (tx) => {
    // A completed session is a replay, not an error: return what is already
    // there so the client can clear its queue and move on.
    const existing = await getShoppingSessionById(tx, userId, input.sessionId);
    if (existing?.status === 'completed') {
      return {
        sessionId: input.sessionId,
        entryIds: await listPriceEntryIdsBySession(tx, userId, input.sessionId),
        createdProductIds: [],
      };
    }

    await findOrCreateShoppingSession(tx, userId, input.sessionId, input.storeId);

    const { productIds, createdProductIds } = await resolveProductPicks(
      tx,
      userId,
      input.entries.map((entry) => entry.product),
    );

    await createPriceEntriesIgnoringDuplicates(
      tx,
      userId,
      input.entries.map((entry, index) => ({
        id: entry.id,
        productId: productIds[index],
        storeId: input.storeId,
        sessionId: input.sessionId,
        recordedAt: new Date(entry.recordedAt),
        totalPriceCents: entry.totalPriceCents,
        packageSize: entry.packageSize,
        unitPriceMilli: entry.unitPriceMilli,
        isPromo: entry.isPromo,
        promoKind: entry.promoKind,
        source: 'photo' as const,
        photoUrl: entry.photoUrl,
        aiConfidence: entry.aiConfidence,
        aiModel: entry.aiModel,
        aiRawJson: entry.aiRawJson,
      })),
    );

    // Spec 07 §2.2: record each product's newest package size so the next
    // receipt line for it can resolve a unit price without asking the user.
    await updateDefaultPackageSizes(
      tx,
      userId,
      input.entries.map((entry, index) => ({
        productId: productIds[index],
        packageSize: entry.packageSize,
      })),
    );

    await updateShoppingSession(tx, userId, input.sessionId, {
      storeId: input.storeId,
      status: 'completed',
      completedAt: new Date(),
    });

    return {
      sessionId: input.sessionId,
      // The input ids ARE the entry ids, whether this call inserted them or a
      // previous attempt already had.
      entryIds: input.entries.map((entry) => entry.id),
      createdProductIds,
    };
  });
}
