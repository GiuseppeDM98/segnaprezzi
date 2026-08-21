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
- **Receipt import** (Spec 07): digital receipt (PDF) or photo → `/api/extract-receipt` → per-line extraction with `claude-haiku-4-5` → alias/fuzzy match to the catalog → review → N entries `source='receipt'`. File never stored; aliases learned on confirm.
- **Dashboard + product histories** (Spec 05, implemented): index hero, trend chart with ISTAT overlay, category breakdown, top movers, per-product price history, catalog with merge, timeline, stores, settings — all in the design system recorded in `DESIGN.md`.
- **Offline-first PWA** (Spec 06, implemented): Serwist service worker (NetworkFirst pages with a locale-aware `/offline` fallback, NetworkOnly `/api/*`, SWR photo thumbnails, CacheFirst hashed assets), web app manifest + generated icon set, and the sync engine in `src/lib/offline/sync.ts` — 1/2/4/8 s backoff, five attempts, concurrency 2 under a Web Lock, drains on start / `online` / tab focus / enqueue / Background Sync. Install experience and the SW update toast live in `src/components/pwa/`.
- **Auth + multi-user isolation** (Spec 02, implemented): Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here — this section is the
current state of the codebase, not a journal.)*

**Latest (2026-08-21, Spec 06): the app is a real PWA and the queue drains
itself.** Serwist is wired in `next.config.ts` (`register: false`, disabled in
dev) and `src/app/sw.ts` implements Spec 06 §2.3's strategy table exactly:
precached build assets, NetworkFirst pages (3 s timeout) with a locale-aware
fallback to the precached `/offline` and `/en/offline` pages, **NetworkOnly**
for `/api/*` so per-user data can never sit in a shared cache, LRU-50
StaleWhileRevalidate for Vercel Blob thumbnails, CacheFirst for
`/_next/static`. `src/app/manifest.ts`, the dual `themeColor` viewport and the
icon metadata complete the install contract; `scripts/generate-icons.ts`
(`pnpm icons`) renders the five PNGs and `favicon.ico` from
`docs/assets/logo.svg` into `public/` (committed), on the **paper** plate —
the mark itself is the accent, so an accent plate erased it.

The sync engine (`src/lib/offline/sync.ts`) owns the state machine: a drain
claims only *due* photos, two at a time, under the `segnaprezzi-sync` Web
Lock (so the page and the service worker's Background Sync handler can both
call it), counts the attempt at claim time, and on failure either reschedules
with the 1/2/4/8 s backoff or parks the photo as `failed` after five
attempts; `startSyncEngine()` resets interrupted uploads to `queued` at
startup, listens on `online` and `visibilitychange`, and observes new photos
through a Dexie `creating` hook so Spec 03's capture flow keeps calling
Spec 03's primitive. Dexie is at **version 2** (`nextAttemptAt`,
`lastErrorMessage`, and the `syncMeta` table holding `lastSyncAt`).

Every offline surface is now live rather than polled: `OfflineBanner`, the
Scan `QueueStatusLine` ("3 in coda · 1 in elaborazione", plus a red segment
and "Riprova tutti"), the Review screen (extracted cards appear as statuses
flip; photos still travelling show as pending cards with their own
thumbnail), the Dashboard `CachedDataBanner`, the Settings `InstallRow`, the
contextual `InstallSheet` / `IosInstallSheet` (30-day cooldown, 2 prompts for
life) and the `SwUpdateToast` (never auto-reloads: `SKIP_WAITING` only on
"Aggiorna", one reload on `controllerchange`). `offline.*` and `pwa.*` keys
are in both message files.

Verified: `pnpm lint`/`typecheck` green; **263** unit/integration tests (34
files, including 10 for the sync engine against `fake-indexeddb`); **85**
Playwright tests across **four** projects — `mobile`, `desktop`, and the new
`offline-queue` (service worker blocked, `/api/extract` mocked: capture in
airplane mode, queue survives a reload with nothing stuck, drain on
reconnect + confirm into the DB, five failures → `failed` → manual retry with
the same client id) and `pwa` (service worker live: both locale fallbacks,
manifest + icons, `/sw.js`, `/api/*` absent from every Cache Storage entry,
both theme-color metas). The whole suite now runs against `pnpm build &&
pnpm start`. Lighthouse (mobile emulation, authenticated, local dev machine):
accessibility **100** on `/`, `/settings`, `/history`, `/scan`; best
practices and SEO **100** on `/`; performance 87–89 on `/`, 86 on
`/settings`, 91 on `/scan`, 94 on `/history` — the ≥90 target is missed on
two routes, and the LCP breakdown says why (TTFB 0.46 s, **render delay
3.35 s**): the largest text only exists once the screen's client component
hydrates under Lighthouse's 4× CPU throttle. Nothing Spec 06 added is in that
path; re-measure on Vercel during Spec 08 before treating it as a defect.

Corrections to Spec 06's literal text are inline (search "Correction"): the
production build must be `next build --webpack` (Turbopack silently skips
Serwist); the precache manifest holds no HTML, so both `/offline` pages need
`additionalPrecacheEntries`; the PWA colors are DESIGN.md's
(`#faf5eb` / `#121017` / `#db640e`), not the spec's originals; the icon plate
is paper; only 1/2/4/8 s of the backoff can elapse; a drain returns
immediately when `navigator.onLine === false`; confirm stays blocked while a
photo is still travelling (confirming clears the queue, so a mid-flight photo
would be destroyed); `offline.retry` was dropped as a duplicate of
`scan.tray.retry`; one production `webServer` for the whole suite, with the
new projects on their own throwaway account; the sync unit tests fake `Date`
only; Lighthouse 12 no longer scores installability. AGENTS.md §4.39–§4.48
hold the session's gotchas.

**Not yet done / carried over:** the WORKFLOW.md guided collaudo has still
not been walked through in chat for Spec 05 *or* Spec 06 — the automated half
(axe, Lighthouse, E2E, unit) is done for both. What is left for the owner is
what no headless run can judge: the look-and-feel pass on a real phone
(390 px, both themes), the FAB→camera morph with a real camera, and — new
with this milestone — installing the app from Chrome and from iOS Safari,
the maskable icons on a real launcher, and a Background Sync drain after the
tab is closed on Chromium. Still open from Specs 01–03: Vercel project
connection/deploy and a real `BLOB_READ_WRITE_TOKEN` / `ANTHROPIC_API_KEY`
(placeholders in `.env.local`), so `/api/extract` still cannot be exercised
against the real model — every offline scenario mocks it.

Next step: **Spec 08** (go-live & operations), then Spec 07 (receipt import).
Spec 08 was meant to precede Spec 06 in the 01 → 02 → (03 ∥ 04) → 05 → 08 →
06 → 07 order; it was skipped this session because it provisions live
infrastructure (Turso, Vercel, Blob, Anthropic) and needs the owner's
accounts, which no coding session can stand in for. Spec 06 has no runtime
dependency on it — only the real-device checks above wait for a deployment.

| Milestone | Status |
|---|---|
| Spec 01 — Foundation & Scaffold | ☑ |
| Spec 02 — Database & Auth | ☑ |
| Spec 03 — Capture & AI Extraction | ☑ |
| Spec 04 — Inflation Engine | ☑ |
| Spec 05 — UI & Design System | ☑ |
| Spec 06 — PWA & Offline | ☑ |
| DESIGN.md (generated after Spec 05) | ☑ |
| Spec 07 — Receipt Import | ☐ |
| Spec 08 — Go-live & Operations | ☐ |

*Status last updated: 2026-08-21 (Spec 06 implemented).*

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
