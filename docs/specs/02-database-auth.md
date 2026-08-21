# Spec 02 — Database & Auth

> **Status**: Approved · **Depends on**: Spec 01 (Foundation & Scaffold)
> Implements the persistence and identity layer defined in
> [Spec 00 §5–§6](./00-overview.md). All table, column, enum, and env-var names
> here are copied from Spec 00 and MUST NOT drift.

---

## 1. Goal & Scope

After this spec is implemented, the app has:

1. A working Turso/libSQL database (local `file:local.db` in dev, remote Turso in prod) wired through Drizzle ORM.
2. The complete app schema — `user_settings`, `stores`, `products`, `shopping_sessions`, `price_entries` — plus the Better Auth tables (`users`, `sessions`, `accounts`, `verifications`), migrated via committed SQL migrations.
3. Better Auth 1.7.x email + password auth: signup (gated by `SIGNUP_ENABLED`), login, logout, session cookies, and a `user_settings` row created automatically for every new user.
4. Route protection composed with the next-intl middleware from Spec 01, plus a `requireUser()` server helper.
5. A full repository layer in `src/lib/db/repositories/` — every query scoped to `user_id`.
6. A deterministic dev seed (`scripts/seed.ts`) so Specs 04 and 05 have realistic data to build against.
7. `GET /api/export` returning the authenticated user's full dataset as JSON.
8. Integration tests for every repository against an in-memory libSQL database.

**In scope but intentionally minimal**: unstyled but functional `/login` and `/signup` pages (email, password, submit, error text) so the auth flow is testable end-to-end. Spec 05 replaces their UI entirely; do not invest in styling here.

**Out of scope**: photo capture and AI extraction (Spec 03), index math (Spec 04), all real UI (Spec 05), offline sync (Spec 06).

New runtime dependencies introduced by this spec: `drizzle-orm`, `@libsql/client`, `better-auth`, `nanoid`. New dev dependencies: `drizzle-kit`, `dotenv`, `tsx` (if Spec 01 did not already add it).

---

## 2. Turso Setup

### 2.1 CLI install & database creation

```bash
# macOS / Linux
curl -sSfL get.tur.so/install.sh | bash
# or: brew install tursodatabase/tap/turso

# Windows (PowerShell)
irm get.tur.so/install.ps1 | iex
```

```bash
turso auth signup            # or: turso auth login
turso db create segnaprezzi

turso db show segnaprezzi --url        # → libsql://segnaprezzi-<org>.turso.io
turso db tokens create segnaprezzi     # → auth token for the app
```

Put the two values into the **production** environment (Vercel → Project → Environment Variables):

| Variable | Production value |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://segnaprezzi-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | output of `turso db tokens create segnaprezzi` |

### 2.2 Local development

Local dev never talks to Turso. `.env.local`:

```bash
TURSO_DATABASE_URL="file:local.db"
TURSO_AUTH_TOKEN=""
```

`local.db*` must be in `.gitignore` (the glob also covers libSQL journal/WAL side files). Verify Spec 01 added it; add it if missing.

### 2.3 How this plugs into `src/lib/env.ts` (Spec 01)

Spec 01's `src/lib/env.ts` validates the environment with Zod at boot and exports a typed `env` object. This spec consumes:

- `env.TURSO_DATABASE_URL` — non-empty string (required).
- `env.TURSO_AUTH_TOKEN` — optional string; empty string is valid (local file DB).
- `env.BETTER_AUTH_SECRET`, `env.BETTER_AUTH_URL` — required strings.
- `env.SIGNUP_ENABLED` — boolean, default `true` (parsed from the string env var; `"false"` → `false`).

If Spec 01's implementation is missing any of these fields, add them there (that file owns env validation) — do not read `process.env` directly anywhere under `src/`. The only files allowed to touch `process.env` are `drizzle.config.ts` and `scripts/*` because they run outside the Next.js runtime (see §3.1 and §8).

---

## 3. Drizzle Wiring

### 3.1 `drizzle.config.ts` (repo root)

```ts
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Why: drizzle-kit runs outside Next.js, which is what normally loads
// .env.local — so we load it ourselves. Missing file is fine (CI/prod
// pass real env vars).
config({ path: '.env.local' });

export default defineConfig({
  // SQLite dialect via the Turso/libSQL driver: works for both the local
  // file database and remote Turso.
  dialect: 'turso',
  // Why: explicit file list instead of a glob — the schema barrel
  // (index.ts) re-exports both files and a glob would pick it up too.
  schema: ['./src/lib/db/schema/auth.ts', './src/lib/db/schema/app.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? 'file:local.db',
    // Why: @libsql/client rejects an empty-string token; normalize to undefined.
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
});
```

### 3.2 `src/lib/db/client.ts`

```ts
/**
 * libSQL client + Drizzle instance, shared by the whole server side.
 *
 * Design: a module-level singleton cached on globalThis. Next.js dev HMR
 * re-evaluates modules on every edit; without the cache each reload would
 * leak a libSQL connection. In production the module is evaluated once,
 * so the cache is a no-op.
 */
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

import { env } from '@/lib/env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { libsqlClient?: Client };

const client =
  globalForDb.libsqlClient ??
  createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN || undefined,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.libsqlClient = client;
}

export const db = drizzle(client, { schema });

/** The concrete Drizzle database type; repositories accept it as their first parameter. */
export type Db = typeof db;
```

### 3.3 `src/lib/db/schema/index.ts`

```ts
export * from './auth';
export * from './app';
```

---

## 4. Domain Constants & App Schema

### 4.1 Pure domain files (`src/lib/domain/`)

These files are pure TypeScript — no imports from `db/`, `next/`, or any I/O. They are the single source of truth for every text enum stored in the database, and for the integer money math shared across layers.

**`src/lib/domain/categories.ts`**

```ts
/**
 * Category taxonomy for products (Spec 00 §6). Code-defined — there is no
 * categories table; the DB stores the id string, the UI localizes labels
 * via next-intl message keys `categories.<id>`.
 */

// WARNING: adding or renaming a category also requires updating:
// - messages/it.json and messages/en.json (keys under "categories")
// - the AI extraction prompt in src/lib/ai/ (Spec 03)
// - the ISTAT comparison mapping, if category-level comparison exists (Spec 04+)
export const CATEGORY_IDS = [
  'food',
  'beverages',
  'household',
  'personal-care',
  'health',
  'clothing',
  'fuel',
  'transport',
  'utilities',
  'recreation',
  'pets',
  'other',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Report whether an arbitrary string is a known category id. */
export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}
```

**`src/lib/domain/units.ts`**

```ts
/**
 * Unit kinds and their base units (Spec 00 §6). All unit prices are stored
 * per base unit: kg for weight, L for volume, piece for count. Tags shown
 * per 100 g / 100 mL are normalized at extraction time (Spec 03).
 */
export const UNIT_KINDS = ['weight', 'volume', 'count'] as const;

export type UnitKind = (typeof UNIT_KINDS)[number];

/** Display symbol of the base unit for each unit kind (used in "€/kg" style labels). */
export const BASE_UNIT_SYMBOLS: Record<UnitKind, 'kg' | 'L' | 'pz'> = {
  weight: 'kg',
  volume: 'L',
  count: 'pz',
};
```

(The `pz` symbol is the Italian display default; the EN locale renders `pc` via messages — display concerns stay in Spec 05.)

**`src/lib/domain/entries.ts`**

```ts
/**
 * Text enums stored on price_entries and shopping_sessions (Spec 00 §6).
 */
// Spec 07 appends 'receipt' (with price_entries.quantity / receipt_id and the
// receipts + product_aliases tables) in its own migration — Spec 00 §6 lists
// the full contract.
export const ENTRY_SOURCES = ['photo', 'manual', 'fuel'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const PROMO_KINDS = ['discount', 'loyalty', 'coupon', 'bundle'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const SESSION_STATUSES = ['active', 'reviewing', 'completed', 'discarded'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
```

**`src/lib/domain/stores.ts`** *(decision: Spec 00 defines the `kind` enum on `stores` but assigns it no file; it gets its own domain file, mirroring the one-concept-per-file pattern)*

```ts
/**
 * Store kinds (Spec 00 §6, stores.kind).
 */
export const STORE_KINDS = ['supermarket', 'fuel_station', 'other'] as const;
export type StoreKind = (typeof STORE_KINDS)[number];
```

**`src/lib/domain/money.ts`** *(decision: generic money math is a domain concern and lives here; fuel-specific helpers — `calculateFuelTotalCents`, `calculateFuelLiters` — arrive with Spec 03 §11.2, and ALL display formatting (`Intl.NumberFormat`) lives exclusively in `src/lib/format.ts`, Spec 05)*

```ts
/**
 * Integer money math (Spec 00 §3: money is integers only —
 * total_price_cents in euro cents, unit_price_milli in milli-euros per
 * base unit). Every helper returns an integer; floats exist only
 * transiently inside a computation, never in stored values.
 *
 * Scope: generic conversions only. Fuel-specific helpers arrive with
 * Spec 03 §11.2; display formatting lives exclusively in
 * src/lib/format.ts (Spec 05) — nothing here produces strings.
 */

/** Convert a euro amount (e.g. parsed user input 1.29) to integer cents. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

/** Convert a euro amount to integer milli-euros (1 € = 1000 milli). */
export function toMilli(euros: number): number {
  return Math.round(euros * 1000);
}

/** Convert integer cents to integer milli-euros (1 cent = 10 milli; exact, no rounding). */
export function centsToMilli(cents: number): number {
  return cents * 10;
}

/**
 * Derive the unit price (milli-euros per base unit) from a total price in
 * cents and a package size in base units (kg / L / pieces).
 * Why milli, not cents: small packages would round away precision —
 * €1.29 for 0.5 kg is exactly 2580 milli/kg.
 */
export function calculateUnitPriceMilli(totalPriceCents: number, packageSize: number): number {
  return Math.round(centsToMilli(totalPriceCents) / packageSize);
}
```

### 4.2 `src/lib/db/schema/app.ts` — complete code

```ts
/**
 * Application tables (Spec 00 §6). Auth tables live in ./auth.ts and are
 * generated by the Better Auth CLI — never hand-edit that file.
 *
 * Design decisions (project-wide, from Spec 00):
 * - IDs are text nanoid(21), generated app-side via $defaultFn.
 * - Timestamps are integer epoch milliseconds UTC ({ mode: 'timestamp_ms' }),
 *   surfaced as Date in TypeScript.
 * - Money is integers only: total_price_cents (euro cents) and
 *   unit_price_milli (milli-euros per base unit). Never floats.
 * - Text enums are plain text columns typed via $type<> unions from
 *   src/lib/domain/ — no SQLite CHECK constraints, validation happens with
 *   Zod at the boundary before data reaches a repository.
 * - FK actions: user delete cascades everywhere (full account wipe);
 *   product delete is restricted (history must never silently vanish —
 *   archive or merge instead); store/session deletes set the reference
 *   to NULL (entries outlive organizational metadata).
 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

import type { CategoryId } from '@/lib/domain/categories';
import type { EntrySource, PromoKind, SessionStatus } from '@/lib/domain/entries';
import type { StoreKind } from '@/lib/domain/stores';
import type { UnitKind } from '@/lib/domain/units';
import { users } from './auth';

// Shared column builders keep the five tables visually identical.
const idColumn = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => nanoid());

const userIdColumn = () =>
  text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

const createdAtColumn = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAtColumn = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

export const userSettings = sqliteTable('user_settings', {
  // Why: PK == FK — exactly one settings row per user, no surrogate id needed.
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  includePromosInIndex: integer('include_promos_in_index', { mode: 'boolean' })
    .notNull()
    .default(true),
  carryForwardMonths: integer('carry_forward_months').notNull().default(2),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const stores = sqliteTable(
  'stores',
  {
    id: idColumn(),
    userId: userIdColumn(),
    name: text('name').notNull(),
    chain: text('chain'),
    city: text('city'),
    kind: text('kind').$type<StoreKind>().notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index('stores_user_id_idx').on(table.userId)],
);

export const products = sqliteTable(
  'products',
  {
    id: idColumn(),
    userId: userIdColumn(),
    name: text('name').notNull(),
    brand: text('brand'),
    category: text('category').$type<CategoryId>().notNull(),
    unitKind: text('unit_kind').$type<UnitKind>().notNull(),
    notes: text('notes'),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index('products_user_id_idx').on(table.userId)],
);

export const shoppingSessions = sqliteTable(
  'shopping_sessions',
  {
    id: idColumn(),
    userId: userIdColumn(),
    storeId: text('store_id').references(() => stores.id, { onDelete: 'set null' }),
    status: text('status').$type<SessionStatus>().notNull().default('active'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index('shopping_sessions_user_id_idx').on(table.userId)],
);

export const priceEntries = sqliteTable(
  'price_entries',
  {
    id: idColumn(),
    userId: userIdColumn(),
    // Why: restrict, not cascade — deleting a product with history would
    // silently corrupt the index. The UI offers archive and merge instead.
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    storeId: text('store_id').references(() => stores.id, { onDelete: 'set null' }),
    sessionId: text('session_id').references(() => shoppingSessions.id, {
      onDelete: 'set null',
    }),
    recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
    totalPriceCents: integer('total_price_cents').notNull(),
    packageSize: real('package_size').notNull(),
    unitPriceMilli: integer('unit_price_milli').notNull(),
    isPromo: integer('is_promo', { mode: 'boolean' }).notNull().default(false),
    promoKind: text('promo_kind').$type<PromoKind>(),
    source: text('source').$type<EntrySource>().notNull(),
    currency: text('currency').notNull().default('EUR'),
    photoUrl: text('photo_url'),
    aiConfidence: real('ai_confidence'),
    aiModel: text('ai_model'),
    aiRawJson: text('ai_raw_json'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    // Powers per-product price history and monthly bucketing (Spec 04).
    index('price_entries_user_product_recorded_idx').on(
      table.userId,
      table.productId,
      table.recordedAt,
    ),
    // Powers the /history timeline and cursor pagination.
    index('price_entries_user_recorded_idx').on(table.userId, table.recordedAt),
  ],
);

// Inferred row types — the canonical TypeScript shapes used across layers.
export type UserSettings = typeof userSettings.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ShoppingSession = typeof shoppingSessions.$inferSelect;
export type NewShoppingSession = typeof shoppingSessions.$inferInsert;
export type PriceEntry = typeof priceEntries.$inferSelect;
export type NewPriceEntry = typeof priceEntries.$inferInsert;
```

---

## 5. Better Auth

Version: **better-auth 1.7.x** (keep the CLI's major.minor in lockstep with the installed package).

### 5.1 Generated auth schema — `src/lib/db/schema/auth.ts`

The four auth tables (`users`, `sessions`, `accounts`, `verifications`) are **generated, never hand-written**:

```bash
pnpm auth:generate
# package.json script (this row lives in the canonical scripts table, Spec 01 §4):
# "auth:generate": "pnpm dlx @better-auth/cli@^1.7.0 generate --yes"
```

Rules:

- Always invoke through `pnpm auth:generate` — never raw `npx`. The pinned `@better-auth/cli@^1.7.0` keeps the CLI's major.minor in lockstep with the installed package (see the version rule above). Verify the emitted file is `src/lib/db/schema/auth.ts` before committing.
- The generated file is committed, but treated as read-only. To change it, change the auth config and re-run `pnpm auth:generate`, then `pnpm db:generate` for the migration diff.
- `usePlural: true` in the adapter config (see §5.2) is what produces the plural table names `users` / `sessions` / `accounts` / `verifications` required by Spec 00 §6. Verify the generated file uses exactly those names before committing.
- Verify the generated `sessions.user_id` and `accounts.user_id` FKs use `onDelete: 'cascade'`. Recent CLI versions emit this by default; if yours does not, fix the auth config (not the generated file) or upgrade the CLI.

Bootstrap ordering (first time only) is in §7.2.

### 5.2 `src/lib/auth/auth.ts` — full config

```ts
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
    // Why: Spec 00 §6 mandates plural table names (users, sessions, ...).
    usePlural: true,
    schema,
  }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: !env.SIGNUP_ENABLED,
    minPasswordLength: 8,
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

  advanced: {
    database: {
      // Why: Spec 00 mandates app-side nanoid(21) ids for ALL tables,
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
          await db
            .insert(userSettings)
            .values({ userId: user.id })
            .onConflictDoNothing();
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
```

Session cookie behavior (Better Auth defaults, documented here so nobody hunts for them): cookie name `better-auth.session_token`, `httpOnly`, `sameSite=lax`, `secure` automatically when `BETTER_AUTH_URL` is https, path `/`.

### 5.3 `src/app/api/auth/[...all]/route.ts`

```ts
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth/auth';

export const { GET, POST } = toNextJsHandler(auth.handler);
```

Note the path: `src/app/api/...` — API route handlers live **outside** the `[locale]` segment (Spec 00 §9).

### 5.4 `src/lib/auth/client.ts` — React side

```ts
/**
 * Better Auth client for React components ("use client" consumers).
 * baseURL is omitted on purpose: the client calls same-origin /api/auth.
 */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
```

### 5.5 `src/lib/auth/session.ts` — server helpers

```ts
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
```

`UnauthorizedError` and `NotFoundError` come from Spec 01's `src/lib/errors.ts` (part of its `DomainError` hierarchy, Spec 01 §9) — this spec only imports them, never redefines them. `NotFoundError`'s constructor takes `(resource, id)`, e.g. `new NotFoundError('product', productId)`.

### 5.6 Route protection — composition with the next-intl middleware

Spec 01's `src/middleware.ts` runs `next-intl`'s `createMiddleware(routing)`. This spec **extends the same file** (there can be only one middleware in Next.js) to add an optimistic auth gate in front of it:

```ts
/**
 * Middleware = auth gate + i18n, in that order.
 *
 * Design: the auth check here is OPTIMISTIC — it only tests session-cookie
 * presence (getSessionCookie does no DB or crypto work, so this stays
 * edge-cheap). Its job is UX: anonymous visitors never see a flash of the
 * app shell. The real enforcement is requireUser() in every server entry
 * point; a forged cookie passes the middleware and then dies there.
 */
import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';

import { routing } from '@/lib/i18n/routing';

const handleI18n = createMiddleware(routing);

// Locale-stripped pathnames reachable without a session. /offline is the
// service worker's precached fallback page (Spec 06) — an auth-free static
// page that must render without a session cookie.
const PUBLIC_PATHNAMES = new Set(['/login', '/signup', '/offline']);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Normalize away the locale prefix so the allowlist matches
  // /login, /it/login, and /en/login alike.
  const localeMatch = pathname.match(/^\/(it|en)(?=\/|$)/);
  const pathnameWithoutLocale = localeMatch
    ? pathname.slice(localeMatch[0].length) || '/'
    : pathname;

  if (!PUBLIC_PATHNAMES.has(pathnameWithoutLocale) && !getSessionCookie(request)) {
    // Preserve the visitor's locale in the redirect. Spec 01 configured
    // localePrefix: 'as-needed', so the default locale stays unprefixed —
    // the redirect target must be a URL the i18n middleware considers
    // canonical.
    const locale = localeMatch?.[1] ?? routing.defaultLocale;
    const prefix = locale === routing.defaultLocale ? '' : '/' + locale;
    const loginUrl = new URL(`${prefix}/login`, request.url);
    loginUrl.searchParams.set('redirectTo', pathnameWithoutLocale);
    return NextResponse.redirect(loginUrl);
  }

  return handleI18n(request);
}

export const config = {
  // Skip API routes (they self-authenticate via requireUser), Next internals,
  // and static files. Must stay a superset of Spec 01's i18n matcher.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

The three enforcement layers, explicitly:

| Layer | Mechanism | Guarantees |
|---|---|---|
| Middleware | cookie presence via `getSessionCookie` | UX only — cheap redirect for anonymous visitors |
| `(app)` layout | `src/app/[locale]/(app)/layout.tsx` calls `getSessionUser()`; `redirect({ href: '/login', locale })` (next-intl's redirect) when null | No protected page ever renders without a verified session |
| Data access | `requireUser()` in every Server Action / route handler, `userId` parameter on every repository function | No cross-user data access is representable |

### 5.7 Minimal auth pages

`src/app/[locale]/(auth)/login/page.tsx` and `src/app/[locale]/(auth)/signup/page.tsx`: client components using `authClient.signIn.email` / `authClient.signUp.email`, showing the API error message on failure and redirecting to `redirectTo` (default `/`) on success. The signup page renders a "registration is closed" message instead of the form when signup is disabled — expose `env.SIGNUP_ENABLED` to the page via a server component prop, never by importing `env` into client code. Zod-validate the form input (email format, password ≥ 8 chars) before calling the client. No styling beyond structural HTML; Spec 05 owns the design.

---

## 6. Repositories — `src/lib/db/repositories/`

### 6.1 Conventions (apply to every file)

- **Explicit dependency injection**: every function takes `db: Db` (from `src/lib/db/client.ts`) as its **first** parameter. Services pass the singleton; tests pass an in-memory instance. No repository imports the `db` singleton.
- **SECURITY RULE (non-negotiable)**: every function takes `userId` as its **second** parameter and applies `eq(table.userId, userId)` in every WHERE clause and JOIN condition. Repositories never accept caller-built filters that could widen the scope. Consequently **no cross-user read or write is representable through this layer** — a wrong `id` from another user behaves exactly like a missing row.
- **Not-found convention**: `get*` functions return `null`; `update*`/`delete*` return `null`/`false` when no row matched. Repositories do not throw domain errors for missing rows — services translate to `NotFoundError` where the use case demands it. Exception: `mergeProducts` throws (see §6.3) because a partial merge must abort the transaction.
- Inputs are already-validated data. Zod parsing happens at the boundary (Server Actions / route handlers, Specs 03 and 05); repositories trust their typed inputs.
- Input types are subsets of the Drizzle `$inferInsert` types with `id`, `userId`, `createdAt`, `updatedAt` omitted (generated/injected), exported from each repository file.
- No business rules in this layer: no price computation, no session-state machines, no index math.

Example call site (service layer):

```ts
const store = await createStore(db, user.id, { name: 'Esselunga Viale Papiniano', kind: 'supermarket' });
```

### 6.2 `stores.ts`

```ts
export type CreateStoreInput = Omit<NewStore, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
export type UpdateStorePatch = Partial<CreateStoreInput>;

/** Insert a store for the user and return the created row. */
export async function createStore(db: Db, userId: string, input: CreateStoreInput): Promise<Store>;

/** List all of the user's stores, ordered by name (case-insensitive). */
export async function listStores(db: Db, userId: string): Promise<Store[]>;

/** Fetch one store by id, or null if it does not exist for this user. */
export async function getStoreById(db: Db, userId: string, storeId: string): Promise<Store | null>;

/** Apply a partial update; returns the updated row, or null if not found. */
export async function updateStore(
  db: Db,
  userId: string,
  storeId: string,
  patch: UpdateStorePatch,
): Promise<Store | null>;

/**
 * Delete a store. Entries and sessions referencing it keep existing with
 * store_id = NULL (FK action). Returns false if not found.
 */
export async function deleteStore(db: Db, userId: string, storeId: string): Promise<boolean>;
```

### 6.3 `products.ts`

```ts
export type CreateProductInput = Omit<NewProduct, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
export type UpdateProductPatch = Partial<CreateProductInput>;

export interface ListProductsOptions {
  category?: CategoryId;
  /** Case-insensitive substring match on name and brand. */
  search?: string;
  /** Default false: archived products are hidden from lists and suggestions. */
  includeArchived?: boolean;
}

/** Insert a product for the user and return the created row. */
export async function createProduct(db: Db, userId: string, input: CreateProductInput): Promise<Product>;

/** List the user's products with optional filters, ordered by name. */
export async function listProducts(db: Db, userId: string, options?: ListProductsOptions): Promise<Product[]>;

/** Fetch one product by id, or null if it does not exist for this user. */
export async function getProductById(db: Db, userId: string, productId: string): Promise<Product | null>;

/** Apply a partial update (including is_archived); returns the row, or null if not found. */
export async function updateProduct(
  db: Db,
  userId: string,
  productId: string,
  patch: UpdateProductPatch,
): Promise<Product | null>;

export interface MergeProductsResult {
  movedEntriesCount: number;
}

/**
 * Merge duplicate products: move every price entry from source to target,
 * then archive the source product — all in ONE transaction, so a failure
 * leaves both products untouched.
 *
 * The source is archived rather than deleted: deletion would be blocked by
 * the FK restrict if any entry slipped in concurrently, and archiving keeps
 * the merge trivially reversible by hand.
 *
 * Throws NotFoundError if either product does not exist for this user, or
 * if sourceProductId === targetProductId (self-merge is a caller bug).
 */
export async function mergeProducts(
  db: Db,
  userId: string,
  sourceProductId: string,
  targetProductId: string,
): Promise<MergeProductsResult>;
```

`mergeProducts` implementation shape (the one repository function whose internals are spec'd, because it is easy to get wrong):

```ts
return await db.transaction(async (tx) => {
  // Verify both endpoints inside the transaction — user scoping included.
  const [source, target] = await Promise.all([
    getProductById(tx, userId, sourceProductId),
    getProductById(tx, userId, targetProductId),
  ]);
  if (!source) {
    throw new NotFoundError('product', sourceProductId);
  }
  if (!target || sourceProductId === targetProductId) {
    // Why: a self-merge is a caller bug; treating it as a missing target
    // aborts the transaction without inventing a dedicated error code.
    throw new NotFoundError('product', targetProductId);
  }

  // Move entries, then archive the source.
  const moved = await tx
    .update(priceEntries)
    .set({ productId: targetProductId })
    .where(and(eq(priceEntries.userId, userId), eq(priceEntries.productId, sourceProductId)))
    .returning({ id: priceEntries.id });

  await tx
    .update(products)
    .set({ isArchived: true })
    .where(and(eq(products.userId, userId), eq(products.id, sourceProductId)));

  return { movedEntriesCount: moved.length };
});
```

(Repository functions accept `Db`; Drizzle's transaction object is assignable in practice — type the first parameter as `Db | DbTransaction` with `export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];` in `client.ts` if the compiler complains.)

### 6.4 `price-entries.ts`

```ts
export type CreatePriceEntryInput = Omit<NewPriceEntry, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
export type UpdatePriceEntryPatch = Partial<
  Omit<CreatePriceEntryInput, 'source' | 'aiModel' | 'aiRawJson'>
>;

/** Insert one price entry and return the created row. */
export async function createPriceEntry(
  db: Db,
  userId: string,
  input: CreatePriceEntryInput,
): Promise<PriceEntry>;

/**
 * Insert a batch of entries in one transaction (used by the /scan/review
 * confirm step, Spec 03). All-or-nothing.
 */
export async function createPriceEntries(
  db: Db,
  userId: string,
  inputs: CreatePriceEntryInput[],
): Promise<PriceEntry[]>;

/** Fetch one entry by id, or null if it does not exist for this user. */
export async function getPriceEntryById(db: Db, userId: string, entryId: string): Promise<PriceEntry | null>;

/** Apply a partial correction (prices, promo flags, product/store links); null if not found. */
export async function updatePriceEntry(
  db: Db,
  userId: string,
  entryId: string,
  patch: UpdatePriceEntryPatch,
): Promise<PriceEntry | null>;

/** Delete one entry. Returns false if not found. */
export async function deletePriceEntry(db: Db, userId: string, entryId: string): Promise<boolean>;

export interface ListPriceEntriesOptions {
  productId?: string;
  storeId?: string;
  category?: CategoryId;
  /** Inclusive lower bound on recorded_at. */
  recordedFrom?: Date;
  /** Inclusive upper bound on recorded_at. */
  recordedTo?: Date;
  /** Opaque cursor from a previous page's nextCursor. */
  cursor?: string;
  /** Page size; default 50, clamped to [1, 100]. */
  limit?: number;
}

export interface PriceEntryWithProduct extends PriceEntry {
  product: Pick<Product, 'id' | 'name' | 'brand' | 'category' | 'unitKind'>;
}

export interface PriceEntriesPage {
  entries: PriceEntryWithProduct[];
  /** Pass back as options.cursor to fetch the next page; null on the last page. */
  nextCursor: string | null;
}

/**
 * List the user's entries newest-first with keyset pagination and optional
 * filters. Joins the product summary because every consumer (the /history
 * timeline) renders product name and category next to each entry.
 *
 * Cursor: keyset over (recorded_at DESC, id DESC) — the id tie-breaker makes
 * pagination stable when many entries share a timestamp, and inserting new
 * entries never shifts or duplicates already-fetched pages. Encoding:
 * base64url of `${recordedAtMs}:${id}`. A malformed cursor throws
 * ValidationError (surfaces as HTTP 400 at the boundary).
 */
export async function listPriceEntries(
  db: Db,
  userId: string,
  options?: ListPriceEntriesOptions,
): Promise<PriceEntriesPage>;

// IndexEntry is defined ONCE in src/lib/inflation/types.ts and owned by
// Spec 04. Shape for reference — note recordedAt is a number (epoch ms):
//   { productId: string; category: CategoryId; recordedAt: number;
//     unitPriceMilli: number; totalPriceCents: number; isPromo: boolean }
import type { IndexEntry } from '@/lib/inflation/types';

/**
 * Minimal projection of ALL of the user's entries for the inflation engine
 * (Spec 04): monthly bucketing needs (productId, recordedAt, unitPriceMilli,
 * isPromo); category weights need (category, totalPriceCents). The DB's
 * Date surfaces here as epoch ms — IndexEntry.recordedAt is a number, and
 * the repository does the mapping. Ordered by recorded_at ascending.
 * Deliberately unpaginated — the engine is a pure function over the full
 * series (years of personal data stay in the low tens of thousands of rows).
 */
export async function listEntriesForIndex(db: Db, userId: string): Promise<IndexEntry[]>;
```

Implementation notes:

- The `category` filter and `IndexEntry.category` require an inner join on `products` with **both** `eq(priceEntries.productId, products.id)` and `eq(products.userId, userId)` in the join condition (defense in depth for the security rule).
- Cursor helpers `encodePriceEntriesCursor(recordedAt: Date, id: string): string` and `decodePriceEntriesCursor(cursor: string)` are module-private, using Node's `Buffer` base64url.
- The keyset predicate: `recorded_at < cursor.ms OR (recorded_at = cursor.ms AND id < cursor.id)`.
- Fetch `limit + 1` rows to compute `nextCursor` without a COUNT query.
- `listEntriesForIndex` maps `recordedAt` from the Drizzle-surfaced `Date` to epoch ms (`.getTime()`) so the rows match Spec 04's `IndexEntry` exactly.

### 6.5 `shopping-sessions.ts`

```ts
export type CreateShoppingSessionInput = Pick<NewShoppingSession, 'storeId'>;
export type UpdateShoppingSessionPatch = Partial<
  Pick<NewShoppingSession, 'storeId' | 'status' | 'completedAt'>
>;

/** Insert a session with status 'active' and startedAt = now; return the row. */
export async function createShoppingSession(
  db: Db,
  userId: string,
  input?: CreateShoppingSessionInput,
): Promise<ShoppingSession>;

/** Fetch one session by id, or null if it does not exist for this user. */
export async function getShoppingSessionById(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<ShoppingSession | null>;

/**
 * The user's most recent session with status 'active', or null. The
 * "at most one active session" rule is enforced by the service layer
 * (Spec 03), not here.
 */
export async function getActiveShoppingSession(db: Db, userId: string): Promise<ShoppingSession | null>;

/** Apply a partial update (status transitions, store, completion time); null if not found. */
export async function updateShoppingSession(
  db: Db,
  userId: string,
  sessionId: string,
  patch: UpdateShoppingSessionPatch,
): Promise<ShoppingSession | null>;

/** List the user's sessions newest-first; limit defaults to 20, clamped to [1, 100]. */
export async function listShoppingSessions(
  db: Db,
  userId: string,
  options?: { limit?: number },
): Promise<ShoppingSession[]>;
```

### 6.6 `settings.ts`

```ts
export type UpdateUserSettingsPatch = Partial<
  Pick<UserSettings, 'includePromosInIndex' | 'carryForwardMonths'>
>;

/**
 * Fetch the user's settings row. If it is missing (user predates the signup
 * hook, or was seeded directly), insert the defaults and return them — the
 * row's existence is a persistence invariant, so healing it here is
 * persistence logic, not a business rule.
 */
export async function getUserSettings(db: Db, userId: string): Promise<UserSettings>;

/** Apply a partial settings update and return the updated row. */
export async function updateUserSettings(
  db: Db,
  userId: string,
  patch: UpdateUserSettingsPatch,
): Promise<UserSettings>;
```

---

## 7. Migrations Workflow

### 7.1 Scripts (`package.json`)

| Script | Command | Purpose |
|---|---|---|
| `db:generate` | `drizzle-kit generate` | Diff schema → SQL migration in `drizzle/` |
| `db:migrate` | `drizzle-kit migrate` | Apply pending migrations to the configured DB |
| `db:studio` | `drizzle-kit studio` | Inspect the DB in the browser |
| `db:seed` | `tsx --env-file=.env.local scripts/seed.ts` | Populate local dev data (§8) |
| `auth:generate` | `pnpm dlx @better-auth/cli@^1.7.0 generate --yes` | Regenerate `schema/auth.ts` (§5.1; row lives in the canonical scripts table, Spec 01 §4) |

Rules:

- The `drizzle/` folder (SQL files + `meta/` journal) is **committed**. Migrations are append-only history; never edit an applied migration.
- **Migrations never run at app runtime.** No `migrate()` call in the app boot path, no Vercel build step. Local: `pnpm db:migrate` against `file:local.db`. Production: run `pnpm db:migrate` manually (or from a manually-triggered CI job) with the production `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` exported in the shell — **before** deploying code that needs the new schema.

### 7.2 First-migration bootstrap order

There is a bootstrap circularity — `app.ts` FKs reference `users` from the generated `auth.ts`, while the Better Auth CLI executes `auth.ts` (the config), which in its final form imports `app.ts` (for the `userSettings` hook). Break it in this order:

1. Install deps; create `src/lib/domain/*` (§4.1) and `src/lib/db/client.ts` (§3.2).
2. Create `src/lib/auth/auth.ts` in a **reduced first version**: everything from §5.2 except the `databaseHooks` block and the `schema` key on the adapter (neither exists yet).
3. `pnpm auth:generate` → emits `src/lib/db/schema/auth.ts` with the four plural tables.
4. Create `src/lib/db/schema/app.ts` (§4.2) and the `index.ts` barrel (§3.3).
5. Complete `auth.ts` to the full §5.2 version (add `schema`, add `databaseHooks`).
6. `pnpm db:generate` → `drizzle/0000_*.sql` containing all nine tables.
7. `pnpm db:migrate` → applies to `file:local.db`.
8. Sanity check: `pnpm db:studio`, confirm table and index names match Spec 00 §6 exactly.

### 7.3 Ongoing changes

App-schema change → edit `app.ts` → `pnpm db:generate` → review the SQL → `pnpm db:migrate` → commit code + migration together. Auth upgrade that changes Better Auth's model → `pnpm auth:generate` → `pnpm db:generate` → same flow.

---

## 8. Seed — `scripts/seed.ts`

Purpose: one command gives Specs 04/05 a realistic four-month dataset with rising prices, promos, and fuel — enough for a meaningful index, charts, and lists.

### 8.1 Guards & lifecycle

```ts
// Why: seeding must be impossible against production. The remote Turso URL
// starts with libsql://; only a local file database is accepted.
if (!process.env.TURSO_DATABASE_URL?.startsWith('file:')) {
  console.error('Refusing to seed: TURSO_DATABASE_URL is not a local file database.');
  process.exit(1);
}
```

- Runs with `pnpm db:seed` (env loaded via `tsx --env-file=.env.local`). Requires migrations to be applied first; fail with a clear message if the tables are missing.
- **Idempotent by wipe**: if a user with the seed email exists, delete it first (`DELETE FROM users WHERE email = ...` — cascades wipe settings, stores, products, sessions, entries). Verify the generated auth schema cascades `sessions`/`accounts`; if not, delete those rows explicitly before the user.
- Creates the user through `auth.api.signUpEmail({ body: { email, password, name } })` so the password hash is produced by Better Auth itself. Requires `SIGNUP_ENABLED` ≠ `false` locally (the default); abort with a clear message otherwise.
- All non-auth rows use fixed ids (`seed-store-esselunga`, `seed-prod-spaghetti`, …) so re-runs and tests are reproducible.

### 8.2 Seed credentials

| Field | Value |
|---|---|
| email | `dev@segnaprezzi.local` |
| password | `segnaprezzi-dev` |
| name | `Dev User` |

### 8.3 Dataset

**Stores (2)**

| id | name | chain | city | kind |
|---|---|---|---|---|
| `seed-store-esselunga` | Esselunga Viale Papiniano | Esselunga | Milano | `supermarket` |
| `seed-store-eni` | Eni Station Via Lorenteggio | Eni | Milano | `fuel_station` |

**Months**: `M-3 … M0` = the three previous calendar months plus the current one, computed at run time (Europe/Rome) so the dashboard always shows fresh data. Prices and structure are fixed → content is deterministic; only the dates slide with the run date.

**Products (13, 6 categories) with unit prices (`unit_price_milli`) per month**

| id (`seed-prod-…`) | name | brand | category | unitKind | packageSize | M-3 | M-2 | M-1 | M0 |
|---|---|---|---|---|---|---|---|---|---|
| `spaghetti` | Spaghetti n.5 500g | Barilla | `food` | weight | 0.5 | 2580 | 2580 | 2780 | 2780 |
| `latte` | Latte intero UHT 1L | Granarolo | `food` | volume | 1.0 | 1690 | 1750 | 1750 | 1790 |
| `olio` | Olio extravergine di oliva 1L | Monini | `food` | volume | 1.0 | 8990 | 9490 | 9490 | 8990 † |
| `pane` | Pane casereccio | — | `food` | weight | 0.5 | 4380 | 4380 | 4580 | 4580 |
| `parmigiano` | Parmigiano Reggiano 24 mesi | — | `food` | weight | 0.3 | 19900 | 20500 | 20500 | 21200 |
| `caffe` | Caffè macinato Qualità Rossa 250g | Lavazza | `food` | weight | 0.25 | 15160 | 15160 | 13960 ‡ | 15960 |
| `acqua` | Acqua naturale 6×1.5L | San Benedetto | `beverages` | volume | 9.0 | 290 | 290 | 312 | 312 |
| `succo` | Succo d'arancia 1L | Yoga | `beverages` | volume | 1.0 | 1990 | 1990 | 2090 | 2090 |
| `piatti` | Detersivo piatti limone 900ml | Nelsen | `household` | volume | 0.9 | 1990 | 2100 | 2100 | 2100 |
| `carta` | Carta igienica 4 rotoli | Regina | `household` | count | 4 | 623 | 623 | 675 | 675 |
| `shampoo` | Shampoo antiforfora 250ml | H&S | `personal-care` | volume | 0.25 | 15960 | 15960 | 17160 | 17160 |
| `crocchette` | Croccantini gatto salmone 2kg | Purina | `pets` | weight | 2.0 | 4745 | 4745 | 4995 | 4995 |
| `benzina` | Benzina self | — | `fuel` | volume | *(per entry)* | 1789 | 1812 | 1846 | 1799 |

† `olio` in M0 is a promo: `is_promo = 1`, `promo_kind = 'loyalty'`.
‡ `caffe` in M-1 is a promo: `is_promo = 1`, `promo_kind = 'discount'`.

**Entry generation rules**

- Grocery products: one entry per product per month on **day 5, 10:30 Europe/Rome**, at `seed-store-esselunga`. `spaghetti` and `latte` get a **second** entry on day 18 at the same month's unit price (exercises the monthly-mean bucketing in Spec 04).
- `total_price_cents = Math.round(unit_price_milli * package_size / 10)` (e.g. spaghetti: 2580 × 0.5 / 10 = 129 → €1.29).
- Fuel: two entries per month (days 6 and 20, 08:15) at `seed-store-eni`, `source = 'fuel'`, `package_size` = liters from the fixed cycle `[35.0, 32.4, 38.2, 30.0, 33.5, 36.1, 31.8, 34.2]` (M-3 uses the first two, and so on); total from the same rounding formula.
- `source`: `'manual'` for grocery entries, except the M0 entries for `spaghetti` and `olio` which use `'photo'` with `ai_confidence = 0.93`, `ai_model = 'claude-haiku-4-5'`, `photo_url = null`, `ai_raw_json = null` (exercises AI badges in Spec 05 without needing Blob assets).
- One `shopping_sessions` row per month (`seed-session-m3` … `seed-session-m0`): store = Esselunga, `status = 'completed'`, `started_at` = day 5 10:15, `completed_at` = day 5 11:00; the month's grocery entries link to it via `session_id`. Fuel entries have `session_id = null`.
- All entries: `currency = 'EUR'`.

Structure the script as small pure builder functions (`buildSeedMonths()`, `buildSeedEntries(months)`) plus one writer that inserts via the repositories (passing the real `db`) — the seed doubles as an end-to-end smoke test of the repository layer.

---

## 9. `GET /api/export`

File: `src/app/api/export/route.ts`. Auth required; anonymous requests get `401 { "error": "unauthorized" }`.

```ts
import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { UnauthorizedError } from '@/lib/errors';
import { db } from '@/lib/db/client';
import { exportUserData } from '@/lib/services/export';

export async function GET() {
  try {
    const user = await requireUser();
    const payload = await exportUserData(db, user.id);

    const date = new Date().toISOString().slice(0, 10);
    return NextResponse.json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="segnaprezzi-export-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw error;
  }
}
```

`exportUserData(db, userId)` lives in `src/lib/services/export.ts` (thin orchestration over the repositories — the route stays HTTP-only per the layer rules). Payload shape (`schemaVersion: 1`):

```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-20T09:12:33.000Z",     // ISO 8601 UTC
  "settings": {
    "includePromosInIndex": true,
    "carryForwardMonths": 2
  },
  "stores": [
    { "id": "…", "name": "Esselunga Viale Papiniano", "chain": "Esselunga",
      "city": "Milano", "kind": "supermarket",
      "createdAt": "…", "updatedAt": "…" }
  ],
  "products": [
    { "id": "…", "name": "Spaghetti n.5 500g", "brand": "Barilla",
      "category": "food", "unitKind": "weight", "notes": null,
      "isArchived": false, "createdAt": "…", "updatedAt": "…" }
  ],
  "shoppingSessions": [
    { "id": "…", "storeId": "…", "status": "completed",
      "startedAt": "…", "completedAt": "…", "createdAt": "…", "updatedAt": "…" }
  ],
  "entries": [
    { "id": "…", "productId": "…", "storeId": "…", "sessionId": "…",
      "recordedAt": "…", "totalPriceCents": 129, "packageSize": 0.5,
      "unitPriceMilli": 2580, "isPromo": false, "promoKind": null,
      "source": "manual", "currency": "EUR", "photoUrl": null,
      "aiConfidence": null, "aiModel": null, "aiRawJson": null,
      "createdAt": "…", "updatedAt": "…" }
  ]
}
```

Conventions: camelCase keys; all timestamps as ISO 8601 UTC strings (human-readable, lossless back to epoch ms); money stays integer cents/milli; `userId` columns are omitted (every row belongs to the requester); `shoppingSessions` is included so the export is genuinely the *full* dataset; `aiRawJson` is included verbatim (it is the user's data). Bump `schemaVersion` whenever a future spec changes this shape.

---

## 10. Tests

### 10.1 Infrastructure

- **`src/lib/db/testing/create-test-db.ts`**: `createTestDb(): Promise<{ db: Db; client: Client }>` — `createClient({ url: ':memory:' })`, wrap with `drizzle`, then apply the real committed migrations programmatically via `migrate(db, { migrationsFolder: 'drizzle' })` from `drizzle-orm/libsql/migrator`. Tests run against the exact SQL production runs — schema drift between tests and prod is impossible. Also export `createTestUser(db, overrides?): Promise<{ id: string }>` which inserts a row directly into `users` (repositories only need the FK target; no auth flow involved).
- Tests are colocated: `src/lib/db/repositories/stores.test.ts`, etc. Each test creates its own fresh in-memory DB in `beforeEach` — full isolation, no shared state, no cleanup code.
- `pnpm db:generate` must have produced `drizzle/` before the suite runs (it is committed, so this only matters mid-development).
- Style: AAA structure, behavioral names (Development Guidelines §Testing).

### 10.2 Test cases (minimum set)

| File | Test name | Verifies |
|---|---|---|
| `stores.test.ts` | should create a store and read it back by id | insert + select round-trip, defaults populated |
| `stores.test.ts` | should return null when the store belongs to another user | user isolation on reads |
| `stores.test.ts` | should not update a store owned by another user | user isolation on writes (returns null, row unchanged) |
| `stores.test.ts` | should null store_id on entries when the store is deleted | FK `set null` action |
| `products.test.ts` | should exclude archived products unless includeArchived is set | list filter default |
| `products.test.ts` | should filter products by category and case-insensitive search | `ListProductsOptions` combinations |
| `products.test.ts` | should move all entries to the target when merging products | `mergeProducts` happy path: entries re-pointed, count returned |
| `products.test.ts` | should archive the source product after a merge | source `isArchived = true`, target untouched |
| `products.test.ts` | should roll back the merge when the target does not exist | transactionality: source entries and archive flag unchanged after the throw |
| `products.test.ts` | should refuse to merge products across users | source owned by user A, target by user B → NotFoundError, nothing moved |
| `products.test.ts` | should refuse a self-merge | `sourceId === targetId` → NotFoundError |
| `price-entries.test.ts` | should reject deleting a product that has entries | FK `restrict` (raw delete attempt throws) |
| `price-entries.test.ts` | should insert a batch atomically | `createPriceEntries` with one invalid FK → no rows inserted |
| `price-entries.test.ts` | should paginate newest-first without duplicates or gaps | 25 entries, limit 10 → 10+10+5, ids disjoint and exhaustive |
| `price-entries.test.ts` | should keep cursors stable across ties on recorded_at | many entries sharing one timestamp; id tie-breaker yields no dup/skip |
| `price-entries.test.ts` | should keep an open cursor valid when new entries arrive | insert newer entries between page 1 and page 2 → page 2 unchanged |
| `price-entries.test.ts` | should throw ValidationError on a malformed cursor | garbage cursor input |
| `price-entries.test.ts` | should filter by product, store, category, and date range | each filter narrows correctly; category via product join |
| `price-entries.test.ts` | should never return another user's entries | isolation incl. category-join path |
| `price-entries.test.ts` | should return the minimal ascending projection for the index | `listEntriesForIndex`: exact field set, `recordedAt` as epoch ms, ascending order, own user only |
| `shopping-sessions.test.ts` | should create an active session and find it as the active one | `createShoppingSession` + `getActiveShoppingSession` |
| `shopping-sessions.test.ts` | should not report completed or discarded sessions as active | status filtering |
| `settings.test.ts` | should create default settings on first read when the row is missing | self-healing `getUserSettings` (promos included, carry-forward 2) |
| `settings.test.ts` | should persist partial settings updates | `updateUserSettings` patch semantics |
| `settings.test.ts` | should cascade-delete all user data when the user row is deleted | user delete wipes settings/stores/products/sessions/entries |

Auth config itself (Better Auth internals) is **not** unit-tested — it is framework wiring. The signup → `user_settings` hook and login flow are covered by a Playwright smoke test in Spec 05's E2E suite; if a quick check is wanted now, the seed script already exercises `signUpEmail` + the hook.

---

## 11. Definition of Done

- [ ] `pnpm db:generate` and `pnpm db:migrate` run clean; `drizzle/` migrations committed; `local.db*` gitignored.
- [ ] All nine tables exist with the exact names/columns/indexes of Spec 00 §6 (verify in `pnpm db:studio`).
- [ ] `src/lib/db/schema/auth.ts` is CLI-generated (plural table names), committed, and untouched by hand.
- [ ] Signup creates a `user_settings` row automatically; login/logout work via the minimal pages; `SIGNUP_ENABLED=false` blocks signup server-side (API returns an error, not just hidden UI).
- [ ] Anonymous visits to any protected route redirect to the locale-correct login page; `redirectTo` round-trips after login; `(app)` layout verifies the session server-side.
- [ ] All five repository files implemented with the §6 signatures; every function takes `db` and `userId`; no query lacks the `user_id` filter.
- [ ] `pnpm db:seed` populates the §8 dataset on a local file DB and refuses on a `libsql://` URL.
- [ ] `GET /api/export` returns the §9 shape for the seed user and 401 anonymously.
- [ ] All §10.2 tests pass (`pnpm test`); merge transactionality and user isolation covered.
- [ ] `pnpm lint` (Biome) and `pnpm typecheck` pass; comments follow `docs/COMMENTS.md`.
- [ ] `CLAUDE.md` "Current status" updated; work committed with conventional commits.

---

## Implementation Prompt

```text
You are implementing Spec 02 — Database & Auth — of the segnaprezzi project.

Before writing ANY code, read these files in full, in this order:
1. AGENTS.md and CLAUDE.md (project conventions and current status)
2. docs/specs/00-overview.md (canonical contract: names, money rules, env vars)
3. docs/specs/02-database-auth.md (the spec you are implementing — follow it exactly)
4. docs/DEVELOPMENT_GUIDELINES.md (layers, naming, error handling, testing)
5. docs/COMMENTS.md (comment discipline — applies to every file you write)

Then implement Spec 02 completely: Turso/Drizzle wiring, domain constant files,
the full app schema, Better Auth (CLI-generated auth schema, config, route
handler, client, session helpers, middleware composition, minimal auth pages),
all five repositories, the migrations workflow (follow the bootstrap order in
§7.2 exactly), scripts/seed.ts, GET /api/export, and the full test suite from
§10.2. Every table, column, index, function name, and file path must match the
spec verbatim. Every query must be scoped by user_id.

When you believe you are done:
- run pnpm lint, pnpm typecheck, and pnpm test — all must pass
- run pnpm db:migrate and pnpm db:seed against file:local.db and verify
  /api/export returns the seeded dataset for the dev user
- work through the Definition of Done checklist in the spec
- update the "Current status" section of CLAUDE.md
- commit using conventional commits (split logical units: schema, auth,
  repositories, seed, export, tests)
```

**Recommended model:** Claude Sonnet 5
**Recommended effort:** high

**Prerequisites:** Spec 01 (Foundation & Scaffold) must be implemented — this spec extends its `src/lib/env.ts` and `src/middleware.ts`, and imports `UnauthorizedError` / `NotFoundError` from its `src/lib/errors.ts`.
