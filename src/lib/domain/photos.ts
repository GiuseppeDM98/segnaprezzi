/**
 * What an entry photo is and where it lives. Pure — no imports, so the
 * service worker bundle can read it as safely as the server can.
 */

/**
 * The encodings an entry photo can have: WebP, or JPEG on browsers that
 * cannot encode WebP. src/lib/offline/compress.ts produces them,
 * POST /api/extract accepts only them, and the blob gateway and the AI
 * gateway are typed on them.
 */
export const PHOTO_MEDIA_TYPES = ['image/webp', 'image/jpeg'] as const;
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];

/**
 * Vercel Blob's public host suffix: every stored photo is served from
 * <store-id>.public.blob.vercel-storage.com.
 */
export const BLOB_PUBLIC_HOSTNAME_SUFFIX = '.public.blob.vercel-storage.com';
