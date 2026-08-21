/**
 * Single source of truth for the two deterministic dev seed users.
 * Imported by scripts/seed.ts and by
 * tests/e2e/fixtures/users.ts — nothing else hardcodes these credentials,
 * so the two can never drift apart. Pure data, no I/O.
 */
export const SEED_USER = {
  email: 'dev@segnaprezzi.local',
  password: 'segnaprezzi-dev',
  name: 'Dev User',
};

/**
 * Second seed user, deliberately minimal — exists solely so the E2E suite
 * has two populated, non-overlapping accounts to assert cross-user
 * isolation between.
 */
export const SEED_USER_2 = {
  email: 'dev2@segnaprezzi.local',
  password: 'segnaprezzi-dev-2',
  name: 'Dev User 2',
};
