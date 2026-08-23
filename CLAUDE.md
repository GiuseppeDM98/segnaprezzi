# CLAUDE.md — segnaprezzi

> Prima di iniziare qualunque sessione di lavoro su questo repo, leggi
> `WORKFLOW.md` — regole di sessione, branch/commit, e collaudo guidato.
> Vincolante quanto questo file.

**segnaprezzi** — your personal inflation index. Photograph supermarket shelf
price tags; Claude Haiku 4.5 extracts product, total price, and unit price; the
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
| next | 16.3.x | App Router, Server Actions |
| react / react-dom | 19.2.x | UI |
| typescript | 7.0.x | as scaffolded by create-next-app |
| tailwindcss | 4.3.x | Styling |
| drizzle-orm / drizzle-kit | 0.45.x / 0.31.x | ORM + migrations |
| @libsql/client | 0.17.x | Turso (libSQL/SQLite) |
| better-auth | 1.7.x | Email + password auth |
| next-intl | 4.13.x | i18n (`it` default, `en`) |
| @serwist/next / serwist | 9.5.x | PWA service worker (webpack-only: see AGENTS.md §4.39) |
| @anthropic-ai/sdk | 0.120.x | `claude-haiku-4-5` extraction |
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
Layer/naming/error-handling rules: `docs/DEVELOPMENT_GUIDELINES.md`.

---

## 3. Features / modules

- **Tag scanning + AI extraction**: camera → WebP ≤400 KB → Vercel Blob → `claude-haiku-4-5` → review screen → confirm. Nothing hits the DB unconfirmed.
- **Personal CPI engine**: matched-model relatives, Jevons within category, expenditure-weighted across categories, chained index base=100, carry-forward imputation, coverage stats, top movers; `rebaseIstat` + committed `data/istat-nic.json` (1996-01 → latest, base 2025=100, refreshed by `pnpm istat:update`).
- **Quick entry**: manual form (`/add/manual`, g/mL converted client-side) and fuel form (`/add/fuel`) with four quick picks — benzina, diesel, GPL, metano. Metano is sold per **kilogram**, so each pick carries its own `unit_kind`; renaming a pick's canonical name after entries exist is a data migration, not a copy edit.
- **Receipt import**: digital receipt (PDF) or photo → `/api/extract-receipt` → per-line extraction with `claude-haiku-4-5` (PDF as a native `document` block) → alias/fuzzy match to the catalog → review → N entries `source='receipt'`. The file is hashed and dropped, never stored; aliases are learned on confirm so the next receipt from that chain resolves itself. Identical printed lines are folded into one observation carrying their combined `quantity`, so a till that repeats an article weighs the same as one that prints "2 x".
- **Dashboard + product histories**: index hero, trend chart with ISTAT overlay, category breakdown, top movers, per-product price history, catalog with merge and delete, timeline, stores, settings — all in the design system recorded in `DESIGN.md`.
- **Catalog housekeeping**: archive (keeps history, leaves suggestions), merge duplicates, or **delete** a product outright with every observation it carries — one transaction, behind a confirmation that states how many observations go and that the index is recomputed without them. Deleting entries, products or a whole account also deletes their photos from Blob; `pnpm photos:prune` reports orphans left by older versions.
- **Offline-first PWA**: Serwist service worker (NetworkFirst pages with a locale-aware `/offline` fallback, NetworkOnly `/api/*`, SWR photo thumbnails, CacheFirst hashed assets), web app manifest + generated icon set, and the sync engine in `src/lib/offline/sync.ts` — 1/2/4/8 s backoff, five attempts, concurrency 2 under a Web Lock, drains on start / `online` / tab focus / enqueue / Background Sync. Install experience and the SW update toast live in `src/components/pwa/`.
- **Auth + multi-user isolation**: Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here — this section is the
current state of the codebase, not a journal.)*

**Schema is at migration 0001.** `receipts`, `product_aliases`,
`products.default_package_size` (back-filled from each product's newest
observation), `price_entries.quantity` (default 1) and
`price_entries.receipt_id`. `ENTRY_SOURCES` includes `'receipt'`,
`listEntriesForIndex` maps the real `quantity` column, and the export is at
`schemaVersion 2` carrying `receipts` (without `aiRawJson`) and
`productAliases`. The receipt pipeline itself is described in §3; its
hard-won details — alias precedence, SQLite's NULL semantics inside the
unique index, the prompt's worked examples, the synthetic fixture that must
never be replaced by a real receipt — are in AGENTS.md §4.49–§4.54.

**UI pass: the screens now say what they want.** A 390 px audit of every
screen — screenshots plus a scripted `scrollWidth > clientWidth` check on each
route — turned up eleven defects, and the review card carried most of them.
Its three-column money row did not fit a phone, so the unit price clipped its
own digits and the one label that wrapped pushed its input a line below its
neighbours; it is now two columns with the unit price full width, which is
what the (newer) receipt line card already did. The same card lost its
one-item "more options" sheet in favour of a direct discard, exactly as the
receipt card had.

The load-bearing fix is the one the owner hit: a card missing its product
could not be confirmed, and nothing said so. `blockingReasonOf()` now names
what is missing, the card states it in an amber banner, and the confirm button
is **deliberately not disabled** — pressing it scrolls to the offending card
and explains, which is the branch `handleConfirm` had always contained and
could never reach. A disabled button withholds both the reason and the way
out; the server-side guarantee is unchanged and the E2E test asserts the thing
that matters, that pressing confirm with an incomplete card writes nothing.

Three defects were grammar rather than layout: `band` is the zebra tint, so
anything using it as a plate *inside* a row (the flat trend pill, the store
icon tile) appeared on odd rows and vanished on even ones; and a disabled
button rendered as its own fill at 50% opacity, which drops an accent-filled
label to about 2:1. `DESIGN.md` records both rules now. Three more were
mechanical and invisible until measured: the charts' `sr-only` data table
widened `/products/[id]` by 117 px (a `<table>` ignores `width: 1px`), `Sheet`
rendered its portal on the client's hydration pass but never on the server,
and the toast outlet sat on top of every sticky confirm bar — the five
hand-copied bars are now one `StickyActionBar` publishing
`--sticky-action-bar-height`. Finally `formatInputDecimal` follows the locale,
so an Italian no longer reads "1.34 €" in the box and "1,34 €" in the total
below it. AGENTS.md §4.55–§4.58 carry the gotchas.

**Deleting a product, and the photos that were never being deleted.** The
catalog could archive and merge but never delete, by an explicit decision in
`schema/app.ts` — "history must never silently vanish". That decision is now
the *default* rather than the only option: `deleteProducts` removes the
products and every entry that references them in one transaction, from the
detail screen's menu, from a row's own trash button, and from the bulk
selection bar. What makes it safe is the confirmation, which states how many
observations are about to go and that the personal index will be recomputed
without them, and names archiving as the way to keep the history. The FK stays
`NO ACTION`: the entries are deleted explicitly first, and a stray delete is
still blocked.

That work surfaced a bigger hole, found by the owner looking at the Blob
store: **nothing ever deleted photos except discarding a shopping session**.
Deleting one observation left its blob, and deleting an *account* emptied
every table while its photos survived it — a privacy failure, not a storage
bill, since the database cascade stops at the store's edge. Both paths clean
up now (`deleteOwnedPhotos` for a known set, `deleteAllUserPhotos` on Better
Auth's `deleteUser.afterDelete`), and `pnpm photos:prune` reports — or with
`--delete` removes — what has already leaked. It refuses to run destructively
when the database it is comparing references no photo at all, which is the
signature of a local database pointed at the production store. AGENTS.md
§4.59–§4.61.

**Identical receipt lines are one purchase, not two.** A till prints the same
article twice as readily as it prints "2 x", and the app already had an
opinion about the second shape: `price_entries.quantity` exists so that
"2 x 1,09" is ONE observation bought twice rather than two observations
double-weighting that month's mean. Honouring it only for the receipts that
use a multiplier meant the same shopping trip landed in the index twice as
heavily depending on how the shop chose to print it — so `resolveReceiptLines`
now ends with `collapseIdenticalLines`, a pure fold that merges lines agreeing
on printed text, price per package, size, promo and resolved product, summing
their quantities and unioning their review reasons. Identical is read
strictly: two "pesto" at different prices are two observations (one was on
offer) and stay apart. The surviving draft keeps the FIRST line's index, which
is what `confirmReceipt` uses to reach `extraction.lines[index]` for the raw
text and the alias — identical by construction — and `receipts.ai_raw_json`
still holds every printed line, so nothing is lost from the audit trail. The
card says "2 righe uguali" next to the raw line, because that is where the
user checks the screen against the paper and would otherwise count one line
short. The review total was already `price x quantity`, so it does not move.

**Verified:** `pnpm lint` / `typecheck` / `build` green; **363**
unit/integration tests (40 files) and **95** Playwright tests, the latter
including the whole capture and receipt flows asserted against `/api/export`,
a product delete that must leave no orphaned entry behind, two identical
receipt lines landing as one observation bought twice, and the axe sweep over
every screen in both themes and both viewports. The 390 px audit that opened
the session is worth repeating after any UI work: screenshots of every route
plus a scripted `scrollWidth > clientWidth` check, which is what found a
117 px horizontal overflow no screenshot suggested.

---

## 5. Session protocol

1. **Before any coding**, read: `AGENTS.md`, `docs/DEVELOPMENT_GUIDELINES.md`,
   and `docs/COMMENTS.md`.
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
| UI | "Wow" bar — designed with the impeccable skill; world: *tabulato a modulo continuo* (`DESIGN.md`) |

Non-goals v1: barcode scanning, automatic receipt ingestion (e-mail/bank),
shared/community prices, multi-currency, budgeting, native app stores.
