# CLAUDE.md — segnaprezzi

> Prima di iniziare qualunque sessione di lavoro su questo repo, leggi
> `WORKFLOW.md` — regole di sessione, branch/commit, e collaudo guidato.
> Vincolante quanto questo file.

**segnaprezzi** — your personal inflation index. Photograph supermarket shelf
price tags; Claude Haiku 4.5 extracts product, total price, and unit price; the
app computes your personal CPI over time and compares it with the official
ISTAT index. Mobile-first, offline-first PWA. Open source (MIT), self-hostable,
private per user.

The canonical contract for **all** names, data shapes, and decisions is
`docs/specs/00-overview.md`. Never contradict it.

---

## 1. Tech stack

Versions the specs were written against (2026-08-20). Install latest stable;
check for breaking changes only if majors differ.

| Package | Version | Role |
|---|---|---|
| next | 16.3.x | App Router, Server Actions |
| react / react-dom | 19.2.x | UI |
| typescript | 7.0.x | as scaffolded by create-next-app |
| tailwindcss | 4.3.x | Styling |
| drizzle-orm / drizzle-kit | 0.45.x / 0.31.x | ORM + migrations |
| @libsql/client | 0.17.x | Turso (libSQL/SQLite) |
| better-auth | 1.7.x | Email + password auth |
| next-intl | 4.13.x | i18n (`it` default, `en`) |
| @serwist/next / serwist | 9.5.x | PWA service worker |
| @anthropic-ai/sdk | 0.120.x | `claude-haiku-4-5` extraction |
| motion | 13.1.x | Spring-physics animation |
| zod | 4.4.x | Boundary validation |
| @vercel/blob | 2.8.x | Photo storage |
| dexie | 4.4.x | IndexedDB offline queue |
| vitest | 4.1.x | Unit/integration tests |
| @playwright/test | 1.62.x | E2E tests |
| @biomejs/biome | 2.5.x | Lint + format |

Package manager: **pnpm**. Node: **22+**. Deployment target:
**Vercel** (Turso for DB, Vercel Blob for photos).

---

## 2. Architecture (spec: 00-overview §5, rules: docs/DEVELOPMENT_GUIDELINES.md)

Routes / Server Actions / route handlers (thin: Zod validation, i18n, error
mapping) → services (`src/lib/services/`, use cases) → repositories
(`src/lib/db/repositories/`, Drizzle only) and gateways (`src/lib/ai/`,
`src/lib/blob/`). The inflation engine (`src/lib/inflation/`) is pure — zero
I/O, no imports from db/ai/next, heavily unit-tested. The offline photo queue
(`src/lib/offline/`, Dexie/IndexedDB) is client-side with a sync manager.

---

## 3. Features / modules

- **Tag scanning + AI extraction** (Spec 03): camera → WebP ≤400 KB → Vercel Blob → `claude-haiku-4-5` → review screen → confirm. Nothing hits the DB unconfirmed.
- **Personal CPI engine** (Spec 04): matched-model relatives, Jevons within category, expenditure-weighted across categories, chained index base=100, carry-forward imputation, coverage stats.
- **Quick entry** (Spec 03): manual form (`/add/manual`) and fuel form (`/add/fuel`).
- **Receipt import** (Spec 07): digital receipt (PDF) or photo → `/api/extract-receipt` → per-line extraction with `claude-haiku-4-5` → alias/fuzzy match to the catalog → review → N entries `source='receipt'`. File never stored; aliases learned on confirm.
- **Dashboard + product histories** (Spec 05): index hero, trend chart, category breakdown, top movers, per-product price history.
- **Offline-first PWA** (Spec 06): Serwist, IndexedDB photo queue, sync on reconnect.
- **Auth + multi-user isolation** (Spec 02, implemented): Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here — this section is the
current state of the codebase, not a journal.)*

**Latest (2026-08-21, Spec 02): rails, DB, and auth are live.** Next.js 16
App Router scaffold (pnpm, Biome, TS7 strict, next-intl `it`/`en`, theming,
`src/lib/errors.ts`, Vitest + Playwright, CI) now sits on a real Turso/Drizzle
DB — all nine canonical tables migrated (`drizzle/0000_perpetual_santa_claus.sql`)
— and Better Auth email+password auth (signup gated by `SIGNUP_ENABLED`,
login/logout, session cookies, a `user_settings` row auto-created on signup,
an `(app)` layout that verifies the session server-side). All five
repositories implemented and `user_id`-scoped (incl. transactional
`mergeProducts`, keyset-paginated `price-entries`). `scripts/seed.ts`
populates a deterministic four-month dataset for both seed users;
`GET /api/export` returns the full dataset. 28 unit tests + 9 Playwright E2E
tests green, alongside `pnpm lint`/`typecheck`/`build`.

Four verified corrections to Spec 02's literal text — RESTRICT→NO ACTION on
`price_entries.productId` (SQLite checks RESTRICT immediately per-row, not
deferred like every other action, which broke the full-account-wipe cascade);
the `@better-auth/cli` version pin (`^1.7.0` doesn't exist; used `1.4.22`)
plus a hand-patched `issuer` column the CLI doesn't yet emit but core 1.7.1
needs at runtime; the test DB factory using a uniquely-named temp file
instead of `:memory:` (an anonymous in-memory libSQL connection resets
itself the instant a `db.transaction()` throws); `db:seed` using
`--env-file-if-exists` instead of `--env-file` (Node throws if the file is
missing, which it always is in CI — caught by the `e2e` CI job) — plus one
addition no spec version mentions (WAL + busy_timeout on the local file DB,
without which a few concurrent requests threw `SQLITE_BUSY`). Full rationale
in `docs/specs/02-database-auth.md`'s inline correction notes and
`AGENTS.md` §4.15–§4.21 — read those before touching the DB client, the auth
schema, the test DB factory, or any `tsx --env-file` script.

Not yet done: Vercel project connection/deploy (no account access yet, carried
over since Spec 01); the WORKFLOW.md guided-collaudo phase-by-phase review
hasn't been walked through in chat with the user (the automatable half is
already covered by the E2E suite above).

Next step: implement **Spec 03** or **Spec 04** using the Implementation
Prompt at the end of the respective spec file (00-overview §12: either order
is fine, both depend only on Spec 02).

| Milestone | Status |
|---|---|
| Spec 01 — Foundation & Scaffold | ☑ |
| Spec 02 — Database & Auth | ☑ |
| Spec 03 — Capture & AI Extraction | ☐ |
| Spec 04 — Inflation Engine | ☐ |
| Spec 05 — UI & Design System | ☐ |
| Spec 06 — PWA & Offline | ☐ |
| DESIGN.md (generated after Spec 05) | ☐ |
| Spec 07 — Receipt Import | ☐ |

*Status last updated: 2026-08-21 (Spec 02 implemented).*

**INSTRUCTION**: whoever completes a milestone updates this table and the date
above **in the same commit** as the milestone.

---

## 5. Session protocol

1. **Before any coding**, read: `AGENTS.md`, the spec being implemented
   (`docs/specs/`), `docs/DEVELOPMENT_GUIDELINES.md`, and `docs/COMMENTS.md`.
2. Canonical table/column/route/env names live in `docs/specs/00-overview.md`
   — use them exactly. Money is integer only: `total_price_cents` (euro
   cents), `unit_price_milli` (milli-euros per base unit kg/L/piece).
3. **One spec per session**, in order 01 → 02 → (03 ∥ 04) → 05 → 06 → 07, using the
   Implementation Prompt at the end of the spec file, with the recommended
   model/effort:

   | Spec | Model | Effort |
   |---|---|---|
   | 01 | Claude Sonnet 5 | medium |
   | 02 | Claude Sonnet 5 | high |
   | 03 | Claude Opus 5 | high |
   | 04 | Claude Opus 5 (Fable 5 if available) | xhigh |
   | 05 | Claude Fable 5 + impeccable skill | xhigh |
   | 06 | Claude Opus 5 | high |
   | 07 | Claude Opus 5 | high |

4. **Never contradict 00-overview.** If a spec must deviate, change
   `docs/specs/00-overview.md` (and the spec file) in the same PR as the code.
5. **Quality gates before every commit**: `pnpm lint`, `pnpm typecheck`,
   `pnpm test` — all green (scripts defined in Spec 01). Playwright E2E before
   completing Specs 05–06.
6. **Conventional commits** (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`);
   subject ≤72 chars, imperative, no period.
7. UI work: after Spec 05, `DESIGN.md` is the authoritative design spec — read
   it before touching any UI.

---

## 6. Key decisions (locked — full table in 00-overview §3)

| Area | Decision |
|---|---|
| Stack | Next.js 16 App Router on Vercel |
| DB | Turso (libSQL) + Drizzle |
| Photos | Vercel Blob |
| Auth | Better Auth, email + password |
| AI | `claude-haiku-4-5`, Anthropic SDK, server-side key only (tags and receipts; separate model constants) |
| Receipts | Per-line import only; file hashed and discarded, never stored; `quantity` on entries, `product_aliases` learned |
| PWA | Serwist + IndexedDB (Dexie) photo queue |
| i18n | next-intl, `it` + `en` from day one |
| Money | Integers only: `total_price_cents`, `unit_price_milli`; floats only for index ratios |
| Time | Epoch ms UTC in DB; month bucketing in Europe/Rome |
| IDs | text nanoid(21), app-side |
| Lint/tests | Biome; Vitest + Playwright |
| Registration | Open by default, `SIGNUP_ENABLED=false` closes it |
| Currency | EUR only in v1 (`currency` column kept for later) |
| License | MIT, public from first commit |
| UI | "Wow" bar — designed with the impeccable skill |

Non-goals v1: barcode scanning, automatic receipt ingestion (e-mail/bank),
shared/community prices, multi-currency, budgeting, native app stores.
