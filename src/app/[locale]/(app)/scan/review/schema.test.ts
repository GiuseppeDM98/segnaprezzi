import { describe, expect, test } from 'vitest';

import { confirmShoppingSessionSchema } from './schema';

/*
 * The confirm boundary is where hand-edited client data becomes durable, so
 * these two rules are tested at the schema itself rather than through the
 * action (which needs a request context): a promo kind without a promo would
 * silently poison the promo filter of the index, and a photoUrl outside the
 * Blob store would turn the user's own history into a request to someone
 * else's server (Spec 03 §13.4).
 */

const BLOB_URL = 'https://store.public.blob.vercel-storage.com/users/u/photos/p.webp';

function input(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess0000000000000000A',
    storeId: null,
    entries: [
      {
        id: 'photo000000000000001A',
        product: { kind: 'existing', productId: 'prod0000000000000001A' },
        recordedAt: Date.UTC(2026, 3, 15),
        totalPriceCents: 89,
        packageSize: 0.5,
        unitPriceMilli: 1780,
        isPromo: false,
        promoKind: null,
        photoUrl: BLOB_URL,
        aiConfidence: 0.9,
        aiModel: 'claude-haiku-4-5',
        aiRawJson: '{}',
        ...overrides,
      },
    ],
  };
}

describe('confirmShoppingSessionSchema', () => {
  test('should accept a well-formed entry', () => {
    expect(confirmShoppingSessionSchema.safeParse(input()).success).toBe(true);
  });

  test('should reject a promo kind without the promo flag', () => {
    const result = confirmShoppingSessionSchema.safeParse(input({ promoKind: 'discount' }));

    expect(result.success).toBe(false);
  });

  test('should accept a promo kind when the promo flag is set', () => {
    const result = confirmShoppingSessionSchema.safeParse(
      input({ isPromo: true, promoKind: 'discount' }),
    );

    expect(result.success).toBe(true);
  });

  test('should reject a photo URL outside the Vercel Blob store', () => {
    const result = confirmShoppingSessionSchema.safeParse(
      input({ photoUrl: 'https://evil.example.com/users/u/photos/p.webp' }),
    );

    expect(result.success).toBe(false);
  });

  test('should reject a zero price left by the "not legible" sentinel', () => {
    const result = confirmShoppingSessionSchema.safeParse(input({ totalPriceCents: 0 }));

    expect(result.success).toBe(false);
  });
});
