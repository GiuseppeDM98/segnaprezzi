/**
 * Client-side photo compression for the capture pipeline.
 *
 * Design: phone cameras produce 8–50 MP images, but Claude reads a shelf tag
 * perfectly well at ≤ 1600 px. Compressing on-device before queueing keeps
 * IndexedDB small, lets uploads survive supermarket connectivity, and caps
 * Anthropic image-token cost (tokens ≈ width × height / 750, see Spec 03 §7.5).
 */

const MAX_DIMENSION_PX = 1600;
const TARGET_BYTES = 400 * 1024;
const INITIAL_QUALITY = 0.8;
const RETRY_QUALITY = 0.65;

export interface CompressedPhoto {
  blob: Blob;
  /** Actual encoding: 'image/webp', or 'image/jpeg' on browsers that cannot encode WebP. */
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Compress a camera photo into an upload-ready image.
 *
 * @param source - Raw photo from the camera or file input (any browser-decodable
 *   image, including HEIC on Safari)
 * @returns Photo with longest edge ≤ 1600 px, targeting ≤ 400 KB
 * @throws DOMException when the source cannot be decoded as an image
 */
export async function compressPhoto(source: Blob): Promise<CompressedPhoto> {
  // 'from-image' bakes the EXIF orientation into the pixels, so portrait
  // phone shots do not arrive sideways at the model.
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });

  try {
    const { width, height } = fitWithinMaxDimension(bitmap.width, bitmap.height, MAX_DIMENSION_PX);

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Cannot acquire 2d context for photo compression');
    }
    context.drawImage(bitmap, 0, 0, width, height);

    let blob = await encodeCanvas(canvas, INITIAL_QUALITY);

    // One retry at lower quality is enough: tags are flat, high-contrast
    // subjects that compress well, so a second step rarely changes the
    // outcome — and the /api/extract 5 MB cap is the real safety net.
    if (blob.size > TARGET_BYTES) {
      blob = await encodeCanvas(canvas, RETRY_QUALITY);
    }

    return { blob, mimeType: blob.type, width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Scale (width, height) to fit within maxDimension, preserving aspect ratio.
 * Never upscales.
 */
export function fitWithinMaxDimension(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / longestEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encodeCanvas(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
  // Safari < 17 silently ignores the requested type and encodes PNG when it
  // cannot produce WebP; JPEG at the same quality is the closest substitute
  // that keeps uploads small.
  if (webp.type === 'image/webp') {
    return webp;
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
