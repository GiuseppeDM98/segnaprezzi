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
- **Receipt import**: digital receipt (PDF) or photo → `/api/extract-receipt` → per-line extraction with `claude-haiku-4-5` (PDF as a native `document` block) → alias/fuzzy match to the catalog → review → N entries `source='receipt'`. The file is hashed and dropped, never stored; aliases are learned on confirm so the next receipt from that chain resolves itself.
- **Dashboard + product histories**: index hero, trend chart with ISTAT overlay, category breakdown, top movers, per-product price history, catalog with merge, timeline, stores, settings — all in the design system recorded in `DESIGN.md`.
- **Offline-first PWA**: Serwist service worker (NetworkFirst pages with a locale-aware `/offline` fallback, NetworkOnly `/api/*`, SWR photo thumbnails, CacheFirst hashed assets), web app manifest + generated icon set, and the sync engine in `src/lib/offline/sync.ts` — 1/2/4/8 s backoff, five attempts, concurrency 2 under a Web Lock, drains on start / `online` / tab focus / enqueue / Background Sync. Install experience and the SW update toast live in `src/components/pwa/`.
- **Auth + multi-user isolation**: Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here — this section is the
current state of the codebase, not a journal.)*

**Receipt import: one receipt becomes N observations, and the app learns the
abbreviations.** `POST /api/extract-receipt` takes one file (PDF, WebP or
JPEG, ≤ 5 MB, ≤ 10 PDF pages, checked by declared type *and* magic bytes),
hashes it, sends it to `claude-haiku-4-5` — a PDF as a native `document`
block, so no PDF library exists in this repo — and hands back one reviewable
draft per product line. **The file itself is never stored**: what survives is
`receipts.content_hash` (idempotency) and `receipts.ai_raw_json`, every
`rawLine` included, which is the audit trail that replaces the document.
`price_entries.photo_url` stays NULL for receipt entries.

The value of the feature is the *matching*, not the transcription.
`resolveReceiptLines` (pure) tries, in order: an alias the user taught the
app on a previous receipt (chain-scoped, then chain-less, then any chain), a
fuzzy match run **twice** — once on the model's readable expansion and once
on the printed abbreviation, union deduplicated — and finally a new-product
draft. `deriveUnitPriceMilli` (pure) turns the printed columns into the
`(quantity, packageSize, totalPriceCents, unitPriceMilli)` quadruple the
entry contract wants: a weighed line ("0,812 kg x 1,49") is one package of
its own weight, a counted line ("2 x 1,09") is `total ÷ quantity` per
package, and the size comes from the description, else
`products.default_package_size`, else the user. `confirmReceipt` is one
transaction: it re-checks the price invariant server-side, inserts the
entries with `source 'receipt'` + `receipt_id` + `quantity`, learns the
aliases from the **stored** `rawLine` (never from the request), back-fills
`default_package_size`, and marks the receipt confirmed — idempotently, so a
retried confirm returns the existing entry ids.

Schema is at migration **0001**: `receipts`, `product_aliases`,
`products.default_package_size` (back-filled in the same migration from each
product's newest observation), `price_entries.quantity` (default 1) and
`price_entries.receipt_id`. `ENTRY_SOURCES` includes `'receipt'`;
`listEntriesForIndex` maps the real `quantity` column, and the export is at
`schemaVersion 2` with `receipts` (without `aiRawJson`) and `productAliases`.

Screens: `/add/receipt` (dropzone + store picker, disabled offline with no
queue — a PDF never originates in an aisle) and `/add/receipt/review`, which
loads from the **server** rather than from Dexie, so a reload resumes the
same import and an alias learned a minute ago in another tab already
applies. Each line card shows its `rawLine` verbatim, a "Ricorda questa
riga" toggle, the same-day duplicate hint, and an exclude toggle (icon: a
plain `X`, not a "more options" glyph — it is a direct one-tap action, not a
menu); `/products/[id]` lists the learned aliases with a delete.

A line with no matching catalog candidate becomes a new product (deduped by
normalized name against the existing catalog); a line where the matcher
found candidates but none confident enough is blocked as `needs-product`
rather than silently accepted — an unreviewed duplicate product is worse
than one extra tap, and a duplicate removes that product from every
month-over-month index relative it should have contributed to. Aliases are
keyed `(user_id, alias, store_chain)`, but SQLite treats NULLs as **distinct**
inside a unique index, so a chain-less alias upsert cannot rely on
`ON CONFLICT` — the repository reads before it writes, inside the caller's
transaction.

The extraction prompt (`src/lib/ai/receipt-prompt.ts`) was refined after
reading a real Coop receipt: a discount line that repeats the receipt's own
VAT% column (`SCONTO % CLIE 40.00%    4,00%    -1,92`) was being extracted
as its own zero-price "product" instead of being folded into the line above
it — a second worked example now shows that exact shape. The same receipt
also showed the model guessing "F/F" as "farina di frumento" when it is
actually Coop's "Fior Fiore" private-label marker — the ambiguous-abbreviation
rule now carries that as a concrete counter-example. Both are prompt-text
changes only; nothing in the schema, resolution logic, or database moved. A
prompt change cannot be regression-tested the way pure code can — the next
real receipt from this failure family is the actual test.

Verified: `pnpm lint`/`typecheck`/`build` green; **351** unit/integration
tests (40 files) covering the alias table, the unit-price derivation table,
the Rome wall-clock parser, the AI gateway's request shape and failure
mapping, the resolution precedence, both idempotency branches and the
transactional confirm; **91** Playwright tests, including an upload → review
→ fix a `needs-size` line → confirm flow asserted against `/api/export`,
a re-upload of an already-confirmed receipt correctly rejected before the
gateway is even called, and the receipt screen in the axe accessibility
sweep, both themes, both viewports. The fixture PDF (`pnpm receipt:fixture`)
uses invented product names (fenicottero, ornitorinco, quokka) — a real
receipt must never enter this repository. "Second import from the same
chain resolves by itself" is covered by an automated test
(`import-receipt.test.ts`), not a manual check.

Two naming notes worth knowing: the history/product-detail source-icon chip
key lives under `productDetail.source.*` (not a `history.*` namespace some
earlier notes expected); merging duplicate products and exporting a user's
full data live in `db/repositories/products.ts` and `services/export.ts`
respectively. AGENTS.md §4.49–§4.52 hold further gotchas from this area.

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
