import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createPriceEntry } from '@/lib/db/repositories/price-entries';
import { createProduct } from '@/lib/db/repositories/products';
import { upsertShoppingSessions } from '@/lib/db/repositories/shopping-sessions';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { exportUserData } from './export';

/*
 * Integration tests for the full export: it is a backup, so every aggregate
 * must come out whole, however many rows a page of the UI would show.
 */

let db: Db;
let userId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
});

describe('exportUserData', () => {
  it('should carry every shopping session, beyond any list page size', async () => {
    // Well past a 100-row page (the repositories cap paged reads there), oldest first.
    const sessionCount = 130;
    const start = Date.UTC(2026, 0, 1);
    const sessions = Array.from({ length: sessionCount }, (_, i) => ({
      id: `session-${String(i).padStart(3, '0')}`,
      storeId: null,
      status: 'completed' as const,
      startedAt: new Date(start + i * 60_000),
      completedAt: new Date(start + i * 60_000 + 30_000),
    }));
    await upsertShoppingSessions(db, userId, sessions);

    // An entry of the oldest session: the one a capped export would orphan.
    const product = await createProduct(db, userId, {
      name: 'Latte',
      category: 'food',
      unitKind: 'volume',
    });
    await createPriceEntry(db, userId, {
      productId: product.id,
      sessionId: sessions[0].id,
      recordedAt: sessions[0].startedAt,
      totalPriceCents: 129,
      packageSize: 1,
      unitPriceMilli: 1290,
      source: 'photo',
    });

    const payload = await exportUserData(db, userId);

    expect(payload.shoppingSessions).toHaveLength(sessionCount);
    const exportedSessionIds = new Set(payload.shoppingSessions.map((session) => session.id));
    expect(exportedSessionIds.has(sessions[0].id)).toBe(true);
    expect(payload.entries[0].sessionId).toBe(sessions[0].id);
  });
});
