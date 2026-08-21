/**
 * The /api/extract use case (Spec 03 §6.4): store the photo, read it with
 * Claude, and hand the client something to review.
 *
 * Design: nothing but the lazily materialized session row is written to the
 * database here. The extraction lives in the client's Dexie queue until the
 * user confirms it (§9), which is what makes "photograph now, decide later,
 * possibly offline" work — and what stops a misread tag from ever reaching
 * the index.
 *
 * The blob upload happens BEFORE the AI call so that a retryable extraction
 * failure re-uses (overwrites) the same blob on retry instead of orphaning it.
 */
import { AiGatewayError, EXTRACTION_MODEL, extractPriceTag } from '@/lib/ai/extract-price-tag';
import { flagExtractionForReview, type ReviewedExtraction } from '@/lib/ai/flag-extraction';
import { uploadEntryPhoto } from '@/lib/blob/photo-storage';
import { db } from '@/lib/db/client';
import { listProductIdsWithEntriesAtStoreSince } from '@/lib/db/repositories/price-entries';
import { listProducts } from '@/lib/db/repositories/products';
import { getStoreById } from '@/lib/db/repositories/stores';
import type { StoreKind } from '@/lib/domain/stores';
import { ExtractionError, ExtractionUnavailableError, StoreNotFoundError } from '@/lib/errors';
import {
  type MatchCandidate,
  type ProductSuggestion,
  suggestProductMatches,
} from './match-products';
import { findOrCreateShoppingSession } from './shopping-session-lifecycle';

export type { ProductSuggestion };

/**
 * How far back an entry at the capture store still counts as "recent" for
 * the matcher's store bonus. Three months covers a monthly-ish shopping
 * rhythm without resurrecting products the user has stopped buying.
 */
const STORE_RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface ExtractPhotoEntryInput {
  userId: string;
  photoId: string;
  sessionId: string;
  storeId: string | null;
  storeKind: StoreKind | null;
  photoBytes: ArrayBuffer;
  photoContentType: 'image/webp' | 'image/jpeg';
}

export interface ExtractPhotoResponse {
  blobUrl: string;
  extraction: ReviewedExtraction;
  /** Top 3 catalog matches, best first; may be empty. */
  suggestions: ProductSuggestion[];
  /** Model that produced the extraction — stored to price_entries.ai_model on confirm. */
  model: string;
}

/**
 * Turn one uploaded photo into a reviewable extraction.
 *
 * @throws StoreNotFoundError, SessionNotFoundError, SessionClosedError — see §6.2
 * @throws ExtractionUnavailableError when the upstream failure is retryable
 * @throws ExtractionError when this exact photo will never extract
 */
export async function extractPhotoEntry(
  input: ExtractPhotoEntryInput,
): Promise<ExtractPhotoResponse> {
  // A store row wins over the client's storeKind hint: the hint only exists
  // for captures made before any store was picked.
  let storeKind = input.storeKind;
  if (input.storeId) {
    const store = await getStoreById(db, input.userId, input.storeId);
    if (!store) {
      throw new StoreNotFoundError(input.storeId);
    }
    storeKind = store.kind;
  }

  await findOrCreateShoppingSession(db, input.userId, input.sessionId, input.storeId);

  const blobUrl = await uploadEntryPhoto({
    userId: input.userId,
    entryId: input.photoId,
    body: input.photoBytes,
    contentType: input.photoContentType,
  });

  const extraction = await runExtraction({
    imageBase64: Buffer.from(input.photoBytes).toString('base64'),
    mediaType: input.photoContentType,
    storeKind,
    userId: input.userId,
    photoId: input.photoId,
  });

  const candidates = await loadMatchCandidates(input.userId, input.storeId);

  return {
    blobUrl,
    extraction: flagExtractionForReview(extraction),
    suggestions: suggestProductMatches(extraction, candidates),
    model: EXTRACTION_MODEL,
  };
}

/**
 * Call the gateway and translate its internal error type into the domain
 * contract. AiGatewayError never leaves src/lib/ai — the retryable flag
 * becomes the difference between "we will try again" (503) and "retake the
 * photo" (422).
 */
async function runExtraction(input: {
  imageBase64: string;
  mediaType: 'image/webp' | 'image/jpeg';
  storeKind: StoreKind | null;
  userId: string;
  photoId: string;
}) {
  try {
    return await extractPriceTag({
      imageBase64: input.imageBase64,
      mediaType: input.mediaType,
      storeKind: input.storeKind,
    });
  } catch (error) {
    if (!(error instanceof AiGatewayError)) {
      throw error;
    }
    console.error('Price tag extraction failed', {
      userId: input.userId,
      photoId: input.photoId,
      failureCode: error.failureCode,
      isRetryable: error.isRetryable,
      cause: error.cause ?? error.message,
    });
    if (error.isRetryable) {
      throw new ExtractionUnavailableError(error.message, { cause: error });
    }
    throw new ExtractionError(error.message, { cause: error });
  }
}

/**
 * Build the matcher's candidate pool: every non-archived product of the user,
 * flagged with whether it was recently bought at the capture store. Two
 * queries total, never one per product.
 */
async function loadMatchCandidates(
  userId: string,
  storeId: string | null,
): Promise<MatchCandidate[]> {
  const [products, recentProductIds] = await Promise.all([
    listProducts(db, userId, { includeArchived: false }),
    storeId
      ? listProductIdsWithEntriesAtStoreSince(
          db,
          userId,
          storeId,
          new Date(Date.now() - STORE_RECENCY_WINDOW_MS),
        )
      : Promise.resolve<string[]>([]),
  ]);

  const recentProductIdSet = new Set(recentProductIds);
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    hasRecentEntryAtStore: recentProductIdSet.has(product.id),
  }));
}
