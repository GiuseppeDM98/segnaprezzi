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
- **Dashboard + product histories** (Spec 05, implemented): index hero, trend chart with ISTAT overlay, category breakdown, top movers, per-product price history, catalog with merge, timeline, stores, settings — all in the design system recorded in `DESIGN.md`.
- **Offline-first PWA** (Spec 06): Serwist and the sync scheduler. The IndexedDB photo queue itself (`src/lib/offline/`) already ships with Spec 03; Spec 06 decides *when* it drains.
- **Auth + multi-user isolation** (Spec 02, implemented): Better Auth, every query scoped by `user_id`; `SIGNUP_ENABLED=false` closes registration.
- **i18n**: next-intl, `it` + `en`, all routes under `[locale]`.
- **ISTAT comparison**: static `data/istat-nic.json`, refreshed by `scripts/update-istat.ts`.

---

## 4. Current status

*(Per-session history lives in `git log`, not here — this section is the
current state of the codebase, not a journal.)*

**Latest (2026-08-21, Spec 05): the UI & design system is implemented.**
The visual world is the *tabulato a modulo continuo* — the personal index
printed as a continuous-form statement: cream stock and ribbon ink (dark =
the print negative), a punched sprocket margin on the desktop rail,
green-bar `zebra` rows behind every list, Martian Mono tabular figures for
everything the machine printed, Barlow for labels and prose, one
highlighter-orange accent (ink text on it, `accent-ink` for words), red/green
ribbon for price direction (rising = `negative`, falling = `positive`), pink
marker for promo. It was chosen through the impeccable direction roll (seed
`12e30ec0`, re-roll 1 on factual grounds, assigned direction locked by the
owner on the decision page) and is recorded in **`DESIGN.md`** (generated by
the impeccable documenter from the shipped build) with product truth in
**`PRODUCT.md`** — both mandatory reading before UI work.

What exists: `src/app/globals.css` (all tokens, both themes, named
`tablet:`/`rail:`/`desktop:` breakpoints, themed browser surfaces),
`src/lib/format.ts` (+ tests) as the only Intl call site, `src/lib/motion.ts`
(`houseSpring`, `quickFade`, `useAppMotion`), the `ui/` primitives of Spec 05
§6.1 plus `segmented`, `stepper`, `decimal-input`, `section-heading`,
`logo-mark`; the hand-rolled SVG `charts/` (`scale.ts` tested) with sr-only
tables; `layout/` (`AppShell` with tab bar / rail, hide-on-scroll, 150 ms
route cross-fade, `OfflineBanner`, toasts); `capture/` (`CameraView` with
torch, `PhotoTray`, `ExtractionCard`, `MatchPicker`, `StorePickerSheet`);
`entries/EntrySheet`; `auth/AuthForm` (progressive reveal, fields stay
mounted + `inert` so password managers work). Every route of Spec 00 §9
renders with its four states, both themes and both locales: dashboard
(empty / thin / ready, YoY headline with since-start fallback, ISTAT overlay
rebased to the user's base month, category bars, movers with sparklines),
scan (immersive, FAB→viewfinder morph), review (stagger-in cards, disabled
confirm bar that says why, success checkmark), manual and fuel forms (live
derived values, store pickers with inline create), catalog (search, category
chips, archived, merge mode), product detail (chart with promo dots and
range, stats, per-store comparison, entry sheet), history (day groups,
session cards, filters, cursor pagination), stores (CRUD), settings
(account incl. delete, index options, language, theme cookie, export,
import, info), login/signup, locale-aware not-found and route error.

Data layer added for it: `listLatestEntriesPerProduct` (window function),
`listPriceEntriesForProduct`, `countPriceEntriesByStore`, promo/source
filters and the store join on `listPriceEntries`, `upsert*` repositories for
the import; services `catalog`, `product-detail`, `history`, `stores`,
`settings` (import with Zod + ownership guard), `dashboard`
(`loadIndexInputs` shared with `getPersonalCpi`). `scripts/seed.ts` now
seeds **14 months**, a third store (Carrefour) and extra promos (Spec 02 §8
corrected), so the dashboard shows a real YoY headline on seed data.

Verified: `pnpm lint`/`typecheck` green; 253 unit/integration tests (33
files); 76 Playwright tests across two projects (`mobile` 390×844 and the
new `desktop` 1280×900 for smoke + a11y) including `tests/e2e/a11y.spec.ts`
— axe 0 violations on every route in both themes (60 checks); Lighthouse
accessibility **100** on `/`, `/scan`, `/scan/review`, `/settings` (mobile
emulation, authenticated); production build green with the direction
contract present in the emitted markup; impeccable detector clean; the
impeccable finish review ran (disposition `fix`, four material items — three
applied and rescored, one declined because Spec 05 §2.1 assigns `negative`
to destructive actions and failures, see the spec's inline correction).

Corrections to Spec 05's literal text are inline (search "Correction"):
price-direction mapping decided; added tokens `band`, `accent-ink`,
`camera`/`camera-contrast`; `parseDecimalInput` moved from `money.ts` to
`format.ts` with the `number | null` contract; four fuel picks (Spec 03's
correction wins over "exactly three"); the manual form stays on the page
after saving, the fuel form returns to `/`; the camera fallback keeps the
tray, CTA and a close button; account deletion via Better Auth
`user.deleteUser`; import semantics. AGENTS.md §4.31–§4.38 hold the session's
gotchas (CRLF from Python writes, Playwright `PORT` + `BETTER_AUTH_URL`,
axe vs the route cross-fade, fieldset grids, Motion `whileTap` hydration,
`seedId` collisions, labelled file inputs, the sandboxed decision page).

**Not yet done / carried over:** the WORKFLOW.md guided collaudo for this
milestone has not been walked through in chat — the automated half (axe,
Lighthouse, E2E, unit) is done; what remains for the owner is the
look-and-feel pass on a real phone (390 px, both themes) and the FAB→camera
morph with a real camera, which no headless run can judge. Still open from
Specs 01–03: Vercel project connection/deploy and a real
`BLOB_READ_WRITE_TOKEN` / `ANTHROPIC_API_KEY` (placeholders in `.env.local`),
so `/api/extract` still cannot be exercised end to end. `/scan` and the
offline banner render the queue states, but draining the queue is Spec 06's
sync engine.

Next step: **Spec 08** (go-live & operations) per the 01 → 02 → (03 ∥ 04) →
05 → 08 → 06 → 07 order, then Spec 06 (PWA & offline) which drives
`layout/OfflineBanner` and the `offline.*` keys.

| Milestone | Status |
|---|---|
| Spec 01 — Foundation & Scaffold | ☑ |
| Spec 02 — Database & Auth | ☑ |
| Spec 03 — Capture & AI Extraction | ☑ |
| Spec 04 — Inflation Engine | ☑ |
| Spec 05 — UI & Design System | ☑ |
| Spec 06 — PWA & Offline | ☐ |
| DESIGN.md (generated after Spec 05) | ☑ |
| Spec 07 — Receipt Import | ☐ |
| Spec 08 — Go-live & Operations | ☐ |

*Status last updated: 2026-08-21 (Spec 05 implemented).*

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
