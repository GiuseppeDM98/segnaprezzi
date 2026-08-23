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
- **Receipt import**: digital receipt (PDF) or photo → `/api/extract-receipt` → per-line extraction with `claude-haiku-4-5` (PDF as a native `document` block) → alias/fuzzy match to the catalog → review → N entries `source='receipt'`. The file is hashed and dropped, never stored; aliases are learned on confirm so the next receipt from that chain resolves itself. Identical printed lines are folded into one observation carrying their combined `quantity`, so a till that repeats an article weighs the same as one that prints "2 x". The review screen reconciles live against the printed total — each card states its own `prezzo × confezioni`, the header states the signed difference, and when that difference is exactly N packages of one line it names that line, which is how a model's miscount of a repeated article gets caught.
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

**A price the server refused and the screen could not name.** Confirming a
receipt failed with "Il prezzo non è valido" while the bar read "5 pronte ·
0 da sistemare". Diagnosed against the owner's real receipt: the culprit was
"FAZZ.COOP 9X30PZ" — 3,09 € for 270 pieces is 0,01144 € each, and
`unit_price_milli` is an integer, so the closest storable value (11) multiplies
back to 2,97 €. The invariant `unitPriceMilli × packageSize =
totalPriceCents × 10` was checked against a FIXED one-cent slack, so the app
refused its own arithmetic — the tolerance now scales with the package size
(`max(10, packageSize / 2)` milli, the quantization it inherits). A second,
independent way into the same rejection was fixed with it: a weighed line
prints the €/kg from BEFORE its discount, and that value was preferred over
the derived one unconditionally; it is now preferred only when it multiplies
out to what was actually paid. The predicate itself lives once, in
`domain/money.ts` (`isUnitPriceConsistent`), because a server-side assertion
the client cannot evaluate is a rejection nobody can act on. The card now
names what it is missing in its amber banner (with "ricalcola il prezzo
unitario" for the one case arithmetic can fix), confirm is deliberately no
longer disabled — pressing it scrolls to the offending card, as on the
capture review — and the E2E asserts the guarantee rather than the button
state: pressing confirm with an unfinished line writes nothing.

**The totals did not add up because the model invented a line.** Same
receipt: six printed "PESTO GEN.COOP 1,64" lines came back as seven, which
is exactly the 1,64 € the review could not account for. Nothing per-line can
see that — each line is plausible, the confidences were 0.9, and the fold
into one card hides the miscount behind a stepper — so the fix is the
document's own invariant, the printed total. `suggestExtraPackages` (pure,
tested) reports when the gap is an exact multiple of one line's package
price and no second line explains it, and the header says which line to
check; one tap on its stepper closes the gap. That only works because the
header now reconciles against the lines **as edited**: a difference that
cannot move is not actionable. Two prompt attempts did not fix the miscount
(rules and a worked example in the exact shape are kept — true and cheap,
but verified insufficient), which is the honest state: the model is
unreliable here, the arithmetic is not. Each card also shows its own line
total (`prezzo × confezioni`), the number actually printed on the paper —
a card standing for ten identical lines used to show 1,65 € against a
receipt that says 16,50 €.

**The home screen's quick actions on a wide window.** Perfect on a phone,
adrift on a desktop: the 2+1 grid kept its 448 px cap, so three secondary
buttons sat in the left half of a 1024 px column with the receipt one
spanning two cells for no nameable reason. From `tablet` up the section is a
wrapped row of content-sized buttons instead (`DESIGN.md` → Layout); the
phone layout is byte-for-byte what it was. Measured, not eyeballed: four
viewports (390 / 820 / 1088 / 1440), both dashboard states, screenshots plus
the `scrollWidth > clientWidth` check.

**Verified:** `typecheck` / `build` green and Biome clean on every touched
file; **377** unit/integration tests (40 files) and **96** Playwright tests,
the latter including the whole capture and receipt flows asserted against
`/api/export`, a product delete that must leave no orphaned entry behind, two
identical receipt lines landing as one observation bought twice, a receipt
whose invented line the header must name, and the axe sweep over every screen
in both themes and both viewports. Any UI work ends with the same audit:
screenshots at 390 / 820 / 1088 / 1440 plus a scripted
`scrollWidth > clientWidth` check on each route — it is what found a 117 px
horizontal overflow no screenshot suggested. Note for the next session:
`pnpm lint` currently fails on this machine for files nobody touched, whose
worktree copies are CRLF against an LF index (AGENTS.md §4.31); CI, which
checks out LF, is unaffected.

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
