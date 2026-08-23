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
import { del, list, put } from '@vercel/blob';

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

/**
 * Delete the photos among `urls` that belong to this user, best effort.
 *
 * Two safeguards: URLs are filtered to the caller's own photo prefix (a
 * client must never be able to name someone else's blob, and a stored URL
 * must never reach `del` unchecked either), and failures are logged and
 * swallowed — an orphan blob is a cost nuisance, not a correctness problem,
 * and must not fail the delete the user asked for.
 */
export async function deleteOwnedPhotos(userId: string, urls: string[]): Promise<void> {
  const prefix = buildUserPhotoPrefix(userId);
  const ownedUrls = urls.filter((url) => {
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
    console.error('Failed to delete photos', {
      userId,
      photoCount: ownedUrls.length,
      cause: error,
    });
  }
}

/**
 * Delete every photo stored under a user's prefix.
 *
 * Used when the account itself is deleted: the database cascades from
 * `users` to every app table, but blobs live outside it and would otherwise
 * survive the account forever. That is a privacy problem, not just a cost
 * one — "delete my account" has to mean the photos too.
 *
 * Listing is paginated because the store has no "delete by prefix"; a user
 * with a year of shopping has hundreds of blobs. Errors are logged and
 * swallowed: the account deletion itself has already happened by the time
 * this runs, and failing here would only turn a completed deletion into an
 * error the user cannot act on. A leftover blob can be pruned later; a
 * half-deleted account cannot be un-deleted.
 */
export async function deleteAllUserPhotos(userId: string): Promise<void> {
  const prefix = buildUserPhotoPrefix(userId);
  try {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      if (page.blobs.length > 0) {
        await del(page.blobs.map((blob) => blob.url));
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.error('Failed to delete photos of a deleted account', { userId, cause: error });
  }
}
