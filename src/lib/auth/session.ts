import { headers } from 'next/headers';

import { UnauthorizedError } from '@/lib/errors';
import { auth, type SessionUser } from './auth';

/**
 * Read the current session user, or null when not authenticated.
 * Server-side only (Server Components, Server Actions, route handlers).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * Return the current session user or throw UnauthorizedError.
 * Use in every Server Action, route handler, and service entry point that
 * touches user data — this is the real auth check (middleware is only
 * an optimistic cookie-presence filter, see §5.6).
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthorizedError('No active session');
  }
  return user;
}
