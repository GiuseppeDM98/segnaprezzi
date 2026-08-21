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

- **Tag scanning + AI extraction** (Spec 03, implemented): camera → WebP ≤400 KB → Vercel Blob → `claude-haiku-4-5` → review screen → confirm. Nothing hits the DB unconfirmed.
- **Personal CPI engine** (Spec 04): matched-model relatives, Jevons within category, expenditure-weighted across categories, chained index base=100, carry-forward imputation, coverage stats.
- **Quick entry** (Spec 03, implemented): manual form (`/add/manual`, g/mL converted client-side) and fuel form (`/add/fuel`) with four quick picks — benzina, diesel, GPL, metano. Metano is sold per **kilogram**, so each pick carries its own `unit_kind`; renaming a pick's canonical name after entries exist is a data migration, not a copy edit.
- **Receipt import** (Spec 07): digital receipt (PDF) or photo → `/api/extract-receipt` → per-line extraction with `claude-haiku-4-5` → alias/fuzzy match to the catalog → review → N entries `source='receipt'`. File never stored; aliases learned on confirm.
- **Dashboard + product histories** (Spec 05): index hero, trend chart, category breakdown, top movers, per-product price history.
- **Offline-first PWA** (Spec 06): Serwist and the sync scheduler. The IndexedDB photo queue itself (`src/lib/offline/`) already ships with Spec 03; Spec 06 decides *when* it drains.
- **Auth + multi-user isolation** (Spec 02, implemented): Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here — this section is the
current state of the codebase, not a journal.)*

**Latest (2026-08-21, Spec 03): the capture pipeline is live end to end.**
On top of Spec 02's DB and auth, a photo now becomes a confirmed
`price_entries` row: in-app camera (`getUserMedia` + framing guide, file-input
fallback), client-side WebP compression (≤1600 px, ≤400 KB), a Dexie offline
queue keyed on the client-generated nanoid that later becomes the entry id and
the Blob path, `POST /api/extract` (Vercel Blob upload → `claude-haiku-4-5`
via `messages.parse` + `zodOutputFormat` → cross-check → top-3
Sørensen–Dice product suggestions), an editable review screen, and a
transactional, idempotent `confirmShoppingSession`. The two non-photo paths
ship too: `/add/manual` (g/mL converted client-side, live unit price with
override + 2% warning) and `/add/fuel` (four quick picks — benzina, diesel,
GPL, metano — with two-of-three unit price ⇄ quantity ⇄ total, re-validated
server-side to ±1 cent; metano is priced and stored per **kilogram**, so each
pick carries its own `unit_kind` and the form's labels follow it). Thirteen new `DomainErrorCode`s with
their HTTP mapping in the route handler and `errors.*` copy in both locales;
the `categories` and `units` namespaces are now populated. 109 unit tests +
13 Playwright E2E tests green (E2E asserts on `GET /api/export`, i.e. the
database, never on page appearance), alongside `pnpm lint`/`typecheck`/`build`.

Six verified corrections to Spec 03's literal text, all with inline notes in
`docs/specs/03-capture-ai.md` (search "Correction") and `AGENTS.md`
§4.22–§4.26 — read those before touching an `actions.ts`, the seed ids, or
the E2E suite:

1. **Services take `db` first** (`confirmShoppingSession(db, userId, input)`).
   Forced by §9.3, which calls `findOrCreateShoppingSession` inside the confirm
   transaction, and by §13.4, which runs the service against a test database.
   `extractPhotoEntry(input)` keeps its spec signature.
2. **Zod schemas cannot be exported from a `"use server"` module** — Next.js
   allows only async-function exports. The confirm schemas moved to
   `scan/review/schema.ts`; the quick-entry ones are module-local.
3. **Foreign session ids need one deliberately unscoped existence check**
   (`isShoppingSessionIdTaken`), or §2.2's `SessionNotFoundError` surfaces as a
   raw primary-key violation instead.
4. **Seed ids are now padded to 21 characters** (`scripts/seed-ids.ts`).
   Spec 02's readable `'seed-prod-latte'` violated Spec 00 §6's nanoid(21) rule
   and made the review screen reject any suggestion pointing at a seeded
   product. Re-run `pnpm db:seed` after pulling.
5. **Playwright must wait for hydration before `setInputFiles` on `/scan`**,
   and `getByRole('alert')` is never unique (Next's route announcer shares the
   role).
6. **`vitest.config.ts` now pins the test environment variables** — Spec 03
   modules import `src/lib/env.ts`, which fails fast, and no test run may reach
   a real `ANTHROPIC_API_KEY`.

Additions no spec version mentions, all deliberate: `src/lib/domain/schemas.ts`
(shared Zod field shapes, per AGENTS §1.8), `src/lib/services/capture-context.ts`
(read models for the three screens, so pages never touch a repository),
`convertToBaseUnits` in `domain/units.ts` (700 g × 0.001 is
0.7000000000000001 in binary floating point — that noise was reaching
`package_size`), and the repository queries the flow needs
(`listProductsByIds`, `createPriceEntriesIgnoringDuplicates`,
`listPriceEntryIdsBySession`, `getResumableShoppingSession`,
`discardOtherOpenShoppingSessions`).

**Collaudo guidato (2026-08-21) — eseguito e superato.** Walked through with
the project owner in chat, phase by phase, per `WORKFLOW.md`. Fixtures used
invented "parole spia" (fenicottero, ornitorinco, quokka, narvalo) and every
outcome was asserted against the database or an HTTP response, never against
the appearance of a page. Throwaway scripts were deleted and the database
re-seeded at the end.

| Fase | Copertura | Esito |
|---|---|---|
| A — Invarianza | Dataset seed integro dopo il ripadding degli id, tutti gli id a 21 caratteri, nessun denaro non intero, isolamento cross-user; suite E2E Spec 01/02 | 14 controlli + 9 E2E ✅ |
| B — Cambio di contesto | Materializzazione pigra con id del client, `active → reviewing → completed` sul DB, "una sola spesa attiva", idempotenza della ri-conferma; via HTTP reale la route materializza la spesa prima del passo Blob | 14 controlli ✅ |
| C — Comportamento nuovo | Browser reale 390×844: foto → WebP <400 KB → coda → revisione → conferma; form manuale (500 g → `package_size` 0.5 esatto) e carburante (1,899 €/L × 42,5 L → 8071 cent) | 12 controlli ✅ |
| D — Sotto la UI | Tabella §6.2 chiamando `/api/extract` a mano: 401, 400×2, 413, 415, 404, 409, busta d'errore uniforme, nessuna spesa lasciata dietro da una richiesta respinta | 10 controlli ✅ |
| E — Casi negativi | Cinque guard, ciascuno in coppia risorsa-propria/risorsa-altrui con lo stesso identico dato: spesa, prodotto, punto vendita, tipo di punto vendita, coerenza terna carburante | 13 controlli ✅ |
| F — Ripristino | Fixture rimosse, `pnpm db:seed` rieseguito, script usa-e-getta cancellati, esito annotato qui | ✅ |
| Verifica visiva | Le quattro schermate nuove (`/scan`, `/scan/review`, `/add/manual`, `/add/fuel`) guardate su localhost dal project owner: leggibili e usabili con una mano. È un controllo di sanità, non un verdetto estetico — Spec 05 le riprogetta | ✅ |

Due cose emerse dal collaudo, entrambe già applicate: il raffinamento di
`AGENTS.md` §4.19 (una `fetch` Node nuda è respinta anche sul sign-in, non
solo sul sign-out) e la rinomina dei carburanti sopra, richiesta dal project
owner mentre guardava `/add/fuel` su localhost. **Non collaudabile e ancora
aperto:** la chiamata reale a `claude-haiku-4-5` e l'upload reale su Vercel
Blob, che richiedono le due chiavi mancanti — nel collaudo `/api/extract` è
stata intercettata, e il resto della catena è reale.

**Not yet done:** Vercel project connection/deploy, and with it a real
`BLOB_READ_WRITE_TOKEN` — `.env.local` still holds placeholders for it and for
`ANTHROPIC_API_KEY`, so `/api/extract` cannot be exercised against the real
Blob store or the real model yet (everything else runs locally; the E2E suite
intercepts that one route). The WORKFLOW.md guided collaudo has still not been
walked through in chat with the user; the automatable half is covered by the
E2E suite above. `/history`, `/products`, `/stores` and `/settings` are Spec 05
screens and do not exist yet — the quick-entry forms redirect to `/` after
saving.

Next step: implement **Spec 04** (Inflation Engine) using the Implementation
Prompt at the end of its spec file — it is the last piece Spec 05 needs.

| Milestone | Status |
|---|---|
| Spec 01 — Foundation & Scaffold | ☑ |
| Spec 02 — Database & Auth | ☑ |
| Spec 03 — Capture & AI Extraction | ☑ |
| Spec 04 — Inflation Engine | ☐ |
| Spec 05 — UI & Design System | ☐ |
| Spec 06 — PWA & Offline | ☐ |
| DESIGN.md (generated after Spec 05) | ☐ |
| Spec 07 — Receipt Import | ☐ |

*Status last updated: 2026-08-21 (Spec 03 implemented).*

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
7. **End of session**: write `SESSION_NOTES.md` (Cosa / Perché / Nota), use it
   to fold the session's findings into this file, `AGENTS.md` and
   `Draft Release Temp.md`, then delete it. It is a scratch handoff, never
   committed — the durable docs are where the reasoning has to end up.
8. UI work: after Spec 05, `DESIGN.md` is the authoritative design spec — read
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
