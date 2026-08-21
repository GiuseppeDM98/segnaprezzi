import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import {
  priceEntries,
  products,
  shoppingSessions,
  stores,
  userSettings,
} from '@/lib/db/schema/app';
import { users } from '@/lib/db/schema/auth';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { getUserSettings, updateUserSettings } from './settings';

describe('settings repository', () => {
  let db: Db;
  let userId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    userId = (await createTestUser(db)).id;
  });

  it('should create default settings on first read when the row is missing', async () => {
    const settings = await getUserSettings(db, userId);

    expect(settings.userId).toBe(userId);
    expect(settings.includePromosInIndex).toBe(true);
    expect(settings.carryForwardMonths).toBe(2);
  });

  it('should persist partial settings updates', async () => {
    await getUserSettings(db, userId);

    const updated = await updateUserSettings(db, userId, { carryForwardMonths: 0 });

    expect(updated.carryForwardMonths).toBe(0);
    expect(updated.includePromosInIndex).toBe(true);

    const reread = await getUserSettings(db, userId);
    expect(reread.carryForwardMonths).toBe(0);
  });

  it('should cascade-delete all user data when the user row is deleted', async () => {
    await getUserSettings(db, userId);
    const [store] = await db
      .insert(stores)
      .values({ userId, name: 'Esselunga', kind: 'supermarket' })
      .returning();
    const [product] = await db
      .insert(products)
      .values({ userId, name: 'Pasta', category: 'food', unitKind: 'weight' })
      .returning();
    const [session] = await db
      .insert(shoppingSessions)
      .values({ userId, storeId: store.id })
      .returning();
    await db.insert(priceEntries).values({
      userId,
      productId: product.id,
      storeId: store.id,
      sessionId: session.id,
      recordedAt: new Date(),
      totalPriceCents: 129,
      packageSize: 0.5,
      unitPriceMilli: 2580,
      source: 'manual',
    });

    await db.delete(users).where(eq(users.id, userId));

    expect(
      (await db.select().from(userSettings).where(eq(userSettings.userId, userId))).length,
    ).toBe(0);
    expect((await db.select().from(stores).where(eq(stores.userId, userId))).length).toBe(0);
    expect((await db.select().from(products).where(eq(products.userId, userId))).length).toBe(0);
    expect(
      (await db.select().from(shoppingSessions).where(eq(shoppingSessions.userId, userId))).length,
    ).toBe(0);
    expect(
      (await db.select().from(priceEntries).where(eq(priceEntries.userId, userId))).length,
    ).toBe(0);
  });
});
