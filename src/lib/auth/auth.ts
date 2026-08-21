/**
 * Better Auth server configuration.
 *
 * Design: email + password only in v1 — no OAuth, no email verification
 * (there is no outbound email infrastructure). Registration is gated at
 * the auth layer by SIGNUP_ENABLED so a closed instance rejects signups
 * server-side, not just in the UI.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { nanoid } from 'nanoid';

import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { userSettings } from '@/lib/db/schema/app';
import { env } from '@/lib/env';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'sqlite',
    // Why: this project's naming convention mandates plural table names (users, sessions, ...).
    usePlural: true,
    schema,
  }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: !env.SIGNUP_ENABLED,
    minPasswordLength: 8,
  },

  user: {
    // "Elimina account" wipes everything. The credential account re-checks
    // the password on delete, and the DB cascades from users to every app
    // table, so one call removes all data.
    deleteUser: {
      enabled: true,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — personal app, long sessions are fine
    updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    cookieCache: {
      enabled: true,
      // Why: 5-minute signed-cookie cache turns most getSession calls into
      // a cookie read instead of a DB roundtrip (matters on every request).
      maxAge: 60 * 5,
    },
  },

  // Why: Better Auth's built-in rate limiter throttles repeated sign-in/
  // sign-up calls per IP. The Playwright global-setup logs in two fixed
  // seed users back-to-back on every run (plus a throwaway signup per test),
  // all from localhost — enough to trip a per-IP limiter meant for the
  // public internet, producing flaky 429s that have nothing to do with a
  // real bug. Disabled outside production; verify this still matches the
  // installed better-auth version's actual default before relying on it —
  // don't assume, check.
  rateLimit: {
    enabled: process.env.NODE_ENV === 'production',
  },

  advanced: {
    database: {
      // Why: this project mandates app-side nanoid(21) ids for ALL tables,
      // including the auth ones.
      generateId: () => nanoid(),
    },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Why: every user must have a settings row from the start so reads
          // never special-case its absence. onConflictDoNothing keeps the
          // hook idempotent if it ever re-fires.
          await db.insert(userSettings).values({ userId: user.id }).onConflictDoNothing();
        },
      },
    },
  },

  // Why: nextCookies must be the last plugin — it wraps the others so that
  // Set-Cookie headers work inside Server Actions.
  plugins: [nextCookies()],
});

/** The session user shape as inferred from the auth config. */
export type SessionUser = typeof auth.$Infer.Session.user;
