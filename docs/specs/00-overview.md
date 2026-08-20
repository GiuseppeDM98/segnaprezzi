# Spec 00 — Project Overview & Canonical Contract

> **Status**: Approved · **Last updated**: 2026-08-20
> This document is the single source of truth for names, data shapes, and decisions.
> Every other spec (01–06) elaborates on this contract and MUST NOT contradict it.
> If a spec needs to deviate, update this file first.

---

## 1. Vision

**segnaprezzi** — *your personal inflation index*.

Official inflation (ISTAT's NIC index in Italy) is computed on a national basket
that is nobody's actual basket. segnaprezzi computes **your** inflation from the
prices **you** actually pay: while shopping, you photograph the shelf price tag
(the *segnaprezzi*) of each item you put in the cart. The app extracts the
product, the total price, and the unit price (€/kg, €/L, €/piece) with AI,
tracks the same products over time, and computes a personal Consumer Price Index
with headline numbers ("your inflation: +4.2% YoY"), category breakdowns, and
per-product price histories — including a comparison against the official ISTAT
index.

Fuel and generic purchases enter through dedicated quick forms, and everything
can also be entered manually. The app is a mobile-first, offline-first PWA:
supermarkets have terrible connectivity, so photos are always captured locally
and processed when the network returns.

The project is open source (MIT), self-hostable, and initially private in
usage: each user sees only their own prices, stores, and products.

---

## 2. Glossary

| Term (EN) | Italian | Meaning |
|---|---|---|
| Price tag | segnaprezzi / cartellino | The shelf label showing price and unit price |
| Price entry | rilevazione | One observation: product + store + date + prices |
| Shopping session | spesa | One shopping trip; groups photos/entries |
| Unit price | prezzo al kg/L | Price per base unit (kg, L, piece) — the comparable quantity |
| Personal CPI | inflazione personale | Chained index computed from the user's own entries |
| Store | punto vendita | Supermarket, fuel station, or other shop |
| Base month | mese base | First month with data; index = 100 |
| Carry-forward | riporto | Imputing a missing month from the last known price |

---

## 3. Locked Decisions

| Area | Decision | Rationale |
|---|---|---|
| Framework | Next.js (App Router) on Vercel | Author's standard stack |
| Database | Turso (libSQL/SQLite) + Drizzle ORM | Generous free tier, edge latency, first-class Drizzle support |
| Photo storage | Vercel Blob | Blobs don't belong in SQLite; native Vercel integration |
| Auth | Better Auth (email + password) | Open source, self-hostable, native Drizzle adapter |
| AI extraction | Claude Haiku 4.5 (`claude-haiku-4-5`), Anthropic SDK, server-side key | Fast, ~$1/$5 per MTok — fractions of a cent per photo; structured outputs |
| PWA | Serwist, offline-first with IndexedDB photo queue | Supermarkets have poor connectivity |
| i18n | next-intl, `it` + `en` from day one | Author uses IT; OSS audience uses EN; retrofitting i18n is painful |
| Styling | Tailwind CSS 4 | Current standard |
| Animation | Motion (`motion` package) | Spring physics micro-interactions |
| Lint/format | Biome | Single fast tool, replaces ESLint + Prettier |
| Tests | Vitest (unit/integration) + Playwright (E2E) | Standard pyramid |
| Package manager | pnpm | Fast, strict |
| License | MIT, public repo from first commit | Maximum adoption |
| Registration | Open by default, closable via `SIGNUP_ENABLED=false` | "Initially private" without schema hacks |
| Currency | EUR only in v1 | Schema keeps a `currency` column for later |
| UI design | Pushed hard — must be a "wow" app; designed with the impeccable skill | Explicit project goal |

### Non-goals for v1

- Barcode/EAN scanning (roadmap)
- Receipt (scontrino) OCR — one photo for a whole trip (roadmap; complements tags: receipts prove paid prices, tags carry unit prices)
- Community/shared price data — the app is private per user
- Multi-currency, budgeting features, shopping lists
- Native app stores — PWA only

---

## 4. Tech Stack (versions current as of 2026-08-20)

Implementers should install latest stable; these are the versions the specs were
written against. Breaking-change checks are only needed if majors differ.

| Package | Version |
|---|---|
| next | 16.3.x |
| react / react-dom | 19.2.x |
| typescript | 7.0.x (as scaffolded by create-next-app) |
| tailwindcss | 4.3.x |
| drizzle-orm / drizzle-kit | 0.45.x / 0.31.x |
| @libsql/client | 0.17.x |
| better-auth | 1.7.x |
| next-intl | 4.13.x |
| @serwist/next / serwist | 9.5.x |
| @anthropic-ai/sdk | 0.120.x |
| motion | 13.1.x |
| lucide-react | latest (icon set, added in Spec 05) |
| zod | 4.4.x |
| @vercel/blob | 2.8.x |
| dexie | 4.4.x |
| vitest | 4.1.x |
| @playwright/test | 1.62.x |
| @biomejs/biome | 2.5.x |

---

## 5. Architecture

```
[App Router pages / Server Actions / Route Handlers]   ← HTTP, parsing, i18n, no business logic
                    ↓
[Services  src/lib/services/*]                         ← use cases, orchestration
                    ↓
[Repositories  src/lib/db/repositories/*]              ← Drizzle queries, persistence only
[Gateways      src/lib/ai/*, src/lib/blob/*]           ← external APIs (Anthropic, Vercel Blob)

[Pure domain   src/lib/inflation/*]                    ← zero I/O, heavily unit-tested index math
[Client-side   src/lib/offline/*]                      ← IndexedDB (Dexie) photo queue, sync manager
```

Rules (from `docs/DEVELOPMENT_GUIDELINES.md`, non-negotiable):
- Route handlers and Server Actions are thin: validate with Zod, call a service, map errors.
- Services never import `next/*` or touch HTTP concepts.
- Repositories never contain business rules.
- `src/lib/inflation/` is pure: plain functions, no imports from db/ai/next.

---

## 6. Canonical Domain Model

Authoritative table and column names. DB uses `snake_case`, TypeScript uses
`camelCase` (Drizzle maps them). All IDs are `text` nanoid(21) generated
app-side. All timestamps are `integer` epoch **milliseconds UTC**
(`{ mode: 'timestamp_ms' }`). Booleans are `integer` 0/1.

### Money & unit rules (critical, project-wide)

- **Never floats for money.**
- `total_price_cents` — integer euro cents. What was actually paid/displayed: €2.49 → `249`.
- `unit_price_milli` — integer **milli-euros** (1/1000 €) per base unit. Unit
  prices need 3 decimals (fuel: €1.799/L → `1799`; €2.34/kg → `2340`).
- Base units: **kg** (weight), **L** (volume), **piece** (count).
  Tags shown per 100 g / 100 mL / etc. are normalized at extraction time
  (€/100g × 10 = €/kg).
- `package_size` — REAL, in base units (0.5 = 500 g; 38.2 = liters of fuel).
- Month bucketing for the index uses the **Europe/Rome** timezone.
- Index math (relatives, means) uses floats — ratios, not money.

### Tables

`users`, `sessions`, `accounts`, `verifications` — generated by Better Auth
(Drizzle adapter, Better Auth CLI). Do not hand-edit; see Spec 02.

**`user_settings`**
| column | type | notes |
|---|---|---|
| user_id | text PK, FK → users.id | |
| include_promos_in_index | integer bool, default 1 | Personal CPI = what you actually pay |
| carry_forward_months | integer, default 2 | 0 disables imputation |
| created_at / updated_at | integer ms | |

**`stores`**
| column | type | notes |
|---|---|---|
| id | text PK | nanoid |
| user_id | text FK → users.id, indexed | |
| name | text NOT NULL | "Esselunga Viale Papiniano" |
| chain | text NULL | "Esselunga" |
| city | text NULL | |
| kind | text NOT NULL | enum: `supermarket` \| `fuel_station` \| `other` |
| created_at / updated_at | integer ms | |

**`products`**
| column | type | notes |
|---|---|---|
| id | text PK | nanoid |
| user_id | text FK, indexed | |
| name | text NOT NULL | Canonical: "Spaghetti n.5 500g" |
| brand | text NULL | "Barilla" |
| category | text NOT NULL | enum, see taxonomy below |
| unit_kind | text NOT NULL | enum: `weight` \| `volume` \| `count` |
| notes | text NULL | |
| is_archived | integer bool, default 0 | Hidden from suggestions, kept in history |
| created_at / updated_at | integer ms | |

**`shopping_sessions`**
| column | type | notes |
|---|---|---|
| id | text PK | |
| user_id | text FK, indexed | |
| store_id | text FK → stores.id NULL | |
| status | text NOT NULL | enum: `active` \| `reviewing` \| `completed` \| `discarded` |
| started_at | integer ms | |
| completed_at | integer ms NULL | |
| created_at / updated_at | integer ms | |

**`price_entries`** — the heart of the app
| column | type | notes |
|---|---|---|
| id | text PK | |
| user_id | text FK, indexed | |
| product_id | text FK → products.id, indexed | |
| store_id | text FK → stores.id NULL | NULL for generic purchases |
| session_id | text FK → shopping_sessions.id NULL | |
| recorded_at | integer ms NOT NULL, indexed | Observation moment |
| total_price_cents | integer NOT NULL | Shelf/pump price actually shown |
| package_size | real NOT NULL | In base units of product.unit_kind |
| unit_price_milli | integer NOT NULL | Per base unit; from tag or computed |
| is_promo | integer bool, default 0 | |
| promo_kind | text NULL | enum: `discount` \| `loyalty` \| `coupon` \| `bundle` |
| source | text NOT NULL | enum: `photo` \| `manual` \| `fuel` |
| currency | text NOT NULL, default 'EUR' | |
| photo_url | text NULL | Vercel Blob URL |
| ai_confidence | real NULL | 0..1 |
| ai_model | text NULL | e.g. "claude-haiku-4-5" |
| ai_raw_json | text NULL | Full extraction payload, for debugging |
| created_at / updated_at | integer ms | |

Composite index: `(user_id, product_id, recorded_at)` — powers price history and
monthly bucketing. Also `(user_id, recorded_at)` for the entries timeline.

### Category taxonomy (code-defined enum, i18n labels — no DB table)

| id | EN label | IT label | Examples |
|---|---|---|---|
| `food` | Food | Alimentari | pasta, bread, meat, produce, dairy |
| `beverages` | Beverages | Bevande | water, juice, coffee, wine, beer |
| `household` | Household | Casa e pulizia | detergents, paper towels, foil |
| `personal-care` | Personal care | Cura personale | shampoo, toothpaste, razors |
| `health` | Health | Salute | pharmacy, supplements |
| `clothing` | Clothing | Abbigliamento | apparel, shoes |
| `fuel` | Fuel | Carburante | petrol, diesel, LPG |
| `transport` | Transport | Trasporti | tickets, tolls, parking, maintenance |
| `utilities` | Utilities | Utenze | electricity, gas, internet |
| `recreation` | Recreation | Tempo libero | books, games, streaming, dining out |
| `pets` | Pets | Animali | pet food, litter |
| `other` | Other | Altro | everything else |

Checklist: adding a category requires updating the enum in
`src/lib/domain/categories.ts`, both message files (`messages/it.json`,
`messages/en.json`), and the AI extraction prompt (Spec 03).

---

## 7. Personal CPI — Methodology Summary

Full algorithm, worked numeric examples, and the exhaustive test plan live in
**Spec 04**. The contract:

1. **Bucket** entries per product per calendar month (Europe/Rome). Product's
   monthly price = arithmetic mean of `unit_price_milli` in that month
   (promo entries included/excluded per `include_promos_in_index`).
2. **Matched-model month-over-month relatives**: for consecutive months, use
   only products present in both months (after carry-forward imputation, max
   `carry_forward_months`, imputed values flagged in coverage stats).
3. **Within category**: unweighted geometric mean (Jevons) of product relatives
   — mirrors ISTAT's elementary aggregates.
4. **Across categories**: arithmetic mean of category relatives weighted by the
   user's expenditure share per category over the trailing 12 months
   (`total_price_cents` sums), renormalized over categories with data.
5. **Chain**: `I(m) = I(m−1) × overallRelative(m)`, base month = 100.
6. **Headlines**: MoM %, YoY % (needs ≥13 months), since-start %. Every number
   ships with coverage stats (products compared, categories covered, imputed
   share) — the UI must be honest about thin data.
7. **ISTAT comparison**: static `data/istat-nic.json` (monthly NIC all-items
   index), refreshed by `scripts/update-istat.ts`, committed to the repo.

---

## 8. AI Extraction Summary

Full pipeline, exact prompt, and schema live in **Spec 03**. The contract:

- Endpoint: `POST /api/extract` — receives one compressed photo (WebP,
  client-side compressed to ≤ ~400 KB) + optional store context.
- Uploads photo to Vercel Blob, calls `claude-haiku-4-5` via `@anthropic-ai/sdk`
  with structured output; returns the extraction for user review. Nothing is
  saved to the DB until the user confirms in the review screen.
- Extraction fields: `productName`, `brand`, `category`, `unitKind`,
  `totalPriceCents`, `packageSize`, `unitPriceMilli` (normalized to base unit),
  `isPromo`, `promoKind`, `confidence`, `rawText`.
- Product matching: normalized fuzzy match against the user's catalog produces
  top-3 suggestions; user confirms or creates a new product. Merging duplicate
  products later is a first-class feature (moves entries, recomputes index).
- Cost: a photo ≈ 1–2K input tokens → well under €0.01; even 200 photos/month
  costs cents.

---

## 9. Route Map

All app routes live under the `[locale]` segment (`it` default, `en`).

| Route | Purpose |
|---|---|
| `/` | Dashboard: index hero, trend chart, category breakdown, top movers |
| `/scan` | Active shopping session: camera, photo tray, queue status |
| `/scan/review` | Review extracted entries, fix, match products, confirm batch |
| `/add/manual` | Manual price entry form |
| `/add/fuel` | Fuel quick form (€/L + total ⇄ liters) |
| `/products` | Product catalog, search, merge duplicates |
| `/products/[id]` | Product detail: price history chart, entries, stats |
| `/history` | All entries timeline, filters |
| `/stores` | Store management |
| `/settings` | Profile, language, theme, index options, data export |
| `/login`, `/signup` | Auth (signup hidden when `SIGNUP_ENABLED=false`) |

API route handlers (everything else uses Server Actions):

| Route | Purpose |
|---|---|
| `/api/auth/[...all]` | Better Auth |
| `/api/extract` | Photo → Blob upload → Claude extraction |
| `/api/export` | Full user data export (JSON) |

Navigation: bottom tab bar (mobile) — Home, Products, central **Scan** FAB,
History, Settings.

---

## 10. Repository Layout (planned)

```
segnaprezzi/
├── docs/
│   ├── specs/                  # These specs (00–06)
│   ├── assets/                 # Logo, favicon source SVG
│   ├── COMMENTS.md             # Comment-writing guidelines (applies to all code)
│   └── DEVELOPMENT_GUIDELINES.md
├── data/istat-nic.json         # Official ISTAT NIC monthly series (committed)
├── scripts/                    # seed.ts, update-istat.ts, generate-icons.ts
├── messages/                   # it.json, en.json (next-intl)
├── public/                     # PWA icons, manifest assets
├── src/
│   ├── app/                    # App Router: [locale]/(app)/..., api/...
│   ├── components/             # ui/ (primitives), charts/, capture/, layout/
│   ├── lib/
│   │   ├── domain/             # categories.ts, units.ts, money.ts (pure)
│   │   ├── inflation/          # index engine (pure, no I/O)
│   │   ├── db/                 # client, schema, repositories/
│   │   ├── services/           # use cases
│   │   ├── ai/                 # extraction gateway + prompt
│   │   ├── blob/               # Vercel Blob gateway
│   │   ├── offline/            # Dexie schema, sync manager (client)
│   │   ├── auth/               # Better Auth config + helpers
│   │   └── i18n/               # next-intl config
│   └── middleware.ts
├── tests/                      # e2e/ (Playwright); unit tests colocated *.test.ts
├── AGENTS.md · CLAUDE.md · README.md · CONTRIBUTING.md · LICENSE · ...
└── package.json
```

---

## 11. Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `TURSO_DATABASE_URL` | libSQL connection URL (`file:local.db` for dev) | ✅ |
| `TURSO_AUTH_TOKEN` | Turso token (empty for local file DB) | prod |
| `ANTHROPIC_API_KEY` | Claude API key for extraction | ✅ |
| `BETTER_AUTH_SECRET` | Session encryption secret | ✅ |
| `BETTER_AUTH_URL` | Canonical app URL | ✅ |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (auto-set on Vercel) | ✅ |
| `SIGNUP_ENABLED` | `"false"` closes registration | optional (default true) |

`src/lib/env.ts` validates all of these with Zod at boot; fail fast.

---

## 12. Spec Index & Implementation Plan

| Spec | Title | Depends on | Model | Effort |
|---|---|---|---|---|
| 01 | Foundation & Scaffold | — | Claude Sonnet 5 | medium |
| 02 | Database & Auth | 01 | Claude Sonnet 5 | high |
| 03 | Capture & AI Extraction | 02 | Claude Opus 5 | high |
| 04 | Inflation Engine | 02 (types only) | Claude Opus 5 (Fable 5 if available) | xhigh |
| 05 | UI & Design System | 02–04 | Claude Fable 5 + impeccable skill | xhigh |
| 06 | PWA & Offline | 03, 05 | Claude Opus 5 | high |

Order: 01 → 02 → (03 ∥ 04) → 05 → 06. One spec per Claude Code session,
using the Implementation Prompt at the end of each spec file. After each
milestone: update the *Current status* section in `CLAUDE.md`, commit with
conventional commits.

### Roadmap after v1

v1.1: receipt (scontrino) OCR · barcode scanning · richer ISTAT category-level
comparison. v1.2: household sharing (shared basket, private accounts) · price
alerts ("olive oil below €7/L"). Later: import bank/receipt data, EU HICP
comparison, multi-currency.

---

## 13. Conventions Pointer

All code follows `docs/DEVELOPMENT_GUIDELINES.md` (layers, naming, errors,
testing, security) and `docs/COMMENTS.md` (comment types: function, design,
why, teacher, guide, checklist — no trivial/debt/backup comments).
Project-specific conventions live in `AGENTS.md`. UI work must read `DESIGN.md`
once it exists (generated by the impeccable documenter after Spec 05).
