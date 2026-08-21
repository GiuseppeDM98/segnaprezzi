import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Db } from '@/lib/db/client';
import { priceEntries, products, shoppingSessions, stores } from '@/lib/db/schema/app';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { ProductNotFoundError, SessionClosedError, SessionNotFoundError } from '@/lib/errors';
import {
  type ConfirmShoppingSessionInput,
  confirmShoppingSession,
} from './confirm-shopping-session';

/*
 * Integration test against a real migrated libSQL database and the real
 * repositories. The behaviours under test — onConflictDoNothing,
 * transaction rollback, FK scoping — are SQL semantics, so a fake repository
 * would test nothing that can actually break.
 *
 * The project's test DB factory deliberately avoids
 * `createClient({ url: ':memory:' })` and uses a uniquely-named temp file
 * instead, because an anonymous in-memory libSQL connection silently resets itself when a
 * transaction callback throws (AGENTS.md §4.17) — which is exactly what half
 * of these tests do.
 */

const SESSION_ID = 'sess0000000000000000A';
const PHOTO_ID_1 = 'photo000000000000001A';
const PHOTO_ID_2 = 'photo000000000000002A';

let db: Db;
let userId: string;
let otherUserId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
  ({ id: otherUserId } = await createTestUser(db));
});

function entry(
  overrides: Partial<ConfirmShoppingSessionInput['entries'][number]> = {},
): ConfirmShoppingSessionInput['entries'][number] {
  return {
    id: PHOTO_ID_1,
    product: {
      kind: 'new',
      name: 'Spaghetti n.5 500g',
      brand: 'Barilla',
      category: 'food',
      unitKind: 'weight',
    },
    recordedAt: Date.UTC(2026, 3, 15, 10, 30),
    totalPriceCents: 89,
    packageSize: 0.5,
    unitPriceMilli: 1780,
    isPromo: false,
    promoKind: null,
    photoUrl: 'https://store.public.blob.vercel-storage.com/users/u/photos/p.webp',
    aiConfidence: 0.93,
    aiModel: 'claude-haiku-4-5',
    aiRawJson: '{"productName":"Spaghetti n.5 500g"}',
    ...overrides,
  };
}

function input(overrides: Partial<ConfirmShoppingSessionInput> = {}): ConfirmShoppingSessionInput {
  return { sessionId: SESSION_ID, storeId: null, entries: [entry()], ...overrides };
}

describe('confirmShoppingSession', () => {
  test('should create new products and entries and complete the session', async () => {
    const [store] = await db
      .insert(stores)
      .values({ userId, name: 'Esselunga Papiniano', kind: 'supermarket' })
      .returning();

    const result = await confirmShoppingSession(db, userId, input({ storeId: store.id }));

    expect(result.entryIds).toEqual([PHOTO_ID_1]);
    expect(result.createdProductIds).toHaveLength(1);

    const [savedEntry] = await db
      .select()
      .from(priceEntries)
      .where(eq(priceEntries.id, PHOTO_ID_1));
    expect(savedEntry).toMatchObject({
      userId,
      storeId: store.id,
      sessionId: SESSION_ID,
      source: 'photo',
      totalPriceCents: 89,
      unitPriceMilli: 1780,
      currency: 'EUR',
      aiModel: 'claude-haiku-4-5',
    });

    const [session] = await db
      .select()
      .from(shoppingSessions)
      .where(eq(shoppingSessions.id, SESSION_ID));
    expect(session.status).toBe('completed');
    expect(session.completedAt).not.toBeNull();
    expect(session.storeId).toBe(store.id);
  });

  test('should reuse an existing product matching on normalized name and brand', async () => {
    await db.insert(products).values({
      userId,
      name: 'SPAGHETTI  N.5 500G',
      brand: 'barilla',
      category: 'food',
      unitKind: 'weight',
    });

    const result = await confirmShoppingSession(db, userId, input());

    expect(result.createdProductIds).toEqual([]);
    const allProducts = await db.select().from(products).where(eq(products.userId, userId));
    expect(allProducts).toHaveLength(1);
  });

  test('should collapse two identical new product picks in one batch', async () => {
    const result = await confirmShoppingSession(
      db,
      userId,
      input({ entries: [entry(), entry({ id: PHOTO_ID_2 })] }),
    );

    expect(result.createdProductIds).toHaveLength(1);
    const savedEntries = await db
      .select()
      .from(priceEntries)
      .where(eq(priceEntries.userId, userId));
    expect(savedEntries).toHaveLength(2);
    expect(savedEntries[0].productId).toBe(savedEntries[1].productId);
  });

  test('should be idempotent when the same batch is confirmed twice', async () => {
    await confirmShoppingSession(db, userId, input());
    const second = await confirmShoppingSession(db, userId, input());

    expect(second.entryIds).toEqual([PHOTO_ID_1]);
    const savedEntries = await db
      .select()
      .from(priceEntries)
      .where(eq(priceEntries.userId, userId));
    expect(savedEntries).toHaveLength(1);
    const allProducts = await db.select().from(products).where(eq(products.userId, userId));
    expect(allProducts).toHaveLength(1);
  });

  test('should return the existing entry ids without writing when already completed', async () => {
    await confirmShoppingSession(db, userId, input());

    const replay = await confirmShoppingSession(
      db,
      userId,
      input({ entries: [entry({ id: PHOTO_ID_2 })] }),
    );

    expect(replay.entryIds).toEqual([PHOTO_ID_1]);
    expect(replay.createdProductIds).toEqual([]);
    const savedEntries = await db
      .select()
      .from(priceEntries)
      .where(eq(priceEntries.userId, userId));
    expect(savedEntries).toHaveLength(1);
  });

  test('should reject a session belonging to another user', async () => {
    await db.insert(shoppingSessions).values({ id: SESSION_ID, userId: otherUserId });

    await expect(confirmShoppingSession(db, userId, input())).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  test('should reject a discarded session', async () => {
    await db.insert(shoppingSessions).values({ id: SESSION_ID, userId, status: 'discarded' });

    await expect(confirmShoppingSession(db, userId, input())).rejects.toBeInstanceOf(
      SessionClosedError,
    );
  });

  test('should reject an existing product id owned by another user', async () => {
    const [foreignProduct] = await db
      .insert(products)
      .values({
        userId: otherUserId,
        name: 'Passata di pomodoro',
        brand: 'Mutti',
        category: 'food',
        unitKind: 'weight',
      })
      .returning();

    await expect(
      confirmShoppingSession(
        db,
        userId,
        input({
          entries: [entry({ product: { kind: 'existing', productId: foreignProduct.id } })],
        }),
      ),
    ).rejects.toBeInstanceOf(ProductNotFoundError);

    const savedEntries = await db
      .select()
      .from(priceEntries)
      .where(eq(priceEntries.userId, userId));
    expect(savedEntries).toHaveLength(0);
  });
});
