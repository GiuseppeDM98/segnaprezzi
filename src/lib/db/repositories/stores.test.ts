import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { priceEntries, products } from '@/lib/db/schema/app';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { createStore, deleteStore, getStoreById, updateStore } from './stores';

describe('stores repository', () => {
  let db: Db;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    userId = (await createTestUser(db)).id;
    otherUserId = (await createTestUser(db)).id;
  });

  it('should create a store and read it back by id', async () => {
    const created = await createStore(db, userId, {
      name: 'Esselunga Viale Papiniano',
      chain: 'Esselunga',
      city: 'Milano',
      kind: 'supermarket',
    });

    const found = await getStoreById(db, userId, created.id);

    expect(found).not.toBeNull();
    expect(found?.name).toBe('Esselunga Viale Papiniano');
    expect(found?.kind).toBe('supermarket');
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it('should return null when the store belongs to another user', async () => {
    const created = await createStore(db, otherUserId, {
      name: 'Coop Via Roma',
      kind: 'supermarket',
    });

    const found = await getStoreById(db, userId, created.id);

    expect(found).toBeNull();
  });

  it('should not update a store owned by another user', async () => {
    const created = await createStore(db, otherUserId, {
      name: 'Coop Via Roma',
      kind: 'supermarket',
    });

    const result = await updateStore(db, userId, created.id, { name: 'Hijacked name' });

    expect(result).toBeNull();
    const unchanged = await getStoreById(db, otherUserId, created.id);
    expect(unchanged?.name).toBe('Coop Via Roma');
  });

  it('should null store_id on entries when the store is deleted', async () => {
    const store = await createStore(db, userId, { name: 'Esselunga', kind: 'supermarket' });
    const [product] = await db
      .insert(products)
      .values({ userId, name: 'Pasta', category: 'food', unitKind: 'weight' })
      .returning();
    const [entry] = await db
      .insert(priceEntries)
      .values({
        userId,
        productId: product.id,
        storeId: store.id,
        recordedAt: new Date(),
        totalPriceCents: 129,
        packageSize: 0.5,
        unitPriceMilli: 2580,
        source: 'manual',
      })
      .returning();

    const deleted = await deleteStore(db, userId, store.id);
    expect(deleted).toBe(true);

    const [reloaded] = await db.select().from(priceEntries).where(eq(priceEntries.id, entry.id));
    expect(reloaded.storeId).toBeNull();
  });
});
