/**
 * Test builders for the engine. Not exported by the barrel and
 * never imported by production code.
 *
 * Fixture timestamps are at 10:00 UTC, so the Rome month equals the UTC
 * month and a test can reason about 'YYYY-MM' keys directly.
 */
import type { IndexEntry, IndexProduct, IndexSettings } from './types';

export const DEFAULT_SETTINGS: IndexSettings = {
  includePromosInIndex: true,
  carryForwardMonths: 2,
};

/** Epoch ms of `YYYY-MM-DD` at 10:00 UTC — safely inside the same Rome day and month. */
export function atTenUtc(isoDate: string): number {
  return Date.parse(`${isoDate}T10:00:00Z`);
}

/** Epoch ms of the 15th of `ym` at 10:00 UTC — the month's middle, far from both DST and month edges. */
export function midMonth(ym: string): number {
  return atTenUtc(`${ym}-15`);
}

export function buildEntry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    productId: 'pasta',
    category: 'food',
    recordedAt: atTenUtc('2026-03-07'),
    totalPriceCents: 119,
    quantity: 1,
    unitPriceMilli: 2380,
    isPromo: false,
    ...overrides,
  };
}

export function buildProduct(overrides: Partial<IndexProduct> = {}): IndexProduct {
  return {
    id: 'pasta',
    name: 'Spaghetti n.5 500g',
    brand: 'Barilla',
    category: 'food',
    ...overrides,
  };
}

/**
 * The worked example used across the engine's tests, verbatim: three products, four months,
 * thirteen entries. Its numbers are the acceptance contract of the engine.
 */
export function buildWorkedExample(): { entries: IndexEntry[]; products: IndexProduct[] } {
  const products: IndexProduct[] = [
    buildProduct({ id: 'pasta', name: 'Spaghetti n.5 500g', brand: 'Barilla', category: 'food' }),
    buildProduct({ id: 'oil', name: 'Olio extravergine 1L', brand: null, category: 'food' }),
    buildProduct({ id: 'diesel', name: 'Diesel', brand: null, category: 'fuel' }),
  ];

  const pasta = (date: string, totalPriceCents: number, unitPriceMilli: number, isPromo = false) =>
    buildEntry({
      productId: 'pasta',
      category: 'food',
      recordedAt: atTenUtc(date),
      totalPriceCents,
      unitPriceMilli,
      isPromo,
    });
  const oil = (date: string, totalPriceCents: number, unitPriceMilli: number) =>
    buildEntry({
      productId: 'oil',
      category: 'food',
      recordedAt: atTenUtc(date),
      totalPriceCents,
      unitPriceMilli,
    });
  const diesel = (date: string, totalPriceCents: number, unitPriceMilli: number) =>
    buildEntry({
      productId: 'diesel',
      category: 'fuel',
      recordedAt: atTenUtc(date),
      totalPriceCents,
      unitPriceMilli,
    });

  const entries: IndexEntry[] = [
    pasta('2026-03-07', 119, 2380),
    pasta('2026-03-21', 109, 2180, true),
    pasta('2026-04-11', 125, 2500),
    pasta('2026-06-05', 129, 2580),
    oil('2026-03-14', 799, 7990),
    oil('2026-04-11', 849, 8490),
    oil('2026-05-09', 829, 8290),
    oil('2026-06-05', 819, 8190),
    diesel('2026-03-02', 5405, 1689),
    diesel('2026-03-19', 5097, 1699),
    diesel('2026-04-16', 5348, 1725),
    diesel('2026-05-14', 5772, 1749),
    diesel('2026-06-11', 5217, 1739),
  ];

  return { entries, products };
}

/**
 * mulberry32 — a tiny seeded PRNG, enough to make the property test and the
 * shuffle test reproducible without a dependency. Returns floats in [0, 1).
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a seeded PRNG; returns a new array. */
export function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
