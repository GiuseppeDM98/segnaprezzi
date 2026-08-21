import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createPriceEntry, listPriceEntries } from '@/lib/db/repositories/price-entries';
import { createProduct } from '@/lib/db/repositories/products';
import { createStore } from '@/lib/db/repositories/stores';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { listCatalog, mergeProducts, searchProducts, setProductArchived } from './catalog';

/*
 * Integration tests for the catalog read model: the last and
 * previous observation per product, the category chips, user scoping, and
 * the merge flow over several duplicates.
 */

let db: Db;
let userId: string;
let otherUserId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
  ({ id: otherUserId } = await createTestUser(db));
});

async function addEntry(
  productId: string,
  owner: string,
  iso: string,
  unitPriceMilli: number,
  extra: Partial<Parameters<typeof createPriceEntry>[2]> = {},
) {
  return createPriceEntry(db, owner, {
    productId,
    recordedAt: new Date(iso),
    totalPriceCents: Math.round(unitPriceMilli / 10),
    packageSize: 1,
    unitPriceMilli,
    source: 'manual',
    ...extra,
  });
}

describe('listCatalog', () => {
  it('should attach the newest observation and the one before it to each product', async () => {
    const latte = await createProduct(db, userId, {
      name: 'Latte',
      category: 'food',
      unitKind: 'volume',
    });
    const pane = await createProduct(db, userId, {
      name: 'Pane',
      category: 'food',
      unitKind: 'weight',
    });
    await addEntry(latte.id, userId, '2026-03-05T10:00:00Z', 1690);
    await addEntry(latte.id, userId, '2026-04-05T10:00:00Z', 1750);
    await addEntry(latte.id, userId, '2026-05-05T10:00:00Z', 1790);
    await addEntry(pane.id, userId, '2026-05-06T10:00:00Z', 4580);

    const catalog = await listCatalog(db, userId);

    const latteRow = catalog.products.find((product) => product.id === latte.id);
    expect(latteRow?.last).toEqual({
      unitPriceMilli: 1790,
      recordedAt: Date.parse('2026-05-05T10:00:00Z'),
    });
    expect(latteRow?.previousUnitPriceMilli).toBe(1750);
    const paneRow = catalog.products.find((product) => product.id === pane.id);
    expect(paneRow?.last?.unitPriceMilli).toBe(4580);
    expect(paneRow?.previousUnitPriceMilli).toBeNull();
  });

  it('should leave a product without entries priceless and list only categories with data', async () => {
    await createProduct(db, userId, {
      name: 'Shampoo',
      category: 'personal-care',
      unitKind: 'volume',
    });
    const other = await createProduct(db, otherUserId, {
      name: 'Diesel',
      category: 'fuel',
      unitKind: 'volume',
    });
    await addEntry(other.id, otherUserId, '2026-05-06T10:00:00Z', 1799);

    const catalog = await listCatalog(db, userId);

    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0].last).toBeNull();
    expect(catalog.categoriesWithData).toEqual(['personal-care']);
  });

  it('should hide archived products unless asked', async () => {
    const product = await createProduct(db, userId, {
      name: 'Old',
      category: 'other',
      unitKind: 'count',
    });
    await setProductArchived(db, userId, product.id, true);

    expect((await listCatalog(db, userId)).products).toHaveLength(0);
    expect((await listCatalog(db, userId, { includeArchived: true })).products).toHaveLength(1);
  });
});

describe('mergeProducts', () => {
  it('should move every entry onto the survivor and archive the duplicates', async () => {
    const survivor = await createProduct(db, userId, {
      name: 'Latte',
      category: 'food',
      unitKind: 'volume',
    });
    const dupA = await createProduct(db, userId, {
      name: 'Latte UHT',
      category: 'food',
      unitKind: 'volume',
    });
    const dupB = await createProduct(db, userId, {
      name: 'latte intero',
      category: 'food',
      unitKind: 'volume',
    });
    await addEntry(dupA.id, userId, '2026-03-05T10:00:00Z', 1690);
    await addEntry(dupB.id, userId, '2026-04-05T10:00:00Z', 1750);
    await addEntry(dupB.id, userId, '2026-04-18T10:00:00Z', 1750);

    const result = await mergeProducts(db, userId, {
      survivorId: survivor.id,
      mergedIds: [dupA.id, dupB.id, survivor.id],
    });

    expect(result.movedEntriesCount).toBe(3);
    const page = await listPriceEntries(db, userId, { productId: survivor.id });
    expect(page.entries).toHaveLength(3);
    const catalog = await listCatalog(db, userId, { includeArchived: true });
    expect(
      catalog.products
        .filter((product) => product.isArchived)
        .map((p) => p.id)
        .sort(),
    ).toEqual([dupA.id, dupB.id].sort());
  });

  it("should refuse a survivor that is not the user's", async () => {
    const foreign = await createProduct(db, otherUserId, {
      name: 'X',
      category: 'other',
      unitKind: 'count',
    });
    const own = await createProduct(db, userId, {
      name: 'Y',
      category: 'other',
      unitKind: 'count',
    });

    await expect(
      mergeProducts(db, userId, { survivorId: foreign.id, mergedIds: [own.id] }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });
});

describe('searchProducts', () => {
  it('should match name and brand case-insensitively within the user catalog', async () => {
    await createProduct(db, userId, {
      name: 'Passata',
      brand: 'Mutti',
      category: 'food',
      unitKind: 'weight',
    });
    await createProduct(db, userId, {
      name: 'Olio',
      brand: 'Monini',
      category: 'food',
      unitKind: 'volume',
    });
    await createProduct(db, otherUserId, {
      name: 'Passata',
      brand: 'Cirio',
      category: 'food',
      unitKind: 'weight',
    });
    const store = await createStore(db, userId, { name: 'Esselunga', kind: 'supermarket' });
    expect(store.id).toBeTruthy();

    const hits = await searchProducts(db, userId, 'MUTTI');

    expect(hits.map((hit) => hit.brand)).toEqual(['Mutti']);
  });
});
