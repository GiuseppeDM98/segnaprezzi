import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createPriceEntry } from '@/lib/db/repositories/price-entries';
import { createProduct } from '@/lib/db/repositories/products';
import { createStore } from '@/lib/db/repositories/stores';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { getDashboardData } from './dashboard';

/*
 * Integration tests for the dashboard read model: the states
 * (empty, thin, ready), the headline fallback from YoY to since-start,
 * the ISTAT overlay rebased onto the user's base month, and the honesty of
 * the coverage line and of categories with nothing measured.
 */

let db: Db;
let userId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
});

async function addMonthlyEntries(productId: string, months: string[], prices: number[]) {
  for (const [index, ym] of months.entries()) {
    await createPriceEntry(db, userId, {
      productId,
      recordedAt: new Date(`${ym}-10T10:00:00Z`),
      totalPriceCents: Math.round(prices[index] / 10),
      packageSize: 1,
      unitPriceMilli: prices[index],
      source: 'manual',
    });
  }
}

describe('getDashboardData', () => {
  it('should report the empty state for a user with no entries', async () => {
    expect(await getDashboardData(db, userId)).toEqual({ state: 'empty' });
  });

  it('should report the thin state with honest counts while only one month exists', async () => {
    const product = await createProduct(db, userId, {
      name: 'Pane',
      category: 'food',
      unitKind: 'weight',
    });
    await addMonthlyEntries(product.id, ['2026-04'], [4580]);
    await createPriceEntry(db, userId, {
      productId: product.id,
      recordedAt: new Date('2026-04-20T10:00:00Z'),
      totalPriceCents: 229,
      packageSize: 0.5,
      unitPriceMilli: 4580,
      source: 'photo',
    });

    const data = await getDashboardData(db, userId);

    expect(data).toEqual({
      state: 'thin',
      entryCount: 2,
      productCount: 1,
      totalSpentCents: 458 + 229,
    });
  });

  it('should lead with since-start when fewer than thirteen months exist', async () => {
    const product = await createProduct(db, userId, {
      name: 'Latte',
      category: 'food',
      unitKind: 'volume',
    });
    await addMonthlyEntries(product.id, ['2026-03', '2026-04', '2026-05'], [1000, 1050, 1100]);

    const data = await getDashboardData(db, userId);

    expect(data.state).toBe('ready');
    if (data.state !== 'ready') {
      return;
    }
    expect(data.headline.kind).toBe('sinceStart');
    expect(data.headline.ratio).toBeCloseTo(0.1, 6);
    expect(data.headline.partnerRatio).toBeNull();
    expect(data.headline.baseMonth).toBe('2026-03');
    expect(data.trend.map((point) => point.month)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(data.categories).toEqual([{ category: 'food', ratio: expect.closeTo(0.1, 6) }]);
    // The overlay reads 100 at the user's base month, like the personal index.
    expect(data.istat?.[0]).toEqual({ month: '2026-03', value: 100 });
    expect(data.movers[0]).toMatchObject({ productId: product.id, sparkline: [1000, 1050, 1100] });
  });

  it('should lead with year-over-year once thirteen months exist and keep the trend to twelve', async () => {
    const product = await createProduct(db, userId, {
      name: 'Caffè',
      category: 'food',
      unitKind: 'weight',
    });
    const months = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 6 + index, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    const prices = months.map((_, index) => 10000 + index * 100);
    await addMonthlyEntries(product.id, months, prices);

    const data = await getDashboardData(db, userId);

    expect(data.state).toBe('ready');
    if (data.state !== 'ready') {
      return;
    }
    expect(data.headline.kind).toBe('yoy');
    // 11300 / 10100 − 1 over twelve months of compounding relatives.
    expect(data.headline.ratio).toBeCloseTo(11300 / 10100 - 1, 6);
    expect(data.headline.partnerRatio).toBeCloseTo(0.13, 6);
    expect(data.trend).toHaveLength(12);
  });

  it('should count the products with no price this month and not call their category flat', async () => {
    const pasta = await createProduct(db, userId, {
      name: 'Pasta',
      category: 'food',
      unitKind: 'weight',
    });
    const riso = await createProduct(db, userId, {
      name: 'Riso',
      category: 'food',
      unitKind: 'weight',
    });
    const gpl = await createProduct(db, userId, {
      name: 'GPL',
      category: 'fuel',
      unitKind: 'volume',
    });
    await addMonthlyEntries(pasta.id, ['2026-03'], [2000]);
    await addMonthlyEntries(riso.id, ['2026-03'], [3000]);
    await addMonthlyEntries(gpl.id, ['2026-03', '2026-04'], [1000, 1100]);

    const data = await getDashboardData(db, userId);

    expect(data.state).toBe('ready');
    if (data.state !== 'ready') {
      return;
    }
    expect(data.coverage).toEqual({
      productsCompared: 3,
      categoriesCovered: 2,
      productsWithoutLatestPrice: 2,
    });
    expect(data.categories).toEqual([
      { category: 'fuel', ratio: expect.closeTo(0.1, 6) },
      { category: 'food', ratio: null },
    ]);
  });

  it('should report a real zero when a price was read again and did not move', async () => {
    const pasta = await createProduct(db, userId, {
      name: 'Pasta',
      category: 'food',
      unitKind: 'weight',
    });
    await addMonthlyEntries(pasta.id, ['2026-03', '2026-04'], [2000, 2000]);

    const data = await getDashboardData(db, userId);

    expect(data.state === 'ready' && data.categories).toEqual([{ category: 'food', ratio: 0 }]);
  });

  it('should call a category not measured when its last comparison is outside the year', async () => {
    const caffe = await createProduct(db, userId, {
      name: 'Caffè',
      category: 'food',
      unitKind: 'weight',
    });
    const sapone = await createProduct(db, userId, {
      name: 'Sapone',
      category: 'household',
      unitKind: 'count',
    });
    const months = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 6 + index, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    await addMonthlyEntries(
      caffe.id,
      months,
      months.map((_, index) => 10000 + index * 100),
    );
    await addMonthlyEntries(sapone.id, months.slice(0, 2), [1000, 1100]);

    const data = await getDashboardData(db, userId);

    expect(data.state === 'ready' && data.headline.kind).toBe('yoy');
    expect(data.state === 'ready' && data.categories).toEqual([
      { category: 'food', ratio: expect.closeTo(11300 / 10100 - 1, 6) },
      { category: 'household', ratio: null },
    ]);
  });

  it('should draw a mover on the stores it compares and ignore a change of store', async () => {
    const coop = await createStore(db, userId, { name: 'Coop', kind: 'supermarket' });
    const esselunga = await createStore(db, userId, { name: 'Esselunga', kind: 'supermarket' });
    const banane = await createProduct(db, userId, {
      name: 'Banane',
      category: 'food',
      unitKind: 'weight',
    });
    const addEntry = (ym: string, storeId: string, unitPriceMilli: number) =>
      createPriceEntry(db, userId, {
        productId: banane.id,
        storeId,
        recordedAt: new Date(`${ym}-10T10:00:00Z`),
        totalPriceCents: Math.round(unitPriceMilli / 10),
        packageSize: 1,
        unitPriceMilli,
        source: 'manual',
      });
    await addEntry('2026-03', coop.id, 1000);
    await addEntry('2026-04', coop.id, 1100);
    await addEntry('2026-04', esselunga.id, 3000);

    const data = await getDashboardData(db, userId);

    expect(data.state).toBe('ready');
    if (data.state !== 'ready') {
      return;
    }
    expect(data.headline.ratio).toBeCloseTo(0.1, 6);
    expect(data.movers[0]).toMatchObject({ sparkline: [1000, 1100] });
    expect(data.movers[0].ratio).toBeCloseTo(0.1, 6);
  });
});
