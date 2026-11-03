# Authentication with Better Auth

Read this guide before touching `src/lib/auth`, `src/lib/db/schema/auth.ts`,
the auth API route or the rate limiter, before signing in from scripts or
tests, and before upgrading `better-auth`. The short version is the stub in
AGENTS.md § Domain guides.

## 3.5 Better Auth CLI (rarely needed)

```bash
pnpm auth:generate  # regenerates src/lib/db/schema/auth.ts
pnpm db:generate    # ALWAYS follows — see §4.2
pnpm db:migrate
```

Always invoke through the `auth:generate` script (AGENTS.md §3.1) — never a raw
`npx`/`pnpm dlx` call inline; the script pins the CLI version. Re-run only
when the Better Auth config changes shape (new plugin, new field). The
generated `schema/auth.ts` is committed but not fully hand-off — it needs one
manual correction after every regeneration until the CLI catches up with the
installed core version; see §4.16 before touching it.

## 4.2 Better Auth CLI generate, then drizzle-kit generate — in that order.

The Better Auth CLI writes Drizzle table definitions (`users`, `sessions`,
`accounts`, `verifications`) into `src/lib/db/schema/auth.ts`; it does **not**
create migrations. Skipping the follow-up `pnpm db:generate` leaves the DB
without auth tables and every auth call failing with a table-not-found error.

## 4.16 `@better-auth/cli` lags behind the `better-auth` core package's own versioning — pin an actual published version, and diff its output by hand.

There is no `@better-auth/cli@^1.7.0`; the CLI tops out around
`1.4.22`/`1.5.0-beta.x` while core is at 1.7.12. The CLI needs explicit
`--config src/lib/auth/auth.ts --output src/lib/db/schema/auth.ts` (it does
not autodetect either path here). History worth knowing before trusting
either side: core 1.7.0–1.7.2 required an `issuer` column on `accounts`, so
it was added by hand on 2026-08-21; core 1.7.3 abolished it, and 1.7.12's
Drizzle adapter refuses to *start* while a NOT NULL column it never writes
exists (§4.69). The generated file is therefore neither fully CLI output nor
fully hand-written: after every `pnpm auth:generate`, diff against the
committed file and keep what the installed core actually requires. Check the
latest `@better-auth/cli` version whenever this comes up again.

## 4.19 Better Auth enforces an Origin check that raw HTTP clients don't satisfy by default.

From Playwright's `page.request`, sign-in and sign-up
work without extra headers (open, unauthenticated entry points) but
`POST /api/auth/sign-out` 403s with `MISSING_OR_NULL_ORIGIN` unless the
request carries an `Origin` header matching a trusted origin. **Refinement
(2026-08-21, found during a capture-flow collaudo):** that carve-out is specific
to `page.request`, which inherits the browser context's origin. A bare Node
`fetch()` sends no `Origin` at all, so it is rejected on **every** Better Auth
route including sign-in — any script that authenticates outside a browser must
set `Origin` explicitly — `page.request.post()` is a raw API call,
not a real in-page `fetch()`, so it never sends one on its own (verified via
curl too). Pass `headers: { Origin: new URL(page.url()).origin }` explicitly
on any E2E call to a Better Auth route that acts on an authenticated
session, not just anonymous sign-in/sign-up.

## 4.42 Better Auth's rate limiter is on whenever `NODE_ENV === 'production'`, and `/sign-in*` + `/sign-up*` allow 3 requests per 10 s per IP.

Every
Playwright worker is the same IP, so moving the suite onto a production server
made `global-setup`'s two logins plus a signup, and then the signup tests,
trip it. Do **not** disable the limiter for tests — it is the app's only
brute-force defence. `tests/e2e/helpers/auth.ts` waits out a 429 using its
`Retry-After` header (the limiter does not extend the window on a rejected
request, so one wait is enough).

## 4.69 Better Auth 1.7.12 checks the Drizzle schema at startup and refuses a NOT NULL column it never writes — the hand-added `accounts.issuer` was one.

The upgrade from 1.7.1 (four advisories, one critical) did not change a line
of app code, and the unit suite stayed green; `next start` then threw
`BetterAuthError: Drizzle schema mismatch … Required columns Better Auth never
writes: accounts.issuer`, and every E2E login got a 500. Core 1.7.0–1.7.2 had
required that column (§4.16), 1.7.3 abolished it, and the official 1.7
upgrade guide's SQLite recipe is exactly `ALTER TABLE account DROP COLUMN
issuer` (SQLite has no `ALTER COLUMN … DROP NOT NULL`). Migration 0002
carries that drop next to the receipt tables. Lesson: a library upgrade that
touches auth is verified by a running server and a real sign-in, not by
`pnpm test` — the adapter's check runs only when the app boots.
