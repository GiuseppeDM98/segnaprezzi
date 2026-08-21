import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { listPriceEntries } from '@/lib/db/repositories/price-entries';
import { createProduct, listProducts } from '@/lib/db/repositories/products';
import { createStore, listStores } from '@/lib/db/repositories/stores';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { exportUserData } from './export';
import { getIndexSettings, importUserData, updateIndexSettings } from './settings';

/*
 * Integration tests for Settings: index options round-trip,
 * and the backup import — a merge by id that never wipes, rejects files that
 * are not a segnaprezzi export, and cannot touch another user's rows even
 * when the file names their ids.
 */

let db: Db;
let userId: string;
let otherUserId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
  ({ id: otherUserId } = await createTestUser(db));
});

describe('index settings', () => {
  it('should persist a partial change and return the full row', async () => {
    const updated = await updateIndexSettings(db, userId, { carryForwardMonths: 0 });

    expect(updated).toEqual({ includePromosInIndex: true, carryForwardMonths: 0 });
    expect(await getIndexSettings(db, userId)).toEqual(updated);
  });
});

describe('importUserData', () => {
  it('should reject a file that is not a segnaprezzi export', async () => {
    await expect(importUserData(db, userId, { hello: 'world' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('should round-trip an export: rows are merged by id, existing ones updated', async () => {
    const store = await createStore(db, userId, { name: 'Esselunga', kind: 'supermarket' });
    const product = await createProduct(db, userId, {
      name: 'Latte',
      category: 'food',
      unitKind: 'volume',
    });
    await importUserData(db, userId, {
      ...(await exportUserData(db, userId)),
      products: [
        {
          id: product.id,
          name: 'Latte intero',
          brand: 'Granarolo',
          category: 'food',
          unitKind: 'volume',
          notes: null,
          isArchived: false,
        },
      ],
      entries: [
        {
          id: 'entry0000000000000001',
          productId: product.id,
          storeId: store.id,
          sessionId: null,
          recordedAt: '2026-04-10T10:00:00.000Z',
          totalPriceCents: 179,
          packageSize: 1,
          unitPriceMilli: 1790,
          isPromo: false,
          promoKind: null,
          source: 'manual',
          currency: 'EUR',
          photoUrl: null,
          aiConfidence: null,
          aiModel: null,
          aiRawJson: null,
        },
      ],
    });

    const products = await listProducts(db, userId);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: 'Latte intero', brand: 'Granarolo' });
    const page = await listPriceEntries(db, userId);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({ id: 'entry0000000000000001', storeId: store.id });
    // Importing the same file again is idempotent.
    await importUserData(db, userId, await exportUserData(db, userId));
    expect((await listPriceEntries(db, userId)).entries).toHaveLength(1);
  });

  it("should never overwrite or link another user's rows", async () => {
    const foreignStore = await createStore(db, otherUserId, { name: 'Coop', kind: 'supermarket' });
    const foreignProduct = await createProduct(db, otherUserId, {
      name: 'Yogurt',
      category: 'food',
      unitKind: 'count',
    });
    const base = await exportUserData(db, userId);

    const result = await importUserData(db, userId, {
      ...base,
      stores: [{ id: foreignStore.id, name: 'Hijacked', chain: null, city: null, kind: 'other' }],
      products: [
        {
          id: foreignProduct.id,
          name: 'Hijacked',
          brand: null,
          category: 'other',
          unitKind: 'count',
          notes: null,
          isArchived: false,
        },
      ],
      entries: [
        {
          id: 'entry0000000000000002',
          productId: foreignProduct.id,
          storeId: foreignStore.id,
          sessionId: null,
          recordedAt: '2026-04-10T10:00:00.000Z',
          totalPriceCents: 179,
          packageSize: 1,
          unitPriceMilli: 1790,
          isPromo: false,
          promoKind: null,
          source: 'manual',
          currency: 'EUR',
          photoUrl: null,
          aiConfidence: null,
          aiModel: null,
          aiRawJson: null,
        },
      ],
    });

    expect(result.skippedEntries).toBe(1);
    expect(await listStores(db, userId)).toHaveLength(0);
    expect((await listStores(db, otherUserId))[0].name).toBe('Coop');
    expect((await listProducts(db, otherUserId))[0].name).toBe('Yogurt');
    expect((await listPriceEntries(db, userId)).entries).toHaveLength(0);
  });
});
