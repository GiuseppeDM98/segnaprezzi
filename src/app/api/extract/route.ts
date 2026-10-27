/**
 * POST /api/extract — photo in, reviewable extraction out.
 *
 * A route handler rather than a Server Action because the caller is the
 * offline sync manager posting a binary body, not a form.
 * Thin by contract: parse, guard, delegate to the service, map domain errors
 * through the shared status table in ../route-errors.ts. Services and
 * repositories never know HTTP exists.
 */

import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { PHOTO_MEDIA_TYPES, type PhotoMediaType } from '@/lib/domain/photos';
import { nanoidSchema } from '@/lib/domain/schemas';
import { STORE_KINDS } from '@/lib/domain/stores';
import { extractPhotoEntry } from '@/lib/services/extract-photo-entry';
import { errorResponse, toErrorResponse } from '../route-errors';

const BYTES_PER_MB = 1024 * 1024;

/** Hard cap on the upload; compression (§4) should keep photos far below it. */
const MAX_PHOTO_BYTES = 5 * BYTES_PER_MB;

const extractRequestSchema = z.object({
  photoId: nanoidSchema,
  sessionId: nanoidSchema,
  storeId: nanoidSchema.optional(),
  storeKind: z.enum(STORE_KINDS).optional(),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string | undefined;
  try {
    userId = (await requireUser()).id;

    const formData = await request.formData();
    const fields = extractRequestSchema.safeParse({
      photoId: formData.get('photoId'),
      sessionId: formData.get('sessionId'),
      storeId: formData.get('storeId') ?? undefined,
      storeKind: formData.get('storeKind') ?? undefined,
    });
    if (!fields.success) {
      return errorResponse('INVALID_INPUT', fields.error.message);
    }

    const photo = checkPhotoUpload(formData.get('photo'));
    if (photo instanceof Response) {
      return photo;
    }

    const result = await extractPhotoEntry(db, {
      userId,
      photoId: fields.data.photoId,
      sessionId: fields.data.sessionId,
      storeId: fields.data.storeId ?? null,
      storeKind: fields.data.storeKind ?? null,
      photoBytes: await photo.file.arrayBuffer(),
      photoContentType: photo.mediaType,
    });
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error, { route: 'POST /api/extract', userId });
  }
}

/**
 * Check the uploaded photo before anything is read or stored.
 *
 * @param photo - The multipart `photo` field
 * @returns The file with its narrowed media type, or the error response to send
 */
function checkPhotoUpload(
  photo: FormDataEntryValue | null,
): { file: File; mediaType: PhotoMediaType } | Response {
  if (!(photo instanceof File)) {
    return errorResponse('INVALID_INPUT', 'Missing photo file');
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return errorResponse('PHOTO_TOO_LARGE', `Photo exceeds ${MAX_PHOTO_BYTES / BYTES_PER_MB} MB`);
  }
  if (!isPhotoMediaType(photo.type)) {
    return errorResponse('UNSUPPORTED_PHOTO_TYPE', `Got ${photo.type}`);
  }
  return { file: photo, mediaType: photo.type };
}

function isPhotoMediaType(type: string): type is PhotoMediaType {
  return (PHOTO_MEDIA_TYPES as readonly string[]).includes(type);
}
