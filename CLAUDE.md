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
- **Auth + multi-user isolation** (Spec 02): Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

**Spec 01 implemented.** Next.js 16 App Router scaffold with pnpm, Biome,
TypeScript 7 strict mode, the canonical folder layout, `src/lib/env.ts`
(Zod-validated), next-intl routing (`it` default + `en`), the theming
foundation (`globals.css` tokens, no-flash dark-mode script), `src/lib/errors.ts`
error primitives, Vitest + Playwright rigs, and CI (`.github/workflows/ci.yml`).
No database, auth, camera, or inflation math — rails only, per spec scope.
Not yet done: Vercel project connection/deploy (no account access this
session) — do this before Spec 02 needs a live preview.
Next step: implement **Spec 02** using the Implementation Prompt at the end of
its spec file.

| Milestone | Status |
|---|---|
| Spec 01 — Foundation & Scaffold | ☑ |
| Spec 02 — Database & Auth | ☐ |
| Spec 03 — Capture & AI Extraction | ☐ |
| Spec 04 — Inflation Engine | ☐ |
| Spec 05 — UI & Design System | ☐ |
| Spec 06 — PWA & Offline | ☐ |
| DESIGN.md (generated after Spec 05) | ☐ |
| Spec 07 — Receipt Import | ☐ |

*Status last updated: 2026-08-21 (Spec 01 implemented).*

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
