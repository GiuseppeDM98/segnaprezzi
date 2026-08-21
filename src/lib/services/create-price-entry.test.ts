import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Db } from '@/lib/db/client';
import { priceEntries, products, stores } from '@/lib/db/schema/app';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import {
  InconsistentFuelPricesError,
  InvalidDateError,
  InvalidPriceError,
  InvalidSizeError,
  InvalidStoreKindError,
  StoreNotFoundError,
} from '@/lib/errors';
import { createFuelEntry, createPriceEntry } from './create-price-entry';

/*
 * Integration test for the shared write path of the manual and fuel forms,
 * against a real migrated database: what is under
 * test is which rows come out and which inputs are refused, and both are
 * decided partly by SQL (FK scoping) and partly by the service.
 */

let db: Db;
let userId: string;
let otherUserId: string;

const RECORDED_AT = Date.UTC(2026, 3, 15, 10, 30);

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
  ({ id: otherUserId } = await createTestUser(db));
});

function manualInput(overrides: Record<string, unknown> = {}) {
  return {
    product: {
      kind: 'new' as const,
      name: 'Passata di pomodoro 700g',
      brand: 'Mutti',
      category: 'food' as const,
      unitKind: 'weight' as const,
    },
    storeId: null,
    recordedAt: RECORDED_AT,
    totalPriceCents: 129,
    packageSize: 0.7,
    unitPriceMilli: 1843,
    isPromo: false,
    promoKind: null,
    source: 'manual' as const,
    ...overrides,
  };
}

describe('createPriceEntry', () => {
  test('should create the product and the entry with the given source', async () => {
    const { entryId, productId } = await createPriceEntry(db, userId, manualInput());

    const [entry] = await db.select().from(priceEntries).where(eq(priceEntries.id, entryId));
    expect(entry).toMatchObject({
      userId,
      productId,
      source: 'manual',
      totalPriceCents: 129,
      unitPriceMilli: 1843,
      sessionId: null,
      photoUrl: null,
      aiModel: null,
      currency: 'EUR',
    });
  });

  test('should reuse an existing product instead of creating a near-duplicate', async () => {
    await createPriceEntry(db, userId, manualInput());
    await createPriceEntry(db, userId, manualInput());

    const allProducts = await db.select().from(products).where(eq(products.userId, userId));
    expect(allProducts).toHaveLength(1);
  });

  test('should reject a date outside the accepted window', async () => {
    await expect(
      createPriceEntry(db, userId, manualInput({ recordedAt: Date.UTC(2019, 11, 31) })),
    ).rejects.toBeInstanceOf(InvalidDateError);
  });

  test('should reject a date further in the future than clock skew allows', async () => {
    await expect(
      createPriceEntry(db, userId, manualInput({ recordedAt: Date.now() + 60 * 60 * 1000 })),
    ).rejects.toBeInstanceOf(InvalidDateError);
  });

  test('should reject a price above the accepted range', async () => {
    await expect(
      createPriceEntry(db, userId, manualInput({ totalPriceCents: 1_000_001 })),
    ).rejects.toBeInstanceOf(InvalidPriceError);
  });

  test('should reject a package size above the accepted range', async () => {
    await expect(
      createPriceEntry(db, userId, manualInput({ packageSize: 10_001 })),
    ).rejects.toBeInstanceOf(InvalidSizeError);
  });

  test("should reject another user's store", async () => {
    const [foreignStore] = await db
      .insert(stores)
      .values({ userId: otherUserId, name: 'Coop Via Roma', kind: 'supermarket' })
      .returning();

    await expect(
      createPriceEntry(db, userId, manualInput({ storeId: foreignStore.id })),
    ).rejects.toBeInstanceOf(StoreNotFoundError);
  });
});

describe('createFuelEntry', () => {
  const fuelInput = {
    fuel: 'diesel' as const,
    storeId: null,
    recordedAt: RECORDED_AT,
    unitPriceMilli: 1799,
    quantity: 38.2,
    totalPriceCents: 6872,
  };

  test('should create the fuel product lazily and store the quantity as package size', async () => {
    const { entryId, productId } = await createFuelEntry(db, userId, fuelInput);

    const [product] = await db.select().from(products).where(eq(products.id, productId));
    expect(product).toMatchObject({
      name: 'Diesel',
      brand: null,
      category: 'fuel',
      unitKind: 'volume',
    });

    const [entry] = await db.select().from(priceEntries).where(eq(priceEntries.id, entryId));
    expect(entry).toMatchObject({
      source: 'fuel',
      packageSize: 38.2,
      unitPriceMilli: 1799,
      totalPriceCents: 6872,
      isPromo: false,
      sessionId: null,
    });
  });

  test('should reuse the fuel product on the next refuelling', async () => {
    await createFuelEntry(db, userId, fuelInput);
    await createFuelEntry(db, userId, fuelInput);

    const allProducts = await db.select().from(products).where(eq(products.userId, userId));
    expect(allProducts).toHaveLength(1);
  });

  test('should sell methane by the kilogram, not by the litre', async () => {
    const { productId, entryId } = await createFuelEntry(db, userId, {
      ...fuelInput,
      fuel: 'metano',
      unitPriceMilli: 1899,
      quantity: 15,
      totalPriceCents: 2849,
    });

    const [product] = await db.select().from(products).where(eq(products.id, productId));
    expect(product).toMatchObject({ name: 'Metano', category: 'fuel', unitKind: 'weight' });

    const [entry] = await db.select().from(priceEntries).where(eq(priceEntries.id, entryId));
    expect(entry).toMatchObject({ packageSize: 15, unitPriceMilli: 1899, totalPriceCents: 2849 });
  });

  test('should keep petrol on its canonical single-word name', async () => {
    const { productId } = await createFuelEntry(db, userId, { ...fuelInput, fuel: 'benzina' });

    const [product] = await db.select().from(products).where(eq(products.id, productId));
    expect(product).toMatchObject({ name: 'Benzina', unitKind: 'volume' });
  });

  test('should accept a triple that differs by pump rounding', async () => {
    // 1799 x 38.2 = 68_721.8 milli vs 6873 cents = 68_730 milli: 8.2 apart.
    await expect(
      createFuelEntry(db, userId, { ...fuelInput, totalPriceCents: 6873 }),
    ).resolves.toBeDefined();
  });

  test('should reject a triple that cannot all be true', async () => {
    await expect(
      createFuelEntry(db, userId, { ...fuelInput, totalPriceCents: 5000 }),
    ).rejects.toBeInstanceOf(InconsistentFuelPricesError);
  });

  test('should reject a store that is not a fuel station', async () => {
    const [supermarket] = await db
      .insert(stores)
      .values({ userId, name: 'Esselunga Papiniano', kind: 'supermarket' })
      .returning();

    await expect(
      createFuelEntry(db, userId, { ...fuelInput, storeId: supermarket.id }),
    ).rejects.toBeInstanceOf(InvalidStoreKindError);
  });

  test('should accept a fuel station of the user', async () => {
    const [station] = await db
      .insert(stores)
      .values({ userId, name: 'Eni Lorenteggio', kind: 'fuel_station' })
      .returning();

    const { entryId } = await createFuelEntry(db, userId, { ...fuelInput, storeId: station.id });

    const [entry] = await db.select().from(priceEntries).where(eq(priceEntries.id, entryId));
    expect(entry.storeId).toBe(station.id);
  });
});
