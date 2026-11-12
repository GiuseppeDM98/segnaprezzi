/**
 * The /api/extract use case: store the photo, read it with
 * Claude, and hand the client something to review.
 *
 * Design: nothing but the lazily materialized session row is written to the
 * database here. The extraction lives in the client's Dexie queue until the
 * user confirms it, which is what makes "photograph now, decide later,
 * possibly offline" work — and what stops a misread tag from ever reaching
 * the index.
 *
 * The blob upload happens BEFORE the AI call so that a retryable extraction
 * failure re-uses (overwrites) the same blob on retry instead of orphaning it.
 */
import { AiGatewayError, EXTRACTION_MODEL, extractPriceTag } from '@/lib/ai/extract-price-tag';
import { flagExtractionForReview } from '@/lib/ai/flag-extraction';
import { uploadEntryPhoto } from '@/lib/blob/photo-storage';
import type { Db } from '@/lib/db/client';
import { listProducts } from '@/lib/db/repositories/products';
import type { ExtractPhotoResponse } from '@/lib/domain/extract-photo';
import type { PhotoMediaType } from '@/lib/domain/photos';
import { ExtractionError, ExtractionUnavailableError } from '@/lib/errors';
import {
  type MatchCandidate,
  type ProductSuggestion,
  suggestProductMatches,
} from './match-products';
import { getOrCreateShoppingSession } from './shopping-session-lifecycle';

export type { ExtractPhotoResponse, ProductSuggestion };

export interface ExtractPhotoEntryInput {
  userId: string;
  photoId: string;
  sessionId: string;
  photoBytes: ArrayBuffer;
  photoContentType: PhotoMediaType;
}

/**
 * Turn one uploaded photo into a reviewable extraction.
 *
 * @throws SessionNotFoundError, SessionClosedError — see getOrCreateShoppingSession
 * @throws ExtractionUnavailableError when the upstream failure is retryable
 * @throws ExtractionError when this exact photo will never extract
 */
export async function extractPhotoEntry(
  db: Db,
  input: ExtractPhotoEntryInput,
): Promise<ExtractPhotoResponse> {
  await getOrCreateShoppingSession(db, input.userId, input.sessionId);

  const blobUrl = await uploadEntryPhoto({
    userId: input.userId,
    entryId: input.photoId,
    body: input.photoBytes,
    contentType: input.photoContentType,
  });

  const extraction = await runExtraction({
    bytes: new Uint8Array(input.photoBytes),
    mediaType: input.photoContentType,
    userId: input.userId,
    photoId: input.photoId,
  });

  const candidates = await loadMatchCandidates(db, input.userId);

  return {
    blobUrl,
    extraction: flagExtractionForReview(extraction),
    suggestions: suggestProductMatches(extraction, candidates),
    model: EXTRACTION_MODEL,
  };
}

/**
 * Call the gateway and translate its internal error type into the domain
 * contract. AiGatewayError never travels past this service — the retryable flag
 * becomes the difference between "we will try again" (503) and "retake the
 * photo" (422).
 */
async function runExtraction(input: {
  bytes: Uint8Array;
  mediaType: PhotoMediaType;
  userId: string;
  photoId: string;
}) {
  try {
    return await extractPriceTag({ bytes: input.bytes, mediaType: input.mediaType });
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

/** The matcher's candidate pool: every non-archived product of the user. */
async function loadMatchCandidates(db: Db, userId: string): Promise<MatchCandidate[]> {
  const products = await listProducts(db, userId, { includeArchived: false });
  return products.map((product) => ({ id: product.id, name: product.name, brand: product.brand }));
}
