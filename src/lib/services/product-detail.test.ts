import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createPriceEntry } from '@/lib/db/repositories/price-entries';
import { createProduct } from '@/lib/db/repositories/products';
import { createStore } from '@/lib/db/repositories/stores';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { listHistoryPage } from './history';
import { editPriceEntry, getProductDetail, removePriceEntry } from './product-detail';

/*
 * Integration tests for the product detail read model (Spec 05 §5.7) and
 * the entry edit/delete use cases it shares with the timeline (§5.8).
 */

let db: Db;
let userId: string;
let otherUserId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
  ({ id: otherUserId } = await createTestUser(db));
});

describe('getProductDetail', () => {
  it("should return null for a product that is not the user's", async () => {
    const foreign = await createProduct(db, otherUserId, {
      name: 'X',
      category: 'other',
      unitKind: 'count',
    });

    expect(await getProductDetail(db, userId, foreign.id)).toBeNull();
  });

  it('should build monthly means, promo markers, stats and the per-store comparison', async () => {
    const esselunga = await createStore(db, userId, { name: 'Esselunga', kind: 'supermarket' });
    const carrefour = await createStore(db, userId, { name: 'Carrefour', kind: 'supermarket' });
    const product = await createProduct(db, userId, {
      name: 'Latte',
      category: 'food',
      unitKind: 'volume',
    });
    const add = (iso: string, milli: number, storeId: string | null, isPromo = false) =>
      createPriceEntry(db, userId, {
        productId: product.id,
        storeId,
        recordedAt: new Date(iso),
        totalPriceCents: Math.round(milli / 10),
        packageSize: 1,
        unitPriceMilli: milli,
        isPromo,
        promoKind: isPromo ? 'discount' : null,
        source: 'manual',
      });
    await add('2026-03-05T10:00:00Z', 1600, esselunga.id);
    await add('2026-03-18T10:00:00Z', 1800, esselunga.id);
    await add('2026-04-05T10:00:00Z', 1500, esselunga.id, true);
    await add('2026-04-12T17:00:00Z', 1900, carrefour.id);

    const detail = await getProductDetail(db, userId, product.id);

    expect(detail?.monthlySeries).toEqual([
      { month: '2026-03', value: 1700 },
      { month: '2026-04', value: 1700 },
    ]);
    expect(detail?.promoMarkers).toEqual([{ month: '2026-04', value: 1500 }]);
    expect(detail?.stats).toEqual({
      min: { unitPriceMilli: 1500, recordedAt: Date.parse('2026-04-05T10:00:00Z') },
      max: { unitPriceMilli: 1900, recordedAt: Date.parse('2026-04-12T17:00:00Z') },
      mean: { unitPriceMilli: 1700 },
      last: { unitPriceMilli: 1900, recordedAt: Date.parse('2026-04-12T17:00:00Z') },
    });
    // Cheapest first, by each store's LATEST observation.
    expect(detail?.storeComparison.map((row) => [row.storeName, row.latestUnitPriceMilli])).toEqual(
      [
        ['Esselunga', 1500],
        ['Carrefour', 1900],
      ],
    );
    expect(detail?.entries.map((entry) => entry.unitPriceMilli)).toEqual([1900, 1500, 1800, 1600]);
  });
});

describe('entry edits', () => {
  it('should update an entry, clear promoKind when isPromo is off, and delete it', async () => {
    const product = await createProduct(db, userId, {
      name: 'Pane',
      category: 'food',
      unitKind: 'weight',
    });
    const entry = await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date('2026-04-05T10:00:00Z'),
      totalPriceCents: 229,
      packageSize: 0.5,
      unitPriceMilli: 4580,
      isPromo: true,
      promoKind: 'loyalty',
      source: 'manual',
    });

    await editPriceEntry(db, userId, entry.id, {
      recordedAt: Date.parse('2026-04-06T10:00:00Z'),
      storeId: null,
      totalPriceCents: 239,
      packageSize: 0.5,
      unitPriceMilli: 4780,
      isPromo: false,
      promoKind: 'loyalty',
    });
    const page = await listHistoryPage(db, userId);
    expect(page.entries[0]).toMatchObject({
      totalPriceCents: 239,
      unitPriceMilli: 4780,
      isPromo: false,
      promoKind: null,
    });

    await removePriceEntry(db, userId, entry.id);
    expect((await listHistoryPage(db, userId)).entries).toHaveLength(0);
  });

  it("should refuse to edit or delete another user's entry", async () => {
    const foreignProduct = await createProduct(db, otherUserId, {
      name: 'X',
      category: 'other',
      unitKind: 'count',
    });
    const foreign = await createPriceEntry(db, otherUserId, {
      productId: foreignProduct.id,
      recordedAt: new Date('2026-04-05T10:00:00Z'),
      totalPriceCents: 100,
      packageSize: 1,
      unitPriceMilli: 1000,
      source: 'manual',
    });

    await expect(removePriceEntry(db, userId, foreign.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      editPriceEntry(db, userId, foreign.id, {
        recordedAt: Date.now(),
        storeId: null,
        totalPriceCents: 1,
        packageSize: 1,
        unitPriceMilli: 1,
        isPromo: false,
        promoKind: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listHistoryPage', () => {
  it('should honor the promo and source filters', async () => {
    const product = await createProduct(db, userId, {
      name: 'Pane',
      category: 'food',
      unitKind: 'weight',
    });
    const add = (iso: string, isPromo: boolean, source: 'manual' | 'photo') =>
      createPriceEntry(db, userId, {
        productId: product.id,
        recordedAt: new Date(iso),
        totalPriceCents: 229,
        packageSize: 0.5,
        unitPriceMilli: 4580,
        isPromo,
        promoKind: isPromo ? 'discount' : null,
        source,
      });
    await add('2026-04-05T10:00:00Z', false, 'manual');
    await add('2026-04-06T10:00:00Z', true, 'photo');
    await add('2026-04-07T10:00:00Z', true, 'manual');

    expect((await listHistoryPage(db, userId, { isPromo: true })).entries).toHaveLength(2);
    expect((await listHistoryPage(db, userId, { source: 'photo' })).entries).toHaveLength(1);
    expect(
      (await listHistoryPage(db, userId, { isPromo: true, source: 'manual' })).entries,
    ).toHaveLength(1);
  });
});
