/**
 * POST /api/extract-receipt — one receipt file in, N reviewable lines out.
 *
 * A route handler rather than a Server Action because the caller posts a
 * binary body. Thin by contract: parse, guard, delegate to the
 * service, map domain errors through the shared status table in
 * ../route-errors.ts. The file is read into memory, handed to the service,
 * and dropped — nothing is written to disk, to /tmp, or to Blob storage.
 */
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import {
  MAX_RECEIPT_BYTES,
  RECEIPT_FILE_KIND_BY_MEDIA_TYPE,
  RECEIPT_MEDIA_TYPES,
  type ReceiptMediaType,
} from '@/lib/domain/receipts';
import { nanoidSchema } from '@/lib/domain/schemas';
import { STORE_KINDS } from '@/lib/domain/stores';
import { importReceipt } from '@/lib/services/import-receipt';
import { errorResponse, toErrorResponse } from '../route-errors';

/**
 * Haiku on a 60-line PDF plus a cold start can exceed the 30 s default; the
 * gateway's own timeout is 45 s, so the function must outlive it.
 */
export const maxDuration = 60;

const BYTES_PER_MB = 1024 * 1024;

/** A shopping trip does not print more pages than this. */
const MAX_PDF_PAGES = 10;

const extractReceiptRequestSchema = z.object({
  storeId: nanoidSchema.optional(),
  storeKind: z.enum(STORE_KINDS).optional(),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;

    const formData = await request.formData();
    const fields = extractReceiptRequestSchema.safeParse({
      storeId: formData.get('storeId') ?? undefined,
      storeKind: formData.get('storeKind') ?? undefined,
    });
    if (!fields.success) {
      return errorResponse('INVALID_INPUT', fields.error.message);
    }

    const upload = await readReceiptUpload(formData.get('file'));
    if (upload instanceof Response) {
      return upload;
    }

    const result = await importReceipt(db, {
      userId,
      file: {
        bytes: upload.bytes,
        mediaType: upload.mediaType,
        kind: RECEIPT_FILE_KIND_BY_MEDIA_TYPE[upload.mediaType],
      },
      storeId: fields.data.storeId ?? null,
      storeKind: fields.data.storeKind ?? null,
      now: Date.now(),
    });
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error, { route: 'POST /api/extract-receipt', userId });
  }
}

/**
 * Check the uploaded receipt and read its bytes.
 *
 * The cheap checks on the declared size and type run before the bytes are
 * copied out of the form; the content checks (magic bytes, PDF page count)
 * need them.
 *
 * @param file - The multipart `file` field
 * @returns The bytes with their narrowed media type, or the error response to send
 */
async function readReceiptUpload(
  file: FormDataEntryValue | null,
): Promise<{ bytes: Uint8Array; mediaType: ReceiptMediaType } | Response> {
  if (!(file instanceof File)) {
    return errorResponse('INVALID_INPUT', 'Missing receipt file');
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return errorResponse(
      'RECEIPT_TOO_LARGE',
      `Receipt exceeds ${MAX_RECEIPT_BYTES / BYTES_PER_MB} MB`,
    );
  }
  const mediaType = file.type;
  if (!isReceiptMediaType(mediaType)) {
    return errorResponse('UNSUPPORTED_RECEIPT_TYPE', `Got ${mediaType}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Why magic bytes matter more here than for camera photos: this file
  // comes off the user's disk, not out of our own compressor, so the
  // declared Content-Type is a claim rather than a fact.
  if (!hasMatchingMagicBytes(bytes, mediaType)) {
    return errorResponse('UNSUPPORTED_RECEIPT_TYPE', `Content does not look like ${mediaType}`);
  }
  if (mediaType === 'application/pdf' && countPdfPages(bytes) > MAX_PDF_PAGES) {
    return errorResponse('RECEIPT_TOO_LONG', `PDF has more than ${MAX_PDF_PAGES} pages`);
  }
  return { bytes, mediaType };
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
 * on, and MAX_RECEIPT_BYTES already bounds the request whatever this returns.
 * `/Pages` (the tree node) is excluded by requiring a non-word character
 * after "Page".
 */
function countPdfPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1');
  return text.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
}
