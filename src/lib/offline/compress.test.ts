import { describe, expect, test } from 'vitest';

import { fitWithinMaxDimension } from './compress';

/*
 * Only the geometry is unit-tested: jsdom and happy-dom have no real canvas,
 * so createImageBitmap/OffscreenCanvas cannot run here. The rest of the
 * pipeline — EXIF orientation, WebP output, the 400 KB target, the JPEG
 * fallback — is covered in a real browser by tests/e2e/capture-flow.spec.ts,
 * which asserts on the uploaded file's type and size (Spec 03 §13.5).
 */

describe('fitWithinMaxDimension', () => {
  test('should leave an image already under the cap untouched', () => {
    expect(fitWithinMaxDimension(1200, 900, 1600)).toEqual({ width: 1200, height: 900 });
  });

  test('should leave an image exactly at the cap untouched', () => {
    expect(fitWithinMaxDimension(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  test('should scale a landscape photo down by its longest edge', () => {
    expect(fitWithinMaxDimension(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  test('should scale a portrait photo down by its longest edge', () => {
    expect(fitWithinMaxDimension(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  test('should preserve the aspect ratio within a rounding unit', () => {
    const { width, height } = fitWithinMaxDimension(4032, 3024, 1600);

    expect(Math.abs(width / height - 4032 / 3024)).toBeLessThan(0.01);
  });

  test('should round the scaled edge to a whole pixel', () => {
    const { width, height } = fitWithinMaxDimension(3999, 2251, 1600);

    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  test('should never upscale a small photo', () => {
    expect(fitWithinMaxDimension(320, 240, 1600)).toEqual({ width: 320, height: 240 });
  });
});
