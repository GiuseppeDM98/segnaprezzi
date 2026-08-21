import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { NotFoundError } from '@/lib/errors';
import { createPriceEntry } from './price-entries';
import {
  createProduct,
  getProductById,
  listProducts,
  listProductsForIndex,
  mergeProducts,
} from './products';

describe('products repository', () => {
  let db: Db;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    userId = (await createTestUser(db)).id;
    otherUserId = (await createTestUser(db)).id;
  });

  it('should exclude archived products unless includeArchived is set', async () => {
    const active = await createProduct(db, userId, {
      name: 'Spaghetti',
      category: 'food',
      unitKind: 'weight',
    });
    const archived = await createProduct(db, userId, {
      name: 'Discontinued Pasta',
      category: 'food',
      unitKind: 'weight',
      isArchived: true,
    });

    const defaultList = await listProducts(db, userId);
    expect(defaultList.map((p) => p.id)).toEqual([active.id]);

    const fullList = await listProducts(db, userId, { includeArchived: true });
    expect(fullList.map((p) => p.id).sort()).toEqual([active.id, archived.id].sort());
  });

  it('should filter products by category and case-insensitive search', async () => {
    await createProduct(db, userId, {
      name: 'Spaghetti n.5',
      brand: 'Barilla',
      category: 'food',
      unitKind: 'weight',
    });
    await createProduct(db, userId, {
      name: 'Shampoo antiforfora',
      brand: 'H&S',
      category: 'personal-care',
      unitKind: 'volume',
    });
    await createProduct(db, userId, {
      name: 'Pane casereccio',
      category: 'food',
      unitKind: 'weight',
    });

    const byCategory = await listProducts(db, userId, { category: 'food' });
    expect(byCategory.map((p) => p.name).sort()).toEqual(['Pane casereccio', 'Spaghetti n.5']);

    const bySearch = await listProducts(db, userId, { search: 'barilla' });
    expect(bySearch.map((p) => p.name)).toEqual(['Spaghetti n.5']);

    const bySearchName = await listProducts(db, userId, { search: 'SPAGHETTI' });
    expect(bySearchName.map((p) => p.name)).toEqual(['Spaghetti n.5']);
  });

  it('should move all entries to the target when merging products', async () => {
    const source = await createProduct(db, userId, {
      name: 'Source Pasta',
      category: 'food',
      unitKind: 'weight',
    });
    const target = await createProduct(db, userId, {
      name: 'Target Pasta',
      category: 'food',
      unitKind: 'weight',
    });
    await createPriceEntry(db, userId, {
      productId: source.id,
      recordedAt: new Date(),
      totalPriceCents: 129,
      packageSize: 0.5,
      unitPriceMilli: 2580,
      source: 'manual',
    });
    await createPriceEntry(db, userId, {
      productId: source.id,
      recordedAt: new Date(),
      totalPriceCents: 139,
      packageSize: 0.5,
      unitPriceMilli: 2780,
      source: 'manual',
    });

    const result = await mergeProducts(db, userId, source.id, target.id);

    expect(result.movedEntriesCount).toBe(2);
  });

  it('should archive the source product after a merge', async () => {
    const source = await createProduct(db, userId, {
      name: 'Source Pasta',
      category: 'food',
      unitKind: 'weight',
    });
    const target = await createProduct(db, userId, {
      name: 'Target Pasta',
      category: 'food',
      unitKind: 'weight',
    });

    await mergeProducts(db, userId, source.id, target.id);

    const reloadedSource = await getProductById(db, userId, source.id);
    const reloadedTarget = await getProductById(db, userId, target.id);
    expect(reloadedSource?.isArchived).toBe(true);
    expect(reloadedTarget?.isArchived).toBe(false);
  });

  it('should roll back the merge when the target does not exist', async () => {
    const source = await createProduct(db, userId, {
      name: 'Source Pasta',
      category: 'food',
      unitKind: 'weight',
    });
    await createPriceEntry(db, userId, {
      productId: source.id,
      recordedAt: new Date(),
      totalPriceCents: 129,
      packageSize: 0.5,
      unitPriceMilli: 2580,
      source: 'manual',
    });

    await expect(mergeProducts(db, userId, source.id, 'missing-product-id')).rejects.toThrow(
      NotFoundError,
    );

    const reloadedSource = await getProductById(db, userId, source.id);
    expect(reloadedSource?.isArchived).toBe(false);
  });

  it('should refuse to merge products across users', async () => {
    const source = await createProduct(db, userId, {
      name: 'Source Pasta',
      category: 'food',
      unitKind: 'weight',
    });
    const target = await createProduct(db, otherUserId, {
      name: 'Other Pasta',
      category: 'food',
      unitKind: 'weight',
    });

    await expect(mergeProducts(db, userId, source.id, target.id)).rejects.toThrow(NotFoundError);

    const reloadedSource = await getProductById(db, userId, source.id);
    expect(reloadedSource?.isArchived).toBe(false);
  });

  it('should refuse a self-merge', async () => {
    const product = await createProduct(db, userId, {
      name: 'Solo Pasta',
      category: 'food',
      unitKind: 'weight',
    });

    await expect(mergeProducts(db, userId, product.id, product.id)).rejects.toThrow(NotFoundError);
  });

  it('should return the minimal index projection for every product, archived included', async () => {
    // Arrange: an active and an archived product of the user, one of another user.
    const active = await createProduct(db, userId, {
      name: 'Spaghetti',
      brand: 'Barilla',
      category: 'food',
      unitKind: 'weight',
    });
    const archived = await createProduct(db, userId, {
      name: 'Old diesel',
      category: 'fuel',
      unitKind: 'volume',
      isArchived: true,
    });
    await createProduct(db, otherUserId, {
      name: 'Not mine',
      category: 'food',
      unitKind: 'weight',
    });

    // Act
    const projection = await listProductsForIndex(db, userId);

    // Assert: exact field set, own products only, ordered by id.
    const expected = [
      { id: active.id, name: 'Spaghetti', brand: 'Barilla', category: 'food' },
      { id: archived.id, name: 'Old diesel', brand: null, category: 'fuel' },
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(projection).toEqual(expected);
  });
});
