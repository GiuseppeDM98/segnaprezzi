/**
 * POST /api/extract-receipt — one receipt file in, N reviewable lines out.
 *
 * A route handler rather than a Server Action because the caller posts a
 * binary body. Thin by contract: parse, guard, delegate to the
 * service, map domain errors to the status table below. The file is read
 * into memory, handed to the service, and dropped — nothing is written to
 * disk, to /tmp, or to Blob storage.
 */
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import {
  RECEIPT_FILE_KIND_BY_MEDIA_TYPE,
  RECEIPT_MEDIA_TYPES,
  type ReceiptMediaType,
} from '@/lib/domain/receipts';
import { nanoidSchema } from '@/lib/domain/schemas';
import { STORE_KINDS } from '@/lib/domain/stores';
import {
  DomainError,
  type DomainErrorCode,
  ExtractionUnavailableError,
  UnauthorizedError,
} from '@/lib/errors';
import { importReceipt } from '@/lib/services/import-receipt';

/**
 * Haiku on a 60-line PDF plus a cold start can exceed the 30 s default; the
 * gateway's own timeout is 45 s, so the function must outlive it.
 */
export const maxDuration = 60;

/** Hard cap on the upload. */
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** A shopping trip does not print more pages than this. */
const MAX_PDF_PAGES = 10;

/** How long a client should wait before retrying a temporarily unavailable upstream. */
const RETRY_AFTER_SECONDS = 30;

const extractReceiptRequestSchema = z.object({
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
    const fields = extractReceiptRequestSchema.safeParse({
      storeId: formData.get('storeId') ?? undefined,
      storeKind: formData.get('storeKind') ?? undefined,
    });
    if (!fields.success) {
      return errorResponse(400, 'INVALID_INPUT', fields.error.message);
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return errorResponse(400, 'INVALID_INPUT', 'Missing receipt file');
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      return errorResponse(413, 'RECEIPT_TOO_LARGE', 'Receipt exceeds 5 MB');
    }
    if (!isReceiptMediaType(file.type)) {
      return errorResponse(415, 'UNSUPPORTED_RECEIPT_TYPE', `Got ${file.type}`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Why magic bytes matter more here than for camera photos: this file
    // comes off the user's disk, not out of our own compressor, so the
    // declared Content-Type is a claim rather than a fact.
    if (!hasMatchingMagicBytes(bytes, file.type)) {
      return errorResponse(
        415,
        'UNSUPPORTED_RECEIPT_TYPE',
        `Content does not look like ${file.type}`,
      );
    }
    if (file.type === 'application/pdf' && countPdfPages(bytes) > MAX_PDF_PAGES) {
      return errorResponse(422, 'RECEIPT_TOO_LONG', 'PDF has more than 10 pages');
    }

    const result = await importReceipt(db, {
      userId: user.id,
      file: {
        bytes,
        mediaType: file.type,
        kind: RECEIPT_FILE_KIND_BY_MEDIA_TYPE[file.type],
      },
      storeId: fields.data.storeId ?? null,
      storeKind: fields.data.storeKind ?? null,
      now: Date.now(),
    });
    return Response.json(result);
  } catch (error) {
    return mapReceiptError(error);
  }
}

function isReceiptMediaType(type: string): type is ReceiptMediaType {
  return (RECEIPT_MEDIA_TYPES as readonly string[]).includes(type);
}

/** Leading bytes each accepted format must actually start with. */
function hasMatchingMagicBytes(bytes: Uint8Array, mediaType: ReceiptMediaType): boolean {
  if (mediaType === 'application/pdf') {
    // "%PDF-"
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (mediaType === 'image/jpeg') {
    // JPEG SOI marker.
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  // WebP is a RIFF container: "RIFF" .... "WEBP".
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
  );
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * Count a PDF's pages by counting its `/Type /Page` objects.
 *
 * A regex, not a parser: the number is a guard, not a fact the app relies
 * on, and the 5 MB cap already bounds the request whatever this returns.
 * `/Pages` (the tree node) is excluded by requiring a non-word character
 * after "Page".
 */
function countPdfPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1');
  return text.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
}

/** Uniform error body shape for this endpoint (§4.2). */
function errorResponse(
  status: number,
  code: DomainErrorCode,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/**
 * Translate a thrown value into the §4.2 response table.
 *
 * Unknown errors collapse to 500 with a generic message and a full log
 * entry: a stack trace or a libSQL message must never reach the client.
 */
function mapReceiptError(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return errorResponse(401, 'UNAUTHORIZED', error.message);
  }
  if (error instanceof ExtractionUnavailableError) {
    return errorResponse(503, 'EXTRACTION_UNAVAILABLE', error.message, {
      'Retry-After': String(RETRY_AFTER_SECONDS),
    });
  }
  if (error instanceof DomainError) {
    return errorResponse(HTTP_STATUS_BY_CODE[error.code], error.code, error.message);
  }

  console.error('Unhandled error in POST /api/extract-receipt', { cause: error });
  return errorResponse(500, 'INTERNAL', 'Unexpected error');
}
