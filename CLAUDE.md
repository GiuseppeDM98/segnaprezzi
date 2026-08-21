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
- **Personal CPI engine** (Spec 04, implemented): matched-model relatives, Jevons within category, expenditure-weighted across categories, chained index base=100, carry-forward imputation, coverage stats, top movers; `rebaseIstat` + committed `data/istat-nic.json` (1996-01 → latest, base 2025=100, refreshed by `pnpm istat:update`).
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

**Latest (2026-08-21, Spec 04): the personal inflation engine is implemented.**
`src/lib/inflation/` holds the pure engine exactly as Spec 04 §2 lays it out
(`types`, `bucketing`, `relatives`, `weights`, `chain`, `coverage`, `movers`,
`istat`, `index` barrel, plus `fixtures.ts` for the tests): Europe/Rome month
bucketing, per-product monthly means with the promo-only fallback,
observation-anchored carry-forward, matched-model relatives clamped to
`[0.2, 5]`, Jevons in log space over sorted product ids, trailing-12-month
expenditure weights (× `quantity`, promos always counted, renormalized over
matched categories, equal-weight fallback), forward-only chaining with flat
months flagged, per-category series, headline, coverage and top movers. 64
colocated tests cover every row of the §7 table — the §6 worked example
reproduces to 4 decimals (102.5149 / 103.6355 / 103.2405, both category
series, coverage 0.1667, the three movers), the seeded constant-price property
test (50 fixtures) and the shuffled-input `toStrictEqual` test pass, and a
purity test greps the folder for forbidden imports; line coverage of the
engine is 100%. Around it: `listProductsForIndex`, `listEntriesForIndex` now
mapping `quantity`, the thin service `getPersonalCpi(db, userId)` with an
integration test, `scripts/update-istat.ts` + `scripts/istat-nic.ts` (pure
SDMX decoding, base linking and serialization, tested offline), the
`istat:update` script, `data/istat-nic.json` fetched from the live ISTAT
service (367 months, 1996-01 → 2026-07, base 2025=100 with the 1995/2010/2015
bases chain-linked), and the optional monthly refresh workflow
`.github/workflows/update-istat.yml`. Whole suite: 190 unit/integration tests,
`pnpm lint`/`typecheck`/`build` green; the E2E suite was not re-run (no UI
changed).

Three verified corrections to Spec 04's literal text, with inline notes in
`docs/specs/04-inflation-engine.md` (search "Correction") and `AGENTS.md`
§4.27–§4.29:

1. **`getPersonalCpi(db, userId)`** — `db` first like every service, and no
   React `cache()` inside the service (services never import `react`); the
   Spec 05 dashboard page wraps the call in `cache()` itself.
2. **`quantity` is a constant `1` in `listEntriesForIndex`** until Spec 07's
   migration adds the column; the engine already multiplies by it.
3. **ISTAT endpoint**: the spec's base-2015 dataflow is frozen at 2025-12;
   the script reads `IT1,167_745,1.0` key `M.IT..4.00` (all bases) with
   `Accept: application/json` + `Accept-Language: en` and chain-links the
   bases onto 2025=100 — `format=jsondata` returns nulls and Node's default
   `accept-language: *` gets an HTTP 500.

**Not yet done for Spec 04:** nothing renders the index yet — the dashboard
(Spec 05) is the first consumer of `getPersonalCpi` and `rebaseIstat`. The
WORKFLOW.md guided collaudo for this milestone has not been walked through
in chat; the engine has no UI and its behaviour is fully covered by the
automated suite, which is the half of the collaudo that can be automated.

**Carried over from Specs 01–03 (still open):** Vercel project
connection/deploy, and with it a real `BLOB_READ_WRITE_TOKEN` — `.env.local`
still holds placeholders for it and for `ANTHROPIC_API_KEY`, so `/api/extract`
cannot be exercised against the real Blob store or the real model yet
(everything else runs locally; the E2E suite intercepts that one route).
`/history`, `/products`, `/stores` and `/settings` are Spec 05 screens and do
not exist yet — the quick-entry forms redirect to `/` after saving. The Spec 03
guided collaudo was executed and passed on 2026-08-21 (six phases, 63
automated checks plus the E2E suite); its per-phase record and the six Spec 03
corrections live in git history (commit `05f7352`), in
`docs/specs/03-capture-ai.md` (search "Correction") and in `AGENTS.md`
§4.22–§4.26 — read those before touching an `actions.ts`, the seed ids, or the
E2E suite.

Next step: implement **Spec 05** (UI & Design System) with the impeccable
skill, using the Implementation Prompt at the end of its spec file — Specs
02–04 are all in place, so the dashboard can render `getPersonalCpi` and the
ISTAT overlay for real.

| Milestone | Status |
|---|---|
| Spec 01 — Foundation & Scaffold | ☑ |
| Spec 02 — Database & Auth | ☑ |
| Spec 03 — Capture & AI Extraction | ☑ |
| Spec 04 — Inflation Engine | ☑ |
| Spec 05 — UI & Design System | ☐ |
| Spec 06 — PWA & Offline | ☐ |
| DESIGN.md (generated after Spec 05) | ☐ |
| Spec 07 — Receipt Import | ☐ |

*Status last updated: 2026-08-21 (Spec 04 implemented).*

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
