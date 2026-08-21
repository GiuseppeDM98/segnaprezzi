import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createPriceEntry } from '@/lib/db/repositories/price-entries';
import { createProduct } from '@/lib/db/repositories/products';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { getDashboardData } from './dashboard';

/*
 * Integration tests for the dashboard read model: the three
 * states (empty, thin, ready), the headline fallback from YoY to since-start,
 * and the ISTAT overlay rebased onto the user's base month.
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
});
