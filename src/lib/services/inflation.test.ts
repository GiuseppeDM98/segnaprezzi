import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createPriceEntry } from '@/lib/db/repositories/price-entries';
import { createProduct } from '@/lib/db/repositories/products';
import { updateUserSettings } from '@/lib/db/repositories/settings';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { getPersonalCpi } from './inflation';

/*
 * Integration test for the wiring: the three projections reach
 * the pure engine with the user's own data and settings. The engine's
 * numbers themselves are covered exhaustively in src/lib/inflation.
 */

let db: Db;
let userId: string;
let otherUserId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
  ({ id: otherUserId } = await createTestUser(db));
});

describe('getPersonalCpi', () => {
  it('should return the empty result for a user with no entries', async () => {
    const result = await getPersonalCpi(db, userId);

    expect(result.series).toEqual([]);
    expect(result.headline).toBeNull();
    expect(result.coverage.entryCount).toBe(0);
  });

  it("should compute the index from the user's own entries and settings only", async () => {
    // Arrange: one product, +10% over two months for the user; a promo-only
    // second month for another user that must not leak in.
    const product = await createProduct(db, userId, {
      name: 'Spaghetti',
      category: 'food',
      unitKind: 'weight',
    });
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date('2026-03-10T10:00:00Z'),
      totalPriceCents: 100,
      packageSize: 1,
      unitPriceMilli: 1000,
      source: 'manual',
    });
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date('2026-04-10T10:00:00Z'),
      totalPriceCents: 110,
      packageSize: 1,
      unitPriceMilli: 1100,
      source: 'manual',
    });
    const otherProduct = await createProduct(db, otherUserId, {
      name: 'Diesel',
      category: 'fuel',
      unitKind: 'volume',
    });
    await createPriceEntry(db, otherUserId, {
      productId: otherProduct.id,
      recordedAt: new Date('2026-04-10T10:00:00Z'),
      totalPriceCents: 5000,
      packageSize: 30,
      unitPriceMilli: 1700,
      source: 'fuel',
    });

    // Act
    const result = await getPersonalCpi(db, userId);

    // Assert
    expect(result.series.map((point) => point.ym)).toEqual(['2026-03', '2026-04']);
    expect(result.headline?.momPct).toBeCloseTo(10, 10);
    expect(result.coverage.entryCount).toBe(2);
    expect(result.categories.map((category) => category.category)).toEqual(['food']);
    expect(result.movers[0]).toMatchObject({ productId: product.id, name: 'Spaghetti' });
  });

  it('should honor the user settings when computing the index', async () => {
    // Arrange: a promo in April would lower the mean; with promos excluded
    // the regular price alone counts.
    const product = await createProduct(db, userId, {
      name: 'Olio',
      category: 'food',
      unitKind: 'volume',
    });
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date('2026-03-10T10:00:00Z'),
      totalPriceCents: 800,
      packageSize: 1,
      unitPriceMilli: 8000,
      source: 'manual',
    });
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date('2026-04-10T10:00:00Z'),
      totalPriceCents: 800,
      packageSize: 1,
      unitPriceMilli: 8000,
      source: 'manual',
    });
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date('2026-04-12T10:00:00Z'),
      totalPriceCents: 600,
      packageSize: 1,
      unitPriceMilli: 6000,
      isPromo: true,
      promoKind: 'discount',
      source: 'manual',
    });

    // Act
    const withPromos = await getPersonalCpi(db, userId);
    await updateUserSettings(db, userId, { includePromosInIndex: false });
    const withoutPromos = await getPersonalCpi(db, userId);

    // Assert
    expect(withPromos.headline?.momPct).toBeCloseTo(-12.5, 10);
    expect(withoutPromos.headline?.momPct).toBe(0);
  });
});
