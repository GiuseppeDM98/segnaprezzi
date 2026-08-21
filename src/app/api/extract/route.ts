/**
 * POST /api/extract — photo in, reviewable extraction out.
 *
 * A route handler rather than a Server Action because the caller is the
 * offline sync manager posting a binary body, not a form.
 * Thin by contract: parse, delegate to the service, map domain errors to the
 * status table below. This handler owns the code→status mapping; services
 * and repositories never know HTTP exists.
 */

import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { nanoidSchema } from '@/lib/domain/schemas';
import { STORE_KINDS } from '@/lib/domain/stores';
import {
  DomainError,
  type DomainErrorCode,
  ExtractionUnavailableError,
  UnauthorizedError,
} from '@/lib/errors';
import { extractPhotoEntry } from '@/lib/services/extract-photo-entry';

/** Hard cap on the upload; compression (§4) should keep photos far below it. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** How long a client should wait before retrying a temporarily unavailable upstream. */
const RETRY_AFTER_SECONDS = 30;

const extractRequestSchema = z.object({
  photoId: nanoidSchema,
  sessionId: nanoidSchema,
  storeId: nanoidSchema.optional(),
  storeKind: z.enum(STORE_KINDS).optional(),
});

// WARNING: extending DomainErrorCode requires a row here and an
// `errors.<CODE>` message in both message files (AGENTS.md §2.3).
const HTTP_STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  EXTRACTION_FAILED: 422,
  INTERNAL: 500,
  INVALID_INPUT: 400,
  INVALID_DATE: 400,
  INVALID_PRICE: 400,
  INVALID_SIZE: 400,
  INVALID_STORE_KIND: 400,
  INCONSISTENT_FUEL_PRICES: 400,
  SESSION_NOT_FOUND: 404,
  STORE_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  SESSION_CLOSED: 409,
  PHOTO_TOO_LARGE: 413,
  UNSUPPORTED_PHOTO_TYPE: 415,
  EXTRACTION_UNAVAILABLE: 503,
  RECEIPT_TOO_LARGE: 413,
  UNSUPPORTED_RECEIPT_TYPE: 415,
  RECEIPT_TOO_LONG: 422,
  RECEIPT_ALREADY_IMPORTED: 409,
  RECEIPT_NOT_FOUND: 404,
  RECEIPT_NO_LINES: 422,
};

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
    return mapExtractError(error);
  }
}

/** Uniform error body shape for this endpoint (§6.2). */
function errorResponse(
  status: number,
  code: DomainErrorCode,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * Translate a thrown value into the §6.6 response table.
 *
 * Unknown errors collapse to 500 with a generic message and a full log entry:
 * a stack trace or a libSQL message must never reach the client.
 */
function mapExtractError(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return errorResponse(401, 'UNAUTHORIZED', error.message);
  }
  if (error instanceof ExtractionUnavailableError) {
    // Retry-After tells the queue how long to hold off; §5.4 classifies 503
    // as retryable regardless.
    return errorResponse(503, 'EXTRACTION_UNAVAILABLE', error.message, {
      'Retry-After': String(RETRY_AFTER_SECONDS),
    });
  }
  if (error instanceof DomainError) {
    return errorResponse(HTTP_STATUS_BY_CODE[error.code], error.code, error.message);
  }

  console.error('Unhandled error in POST /api/extract', { cause: error });
  return errorResponse(500, 'INTERNAL', 'Unexpected error');
}
