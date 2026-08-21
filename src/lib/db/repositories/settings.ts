/**
 * User settings repository (Spec 02 §6.6). Every function is scoped by
 * userId — see the security rule in §6.1: no cross-user read or write is
 * representable through this layer.
 */
import { eq } from 'drizzle-orm';

import type { Db, DbTransaction } from '@/lib/db/client';
import { type UserSettings, userSettings } from '@/lib/db/schema/app';

export type UpdateUserSettingsPatch = Partial<
  Pick<UserSettings, 'includePromosInIndex' | 'carryForwardMonths'>
>;

/**
 * Fetch the user's settings row. If it is missing (user predates the signup
 * hook, or was seeded directly), insert the defaults and return them — the
 * row's existence is a persistence invariant, so healing it here is
 * persistence logic, not a business rule.
 */
export async function getUserSettings(
  db: Db | DbTransaction,
  userId: string,
): Promise<UserSettings> {
  const [existing] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(userSettings)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) {
    return created;
  }

  // Why: a concurrent insert (e.g. the signup databaseHook) may have won the
  // race between our SELECT and INSERT — re-read instead of assuming failure.
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return row;
}

/** Apply a partial settings update and return the updated row. */
export async function updateUserSettings(
  db: Db | DbTransaction,
  userId: string,
  patch: UpdateUserSettingsPatch,
): Promise<UserSettings> {
  await getUserSettings(db, userId);

  const [updated] = await db
    .update(userSettings)
    .set(patch)
    .where(eq(userSettings.userId, userId))
    .returning();
  return updated;
}
