/**
 * Vercel Blob gateway for entry photos.
 *
 * Design: photos are stored with `access: 'public'` under a deterministic
 * path `users/{userId}/photos/{entryId}.webp`. Public because @vercel/blob's
 * private blobs need a signed fetch per render — a server round-trip for
 * every thumbnail on the review and history screens. The path already
 * contains two nanoid(21) components (~126 bits), so it is as unguessable as
 * a random suffix would make it, while `addRandomSuffix: false` +
 * `allowOverwrite: true` keeps client retries idempotent: the same photoId
 * always lands on the same URL instead of orphaning the previous upload.
 *
 * Privacy tradeoff (documented in README): a photo URL is a bearer token —
 * whoever holds it can view the photo. Acceptable for v1 (shelf tags, not
 * personal images); switching to signed private URLs is a v1.1 roadmap item.
 */
import { del, put } from '@vercel/blob';

/** The Blob pathname prefix owning every photo of one user. */
export function buildUserPhotoPrefix(userId: string): string {
  return `users/${userId}/photos/`;
}

/**
 * Upload a compressed entry photo. Deterministic path + overwrite makes
 * client retries idempotent: the same photoId always lands on the same URL.
 *
 * @returns The public Blob URL of the stored photo
 */
export async function uploadEntryPhoto(input: {
  userId: string;
  entryId: string;
  body: ArrayBuffer;
  contentType: 'image/webp' | 'image/jpeg';
}): Promise<string> {
  // The .webp extension is kept even for the Safari JPEG fallback: the stored
  // contentType (passed explicitly) is what browsers and the Anthropic call
  // rely on, the extension is only a naming convention.
  const { url } = await put(
    `${buildUserPhotoPrefix(input.userId)}${input.entryId}.webp`,
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
