# CLAUDE.md — segnaprezzi

> Prima di iniziare qualunque sessione di lavoro su questo repo, leggi
> `WORKFLOW.md` — regole di sessione, branch/commit, e collaudo guidato.
> Vincolante quanto questo file.

**segnaprezzi** — your personal inflation index. Photograph supermarket shelf
price tags; Claude Opus 5.5 extracts product, total price, and unit price; the
app computes your personal CPI over time and compares it with the official
ISTAT index. Mobile-first, offline-first PWA. Open source (MIT), self-hostable,
private per user.

Canonical names, data shapes and decisions live in the code itself (Zod
schemas, Drizzle tables, domain enums) and in the "Key decisions" table below
— never contradict what is already implemented.

---

## 1. Tech stack

Current versions in use; install latest stable and check for breaking changes
only if majors differ.

| Package | Version | Role |
|---|---|---|
| next | 16.4.x | App Router, Server Actions |
| react / react-dom | 19.2.x | UI |
| typescript | 7.0.x | as scaffolded by create-next-app |
| tailwindcss | 4.3.x | Styling |
| drizzle-orm / drizzle-kit | 0.45.x / 0.31.x | ORM + migrations |
| @libsql/client | 0.17.x | Turso (libSQL/SQLite) |
| better-auth | 1.7.12 | Email + password auth |
| next-intl | 4.13.x | i18n (`it` default, `en`) |
| @serwist/next / serwist | 9.5.x | PWA service worker (webpack-only: see `docs/guide/offline-pwa.md` §4.39) |
| @anthropic-ai/sdk | 0.120.x | `claude-opus-5-5` extraction (effort `high`) |
| motion | 13.1.x | Spring-physics animation |
| zod | 4.4.x | Boundary validation |
| @vercel/blob | 2.8.x | Photo storage |
| dexie / dexie-react-hooks | 4.4.x | IndexedDB offline queue + live queries |
| vitest | 4.1.x | Unit/integration tests |
| @playwright/test | 1.62.x | E2E tests |
| @biomejs/biome | 2.5.x | Lint + format |

Package manager: **pnpm**. Node: **22+**. Deployment target:
**Vercel** (Turso for DB, Vercel Blob for photos).

---

## 2. Architecture

Routes / Server Actions / route handlers (thin: Zod validation, i18n, error
mapping) → services (`src/lib/services/`, use cases) → repositories
(`src/lib/db/repositories/`, Drizzle only) and gateways (`src/lib/ai/`,
`src/lib/blob/`). The inflation engine (`src/lib/inflation/`) is pure — zero
I/O, no imports from db/ai/next, heavily unit-tested. The offline photo queue
(`src/lib/offline/`, Dexie/IndexedDB) is client-side with a sync manager.
Layer/naming/error-handling rules: `DEVELOPMENT_GUIDELINES.md`.

---

## 3. Features / modules

- **Tag scanning + AI extraction**: camera → WebP ≤400 KB → Vercel Blob → `claude-opus-5-5` (effort `high`, no `temperature`, 60 s gateway timeout, `maxDuration = 90`) → review screen → confirm. Nothing hits the DB unconfirmed. The shelf tag is the unit of capture because it is the one place a supermarket prints the unit price.
- **Personal CPI engine**: matched-model relatives on one monthly price per product, wherever it was bought (`docs/guide/inflation-index.md` §4.72), Jevons within category and over every compared product (no expenditure weights since 2026-11-06, `docs/guide/inflation-index.md` §4.75), chained index base=100, carry-forward imputation, coverage stats, top movers; `rebaseIstat` + committed `data/istat-nic.json` (1996-01 → latest, base 2025=100, refreshed by `pnpm istat:update`).
- **Quick entry**: manual form (`/add/manual`, g/mL converted client-side) and fuel form (`/add/fuel`) with four quick picks — benzina, diesel, GPL, metano. Metano is sold per **kilogram**, so each pick carries its own `unit_kind`; renaming a pick's canonical name after entries exist is a data migration, not a copy edit.
- **Dashboard + product histories**: index hero with its coverage line, trend chart with ISTAT overlay, category breakdown with «non rilevata», top movers, per-product price history, catalog with merge and delete, timeline, settings — all in the design system recorded in `DESIGN.md`.
- **Catalog housekeeping**: archive (keeps history, leaves suggestions), merge duplicates, or **delete** a product outright with every observation it carries — one transaction, behind a confirmation that states how many observations go and that the index is recomputed without them. Deleting entries, products or a whole account also deletes their photos from Blob; `pnpm photos:prune` reports orphans left by older versions.
- **Receipt import — retired (2026-10-27)**: built and shipped in migration 0001, removed in 0002 at the owner's call. Receipts rarely print the €/kg the index needs, and the model miscounted repeated lines in ways only the printed total could catch. `price_entries.quantity` stays (every write path records 1; nothing reads it since 2026-11-06, dropping it would be a migration for nothing); `product_aliases`, `receipts`, `receipt_id`, `default_package_size` and every `source='receipt'` observation are gone. A v2 backup still imports: its receipt entries are skipped and counted.
- **Stores — retired (2026-11-12)**: the app recorded where a price was seen and the index compared each store with itself; removed in migration 0003 at the owner's call, because what matters is what a product costs wherever it is bought. No table, column, picker, filter, page or per-store comparison is left. Export is schema v4; a v1–v3 backup still imports and its stores are ignored.
- **Offline-first PWA**: Serwist service worker (NetworkFirst pages with a locale-aware `/offline` fallback, NetworkOnly `/api/*`, SWR photo thumbnails, CacheFirst hashed assets), web app manifest + generated icon set, and the sync engine in `src/lib/offline/sync.ts` — 1/2/4/8 s backoff, five attempts, concurrency 2 under a Web Lock, drains on start / `online` / tab focus / enqueue / Background Sync. Install experience lives in `src/components/pwa/`; a new service worker takes over at the next app start, with no update prompt (`docs/guide/offline-pwa.md` §4.76).
- **Auth + multi-user isolation**: Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here. One "Latest" entry: what
was done, where it is documented, what is open, what comes next.)*

**Latest — 2026-11-12, `refactor/remove-stores`.** The app no longer knows
stores: a product has one price a month wherever it was bought.

- **Index**: a product's monthly price is the mean of every observation of
  the month and its relative is this month over last month. Why the
  store-by-store comparison of 2026-11-03 was reversed, and what it costs:
  `docs/guide/inflation-index.md` §4.72–4.73.
- **Data**: migration 0003 drops `stores` and both `store_id` columns by
  rebuilding the two tables (AGENTS.md §4.78). Export is schema v4; older
  backups import, their stores ignored.
- **UI**: the stores page, every store picker, the history filter, the
  per-store comparison on the product page and the store line of a shopping
  trip are gone. The scan top bar is the close button alone.
- **Collaudo**: closed on 2026-11-12 on automated checks; the owner skipped
  the guided tour.

**Open / next:**

1. Production, after the deploy: backup export, migration 0003, then the
   duplicate products the stores had split are proposed and merged only where
   the owner approves.

2. Two dev machines. Mac: `pnpm` needs `corepack enable --install-directory
   ~/.local/bin` and `export PATH="$HOME/.local/bin:$PATH"` (AGENTS.md §4.11).
   Windows: `pnpm` lives in `AppData/Roaming/npm` (§4.11), the checkout is CRLF
   (§4.31) and a stale `.next` fails `pnpm typecheck` (§4.77). The Vercel
   project is linked on the Mac (`.vercel/`, gitignored); Turso production
   credentials are "Sensitive" on Vercel and come from `turso db show
   segnaprezzi --url` / `turso db tokens create segnaprezzi` (AGENTS.md §3.3),
   never from `vercel env pull`.

---

## 5. Session protocol

1. **Before any coding**, read: `AGENTS.md`, `DEVELOPMENT_GUIDELINES.md`,
   and `COMMENTS.md`, plus the guide in `docs/guide/` for the domain you touch
   (`auth.md`, `offline-pwa.md`, `capture.md`, `inflation-index.md`,
   `e2e.md`, `dipendenze.md`).
2. Canonical table/column/route/env names live in the code (Drizzle schema,
   Zod schemas, domain enums) — use them exactly. Money is integer only:
   `total_price_cents` (euro cents), `unit_price_milli` (milli-euros per base
   unit kg/L/piece).
3. **Quality gates before every commit**: `pnpm lint`, `pnpm typecheck`,
   `pnpm test` — all green. Playwright E2E before completing any user-facing
   flow work.
4. **Conventional commits** (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`);
   subject ≤72 chars, imperative, no period.
5. **End of session**: write `SESSION_NOTES.md` (Cosa / Perché / Nota), use it
   to fold the session's findings into this file and `AGENTS.md`, then delete
   it. It is a scratch handoff, never committed — the durable docs are where
   the reasoning has to end up.
6. UI work: `DESIGN.md` is the authoritative design spec (and `PRODUCT.md`
   the product truth the impeccable skill reads) — read it before touching
   any UI.

---

## 6. Key decisions (locked)

| Area | Decision |
|---|---|
| Stack | Next.js 16 App Router on Vercel |
| DB | Turso (libSQL) + Drizzle |
| Photos | Vercel Blob |
| Auth | Better Auth, email + password |
| AI | `claude-opus-5-5` at effort `high`, Anthropic SDK structured outputs, server-side key only |
| Receipts | **Retired 2026-10-27.** Not re-added without a new product decision: the unit price is on the shelf tag, not on the till receipt. `quantity` on entries stays |
| PWA | Serwist + IndexedDB (Dexie) photo queue; a new worker takes over at the next app start, nobody is asked |
| i18n | next-intl, `it` + `en` from day one |
| Money | Integers only: `total_price_cents`, `unit_price_milli`; floats only for index ratios |
| Time | Epoch ms UTC in DB; month bucketing in Europe/Rome |
| IDs | text nanoid(21), app-side |
| Lint/tests | Biome; Vitest + Playwright — run locally, no CI workflow; the only Action is the monthly ISTAT refresh |
| Index scope | **Reversed 2026-11-12.** One price per product per month, wherever it was bought: the app does not know stores, and a change of shop is part of your inflation (`docs/guide/inflation-index.md` §4.72). Stores are not re-added without a new product decision |
| Index weights | Every compared product is one vote (Jevons over the matched set); no expenditure weights, the app never says how much you spend (2026-11-06, `docs/guide/inflation-index.md` §4.75) |
| Registration | Open by default, `SIGNUP_ENABLED=false` closes it |
| Currency | EUR only in v1 (`currency` column kept for later) |
| License | MIT, public from first commit |
| UI | "Wow" bar — designed with the impeccable skill; world: *tabulato a modulo continuo* (`DESIGN.md`) |

Non-goals v1: barcode scanning, receipt import and store tracking (both tried and retired),
shared/community prices, multi-currency, budgeting, native app stores.
