import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { products } from '@/lib/db/schema/app';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { ValidationError } from '@/lib/errors';
import {
  createPriceEntries,
  createPriceEntry,
  listEntriesForIndex,
  listPriceEntries,
} from './price-entries';

describe('price-entries repository', () => {
  let db: Db;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    userId = (await createTestUser(db)).id;
    otherUserId = (await createTestUser(db)).id;
  });

  async function createProductRow(
    owner: string,
    overrides: Partial<typeof products.$inferInsert> = {},
  ) {
    const [product] = await db
      .insert(products)
      .values({
        userId: owner,
        name: 'Test product',
        category: 'food',
        unitKind: 'weight',
        ...overrides,
      })
      .returning();
    return product;
  }

  it('should reject deleting a product that has entries', async () => {
    const product = await createProductRow(userId);
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date(),
      totalPriceCents: 129,
      packageSize: 0.5,
      unitPriceMilli: 2580,
      source: 'manual',
    });

    await expect(db.delete(products).where(eq(products.id, product.id))).rejects.toBeDefined();
  });

  it('should insert a batch atomically', async () => {
    const product = await createProductRow(userId);

    await expect(
      createPriceEntries(db, userId, [
        {
          productId: product.id,
          recordedAt: new Date(),
          totalPriceCents: 129,
          packageSize: 0.5,
          unitPriceMilli: 2580,
          source: 'manual',
        },
        {
          productId: 'missing-product-id',
          recordedAt: new Date(),
          totalPriceCents: 139,
          packageSize: 0.5,
          unitPriceMilli: 2780,
          source: 'manual',
        },
      ]),
    ).rejects.toBeDefined();

    const page = await listPriceEntries(db, userId);
    expect(page.entries).toHaveLength(0);
  });

  it('should paginate newest-first without duplicates or gaps', async () => {
    const product = await createProductRow(userId);
    const baseTime = Date.parse('2026-01-01T10:00:00Z');
    for (let i = 0; i < 25; i++) {
      await createPriceEntry(db, userId, {
        productId: product.id,
        recordedAt: new Date(baseTime + i * 60_000),
        totalPriceCents: 100 + i,
        packageSize: 0.5,
        unitPriceMilli: 2000 + i,
        source: 'manual',
      });
    }

    const page1 = await listPriceEntries(db, userId, { limit: 10 });
    expect(page1.entries).toHaveLength(10);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listPriceEntries(db, userId, {
      limit: 10,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.entries).toHaveLength(10);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await listPriceEntries(db, userId, {
      limit: 10,
      cursor: page2.nextCursor ?? undefined,
    });
    expect(page3.entries).toHaveLength(5);
    expect(page3.nextCursor).toBeNull();

    const allIds = [...page1.entries, ...page2.entries, ...page3.entries].map((e) => e.id);
    expect(new Set(allIds).size).toBe(25);

    // Newest-first: page1's first entry has the latest recordedAt.
    const oldestEntry = page3.entries.at(-1);
    expect(oldestEntry).toBeDefined();
    expect(page1.entries[0].recordedAt.getTime()).toBeGreaterThan(
      oldestEntry?.recordedAt.getTime() ?? 0,
    );
  });

  it('should keep cursors stable across ties on recorded_at', async () => {
    const product = await createProductRow(userId);
    const sharedTime = new Date('2026-02-01T10:00:00Z');
    for (let i = 0; i < 15; i++) {
      await createPriceEntry(db, userId, {
        productId: product.id,
        recordedAt: sharedTime,
        totalPriceCents: 100 + i,
        packageSize: 0.5,
        unitPriceMilli: 2000 + i,
        source: 'manual',
      });
    }

    const page1 = await listPriceEntries(db, userId, { limit: 10 });
    const page2 = await listPriceEntries(db, userId, {
      limit: 10,
      cursor: page1.nextCursor ?? undefined,
    });

    const allIds = [...page1.entries, ...page2.entries].map((e) => e.id);
    expect(new Set(allIds).size).toBe(15);
    expect(page1.entries).toHaveLength(10);
    expect(page2.entries).toHaveLength(5);
  });

  it('should keep an open cursor valid when new entries arrive', async () => {
    const product = await createProductRow(userId);
    const baseTime = Date.parse('2026-03-01T10:00:00Z');
    for (let i = 0; i < 10; i++) {
      await createPriceEntry(db, userId, {
        productId: product.id,
        recordedAt: new Date(baseTime + i * 60_000),
        totalPriceCents: 100 + i,
        packageSize: 0.5,
        unitPriceMilli: 2000 + i,
        source: 'manual',
      });
    }

    const page1 = await listPriceEntries(db, userId, { limit: 5 });
    const page2Before = await listPriceEntries(db, userId, {
      limit: 5,
      cursor: page1.nextCursor ?? undefined,
    });

    // Insert a newer entry between page 1 and page 2.
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date(baseTime + 100 * 60_000),
      totalPriceCents: 999,
      packageSize: 0.5,
      unitPriceMilli: 9999,
      source: 'manual',
    });

    const page2After = await listPriceEntries(db, userId, {
      limit: 5,
      cursor: page1.nextCursor ?? undefined,
    });

    expect(page2After.entries.map((e) => e.id)).toEqual(page2Before.entries.map((e) => e.id));
  });

  it('should throw ValidationError on a malformed cursor', async () => {
    await expect(listPriceEntries(db, userId, { cursor: 'not-a-valid-cursor!!!' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('should filter by product, store, category, and date range', async () => {
    const foodProduct = await createProductRow(userId, { name: 'Pasta', category: 'food' });
    const householdProduct = await createProductRow(userId, {
      name: 'Detersivo',
      category: 'household',
    });

    const foodEntry = await createPriceEntry(db, userId, {
      productId: foodProduct.id,
      recordedAt: new Date('2026-01-15T10:00:00Z'),
      totalPriceCents: 129,
      packageSize: 0.5,
      unitPriceMilli: 2580,
      source: 'manual',
    });
    const householdEntry = await createPriceEntry(db, userId, {
      productId: householdProduct.id,
      recordedAt: new Date('2026-02-15T10:00:00Z'),
      totalPriceCents: 210,
      packageSize: 0.9,
      unitPriceMilli: 2333,
      source: 'manual',
    });

    const byProduct = await listPriceEntries(db, userId, { productId: foodProduct.id });
    expect(byProduct.entries.map((e) => e.id)).toEqual([foodEntry.id]);

    const byCategory = await listPriceEntries(db, userId, { category: 'household' });
    expect(byCategory.entries.map((e) => e.id)).toEqual([householdEntry.id]);

    const byDateRange = await listPriceEntries(db, userId, {
      recordedFrom: new Date('2026-02-01T00:00:00Z'),
      recordedTo: new Date('2026-02-28T23:59:59Z'),
    });
    expect(byDateRange.entries.map((e) => e.id)).toEqual([householdEntry.id]);
  });

  it("should never return another user's entries", async () => {
    const ownProduct = await createProductRow(userId);
    const otherProduct = await createProductRow(otherUserId);
    const ownEntry = await createPriceEntry(db, userId, {
      productId: ownProduct.id,
      recordedAt: new Date(),
      totalPriceCents: 129,
      packageSize: 0.5,
      unitPriceMilli: 2580,
      source: 'manual',
    });
    await createPriceEntry(db, otherUserId, {
      productId: otherProduct.id,
      recordedAt: new Date(),
      totalPriceCents: 999,
      packageSize: 1,
      unitPriceMilli: 9990,
      source: 'manual',
    });

    const byCategory = await listPriceEntries(db, userId, { category: 'food' });
    expect(byCategory.entries.map((e) => e.id)).toEqual([ownEntry.id]);

    const plain = await listPriceEntries(db, userId);
    expect(plain.entries.map((e) => e.id)).toEqual([ownEntry.id]);
  });

  it('should return the minimal ascending projection for the index', async () => {
    const ownProduct = await createProductRow(userId, { category: 'beverages' });
    const otherProduct = await createProductRow(otherUserId);
    await createPriceEntry(db, userId, {
      productId: ownProduct.id,
      recordedAt: new Date('2026-01-05T10:00:00Z'),
      totalPriceCents: 129,
      packageSize: 0.5,
      unitPriceMilli: 2580,
      source: 'manual',
    });
    await createPriceEntry(db, userId, {
      productId: ownProduct.id,
      recordedAt: new Date('2026-02-05T10:00:00Z'),
      totalPriceCents: 139,
      packageSize: 0.5,
      unitPriceMilli: 2780,
      isPromo: true,
      source: 'manual',
    });
    await createPriceEntry(db, otherUserId, {
      productId: otherProduct.id,
      recordedAt: new Date('2026-01-10T10:00:00Z'),
      totalPriceCents: 999,
      packageSize: 1,
      unitPriceMilli: 9990,
      source: 'manual',
    });

    const rows = await listEntriesForIndex(db, userId);

    expect(rows).toEqual([
      {
        productId: ownProduct.id,
        category: 'beverages',
        recordedAt: Date.parse('2026-01-05T10:00:00Z'),
        unitPriceMilli: 2580,
        totalPriceCents: 129,
        quantity: 1,
        isPromo: false,
      },
      {
        productId: ownProduct.id,
        category: 'beverages',
        recordedAt: Date.parse('2026-02-05T10:00:00Z'),
        unitPriceMilli: 2780,
        totalPriceCents: 139,
        quantity: 1,
        isPromo: true,
      },
    ]);
  });
});
