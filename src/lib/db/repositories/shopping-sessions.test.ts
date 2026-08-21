import { beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/lib/db/client';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import {
  createShoppingSession,
  getActiveShoppingSession,
  updateShoppingSession,
} from './shopping-sessions';

describe('shopping-sessions repository', () => {
  let db: Db;
  let userId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    userId = (await createTestUser(db)).id;
  });

  it('should create an active session and find it as the active one', async () => {
    const created = await createShoppingSession(db, userId);

    expect(created.status).toBe('active');

    const active = await getActiveShoppingSession(db, userId);
    expect(active?.id).toBe(created.id);
  });

  it('should not report completed or discarded sessions as active', async () => {
    const completed = await createShoppingSession(db, userId);
    await updateShoppingSession(db, userId, completed.id, {
      status: 'completed',
      completedAt: new Date(),
    });

    const discarded = await createShoppingSession(db, userId);
    await updateShoppingSession(db, userId, discarded.id, { status: 'discarded' });

    const active = await getActiveShoppingSession(db, userId);
    expect(active).toBeNull();
  });
});
