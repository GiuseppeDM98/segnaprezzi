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

## 2. Architecture (spec: 00-overview §5, rules: docs/DEVELOPMENT_GUIDELINES.md)

Routes / Server Actions / route handlers (thin: Zod validation, i18n, error
mapping) → services (`src/lib/services/`, use cases) → repositories
(`src/lib/db/repositories/`, Drizzle only) and gateways (`src/lib/ai/`,
`src/lib/blob/`). The inflation engine (`src/lib/inflation/`) is pure — zero
I/O, no imports from db/ai/next, heavily unit-tested. The offline photo queue
(`src/lib/offline/`, Dexie/IndexedDB) is client-side with a sync manager.

---

## 3. Features / modules

- **Tag scanning + AI extraction** (Spec 03, implemented): camera → WebP ≤400 KB → Vercel Blob → `claude-haiku-4-5` → review screen → confirm. Nothing hits the DB unconfirmed.
- **Personal CPI engine** (Spec 04, implemented): matched-model relatives, Jevons within category, expenditure-weighted across categories, chained index base=100, carry-forward imputation, coverage stats, top movers; `rebaseIstat` + committed `data/istat-nic.json` (1996-01 → latest, base 2025=100, refreshed by `pnpm istat:update`).
- **Quick entry** (Spec 03, implemented): manual form (`/add/manual`, g/mL converted client-side) and fuel form (`/add/fuel`) with four quick picks — benzina, diesel, GPL, metano. Metano is sold per **kilogram**, so each pick carries its own `unit_kind`; renaming a pick's canonical name after entries exist is a data migration, not a copy edit.
- **Receipt import** (Spec 07, implemented): digital receipt (PDF) or photo → `/api/extract-receipt` → per-line extraction with `claude-haiku-4-5` (PDF as a native `document` block) → alias/fuzzy match to the catalog → review → N entries `source='receipt'`. The file is hashed and dropped, never stored; aliases are learned on confirm so the next receipt from that chain resolves itself.
- **Dashboard + product histories** (Spec 05, implemented): index hero, trend chart with ISTAT overlay, category breakdown, top movers, per-product price history, catalog with merge, timeline, stores, settings — all in the design system recorded in `DESIGN.md`.
- **Offline-first PWA** (Spec 06, implemented): Serwist service worker (NetworkFirst pages with a locale-aware `/offline` fallback, NetworkOnly `/api/*`, SWR photo thumbnails, CacheFirst hashed assets), web app manifest + generated icon set, and the sync engine in `src/lib/offline/sync.ts` — 1/2/4/8 s backoff, five attempts, concurrency 2 under a Web Lock, drains on start / `online` / tab focus / enqueue / Background Sync. Install experience and the SW update toast live in `src/components/pwa/`.
- **Auth + multi-user isolation** (Spec 02, implemented): Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here — this section is the
current state of the codebase, not a journal.)*

**Latest (2026-08-21, Spec 07): one receipt becomes N observations, and the
app learns the abbreviations.** `POST /api/extract-receipt` takes one file
(PDF, WebP or JPEG, ≤ 5 MB, ≤ 10 PDF pages, checked by declared type *and*
magic bytes), hashes it, sends it to `claude-haiku-4-5` — a PDF as a native
`document` block, so no PDF library exists in this repo — and hands back one
reviewable draft per product line. **The file itself is never stored**
(Spec 07 §5): what survives is `receipts.content_hash` (idempotency) and
`receipts.ai_raw_json`, every `rawLine` included, which is the audit trail
that replaces the document. `price_entries.photo_url` stays NULL for receipt
entries.

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
`price_entries.receipt_id`. `ENTRY_SOURCES` gained `'receipt'`;
`listEntriesForIndex` now maps the real `quantity` column instead of Spec
04's placeholder constant, and the export is at `schemaVersion 2` with
`receipts` (without `aiRawJson`) and `productAliases`.

Screens: `/add/receipt` (dropzone + store picker, disabled offline with no
queue — a PDF never originates in an aisle) and `/add/receipt/review`, which
loads from the **server** rather than from Dexie, so a reload resumes the
same import and an alias learned a minute ago in another tab already
applies. Each line card shows its `rawLine` verbatim, a "Ricorda questa
riga" toggle, the same-day duplicate hint, and an exclude toggle;
`/products/[id]` lists the learned aliases with a delete.

Verified: `pnpm lint`/`typecheck`/`build` green; **351** unit/integration
tests (40 files, 88 new — the alias table, the unit-price derivation table,
the Rome wall-clock parser, the gateway's request shape and failure mapping,
the resolution precedence, both idempotency branches and the transactional
confirm); **91** Playwright tests, including `receipt-import.spec.ts`
(upload → review → fix the `needs-size` line → confirm → assert on
`/api/export`, then a real un-mocked re-upload answered `409
RECEIPT_ALREADY_IMPORTED` by the hash check before the gateway) and
`/add/receipt` in the axe sweep, both themes, both viewports. The fixture PDF
is generated by `pnpm receipt:fixture` with invented product names
(fenicottero, ornitorinco, quokka) — a real receipt must never enter this
repository. Spec 07's DoD listed "second import from the same chain resolves
by itself" as a manual check; it is automated instead, in
`import-receipt.test.ts`.

Deliberate deviations from Spec 07's literal text, all inline in the code:
§7.4 assigns `needs-product` to lines with **no** candidate and leaves an
ambiguous one (a suggestion at 0.5, below the 0.7 preselect bar) as `ready` —
that is backwards for the only failure that costs anything, so the
implementation blocks on *no preselected product among candidates* and lets a
genuinely unknown line through as a new product (which `resolveProductPicks`
still dedupes by normalized name); §2.5's alias upsert cannot use
`onConflictDoUpdate`, because SQLite treats NULLs as **distinct** in a unique
index and two chain-less aliases therefore never collide — the repository
reads before it writes, inside the caller's transaction; §10 names the
history chip key `history.source.receipt`, but the shipped key tree has
always been `productDetail.source.*`, so that is where it went; the review
screen is `page.tsx` + a colocated client screen, the convention every other
Spec 05 screen follows; and §1.2's `merge-products.ts` /
`export-user-data.ts` are this repo's `db/repositories/products.ts` and
`services/export.ts`. AGENTS.md §4.49–§4.52 hold the session's gotchas.

**Not yet done / carried over — all of it now owned by Spec 08 §7.2.** The
WORKFLOW.md guided collaudo has not been walked through in chat for Spec 05,
06 *or* 07; the automated half (axe, Lighthouse, E2E, unit) is done for all
three. Rather than repeat the same twenty minutes with a phone three times
against localhost, the accumulated manual checks were folded into the go-live
session, where they can run once against the live instance. They are: the look-and-feel pass on a real phone
(390 px, both themes), the FAB→camera morph with a real camera, installing
the app from Chrome and from iOS Safari, the maskable icons on a real
launcher, a Background Sync drain after the tab is closed on Chromium, and —
new with this milestone — **one real Coop/Esselunga/Conad PDF read by the
real model**, which is the only thing that can say whether the §6.1 prompt
holds up on discount-line attribution and abbreviation disambiguation. Still
open from Specs 01–03: Vercel project connection/deploy and a real
`BLOB_READ_WRITE_TOKEN` / `ANTHROPIC_API_KEY` (placeholders in
`.env.local`), so neither `/api/extract` nor `/api/extract-receipt` has ever
run against Anthropic — every test seeds or mocks the extraction.

Next step: **Spec 08** (go-live & operations), the last unimplemented spec.
It was meant to precede Spec 06 in the 01 → 02 → (03 ∥ 04) → 05 → 08 → 06 →
07 order and has been deferred twice for the same reason: it provisions live
infrastructure (Turso, Vercel, Blob, Anthropic) and needs the owner's
accounts, which no coding session can stand in for. Neither Spec 06 nor
Spec 07 has a runtime dependency on it — only the real-device and real-model
checks above wait for a deployment.

Spec 08 was **rewritten for a single environment** at the end of this session
(its §1.1 records the reasoning): no preview database, no preview Blob store,
no preview-scoped secrets, and `vercel.json` limiting deployments to `main`.
With one user, one branch and a Playwright suite that already runs against a
real production build locally, the second environment bought ordering rules
and rotation work rather than safety. The consequence worth knowing: the
whole spec now changes **no file under `src/`** — the previous revision needed
`env.ts` and `auth.ts` to cope with a per-deployment hostname.

| Milestone | Status |
|---|---|
| Spec 01 — Foundation & Scaffold | ☑ |
| Spec 02 — Database & Auth | ☑ |
| Spec 03 — Capture & AI Extraction | ☑ |
| Spec 04 — Inflation Engine | ☑ |
| Spec 05 — UI & Design System | ☑ |
| Spec 06 — PWA & Offline | ☑ |
| DESIGN.md (generated after Spec 05) | ☑ |
| Spec 07 — Receipt Import | ☑ |
| Spec 08 — Go-live & Operations | ☐ |

*Status last updated: 2026-08-21 (Spec 07 implemented).*

**INSTRUCTION**: whoever completes a milestone updates this table and the date
above **in the same commit** as the milestone.

---

## 5. Session protocol

1. **Before any coding**, read: `AGENTS.md`, the spec being implemented
   (`docs/specs/`), `docs/DEVELOPMENT_GUIDELINES.md`, and `docs/COMMENTS.md`.
2. Canonical table/column/route/env names live in `docs/specs/00-overview.md`
   — use them exactly. Money is integer only: `total_price_cents` (euro
   cents), `unit_price_milli` (milli-euros per base unit kg/L/piece).
3. **One spec per session**, in order 01 → 02 → (03 ∥ 04) → 05 → 08 → 06 → 07, using the
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
   | 08 | Claude Sonnet 5 | high |

4. **Never contradict 00-overview.** If a spec must deviate, change
   `docs/specs/00-overview.md` (and the spec file) in the same PR as the code.
5. **Quality gates before every commit**: `pnpm lint`, `pnpm typecheck`,
   `pnpm test` — all green (scripts defined in Spec 01). Playwright E2E before
   completing Specs 05–06.
6. **Conventional commits** (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`);
   subject ≤72 chars, imperative, no period.
7. **End of session**: write `SESSION_NOTES.md` (Cosa / Perché / Nota), use it
   to fold the session's findings into this file, `AGENTS.md` and
   `Draft Release Temp.md`, then delete it. It is a scratch handoff, never
   committed — the durable docs are where the reasoning has to end up.
8. UI work: `DESIGN.md` is the authoritative design spec (and `PRODUCT.md`
   the product truth the impeccable skill reads) — read it before touching
   any UI.

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
| UI | "Wow" bar — designed with the impeccable skill; world: *tabulato a modulo continuo* (`DESIGN.md`) |

Non-goals v1: barcode scanning, automatic receipt ingestion (e-mail/bank),
shared/community prices, multi-currency, budgeting, native app stores.
