import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { createTestDb } from '@/lib/db/testing/create-test-db';

describe('auth config', () => {
  it('should reject signup when disableSignUp is true', async () => {
    const { db } = await createTestDb();
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'test-secret-at-least-32-characters-long',
      database: drizzleAdapter(db, { provider: 'sqlite', usePlural: true, schema }),
      emailAndPassword: { enabled: true, disableSignUp: true },
    });

    await expect(
      auth.api.signUpEmail({
        body: { email: 'blocked@segnaprezzi.local', password: 'blocked-pass', name: 'Blocked' },
      }),
    ).rejects.toBeDefined();
  });
});
