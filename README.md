<div align="center">

<img src="docs/assets/logo.svg" alt="segnaprezzi logo" width="110" />

# segnaprezzi

**Your personal inflation index**

Photograph supermarket price tags, let AI read them, and watch *your* cost of living — not the national average — take shape month by month.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://img.shields.io/badge/CI-coming%20soon-lightgrey.svg)](#project-status--roadmap)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Status](https://img.shields.io/badge/status-specs%20complete-blueviolet.svg)](docs/specs/)

</div>

---

## Why

Official inflation — ISTAT's NIC index in Italy, and its equivalents everywhere else — is computed on a national basket that is nobody's actual basket. It averages the spending of millions of households into a single number, weighting products you never buy and stores you never enter. When the headline says "+1.8%", your own groceries may have moved twice that, or not at all.

Your inflation is what **you** pay for what **you** buy. *Segnaprezzi* is the Italian word for the shelf price tags in a supermarket — the little labels showing the price and the price per kg or per liter. This app turns those tags into your own price statistics: photograph them while you shop, and over time it computes a personal Consumer Price Index from the exact products, stores, and prices of your real life — with the official index alongside for comparison.

## How it works

1. **Snap.** While shopping, photograph the shelf tag of each item you put in the cart. Photos are captured and queued locally — the app is offline-first, because supermarkets have terrible connectivity. Zero signal is fine; everything syncs when the network returns.
2. **Extract.** Claude Haiku 4.5 reads each photo and pulls out the product, brand, category, total price, and unit price (€/kg, €/L, €/piece), normalized to comparable base units. You review every extraction before anything is saved — the AI proposes, you confirm.
3. **Track.** The app buckets your entries by month, chains matched products into a personal CPI (base month = 100), and shows headline numbers ("your inflation: +4.2% YoY"), category breakdowns, per-product price histories, and a comparison against the official ISTAT index.

**The honesty principle:** a personal index built from a few dozen products is statistically thin, and the app never pretends otherwise. Every number ships with its coverage stats — how many products were compared, which categories had data, how much was imputed — so you always know how much to trust what you see.

## Features

All features below are **planned** — the project is fully specified but implementation has not started yet. See [Project status](#project-status--roadmap).

- [ ] **Tag scanning** — photograph shelf price tags; Claude Haiku 4.5 extracts product, total price, and unit price with a review-before-save flow
- [ ] **Fuel & manual quick entry** — a dedicated €/L ⇄ liters form for fuel, and a manual form for everything without a tag
- [ ] **Personal CPI** — chained monthly index with category breakdown, expenditure-share weighting, and side-by-side ISTAT comparison
- [ ] **Product price histories** — per-product charts across stores and time, with duplicate-product merging
- [ ] **Promo tracking** — flag discounts, loyalty prices, coupons, and bundles; choose whether promos count toward your index
- [ ] **Offline-first PWA** — installable on your phone, captures photos with zero connectivity, syncs later
- [ ] **Italian + English** — full i18n from day one
- [ ] **Dark / light theme**
- [ ] **Data export** — your complete data as JSON, always
- [ ] **Self-hostable** — your prices live in your own database, on your own deployment

## Screenshots

Coming with implementation — screenshots will live in `docs/assets/screenshots/`.

## Tech stack

| Role | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org) 16 (App Router) + React 19, deployed on Vercel |
| Language | TypeScript 7 |
| Database | [Turso](https://turso.tech) (libSQL/SQLite) + [Drizzle ORM](https://orm.drizzle.team) |
| Auth | [Better Auth](https://better-auth.com) (email + password) |
| AI extraction | Claude Haiku 4.5 (`claude-haiku-4-5`) via `@anthropic-ai/sdk` |
| Photo storage | [Vercel Blob](https://vercel.com/storage/blob) |
| PWA / offline | [Serwist](https://serwist.pages.dev) + [Dexie](https://dexie.org) (IndexedDB photo queue) |
| i18n | [next-intl](https://next-intl.dev) (`it` + `en`) |
| Styling | Tailwind CSS 4 |
| Animation | [Motion](https://motion.dev) |
| Validation | Zod |
| Lint / format | [Biome](https://biomejs.dev) |
| Testing | Vitest (unit/integration) + Playwright (E2E) |
| Package manager | pnpm |

Exact versions the specs were written against are listed in [Spec 00, section 4](docs/specs/00-overview.md#4-tech-stack-versions-current-as-of-2026-08-20).

## Self-hosting

> **Note:** these steps apply once v1 is implemented — see [Project status](#project-status--roadmap).

segnaprezzi is designed to run on free tiers: Vercel Hobby, Turso's free plan, and an Anthropic API key (a photo extraction costs well under €0.01 — even 200 photos a month is pocket change).

### Prerequisites

- A [Turso](https://turso.tech) account (database)
- An [Anthropic API key](https://console.anthropic.com) (tag extraction)
- A [Vercel](https://vercel.com) account (hosting + Blob photo storage)

### Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `TURSO_DATABASE_URL` | libSQL connection URL (`file:local.db` for dev) | ✅ |
| `TURSO_AUTH_TOKEN` | Turso token (empty for local file DB) | prod |
| `ANTHROPIC_API_KEY` | Claude API key for extraction | ✅ |
| `BETTER_AUTH_SECRET` | Session encryption secret | ✅ |
| `BETTER_AUTH_URL` | Canonical app URL | ✅ |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (auto-set on Vercel) | ✅ |
| `SIGNUP_ENABLED` | `"false"` closes registration | optional (default `true`) |

All variables are validated with Zod at boot (`src/lib/env.ts`); a misconfigured deployment fails fast with a clear message.

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FGiuseppeDM98%2Fsegnaprezzi&project-name=segnaprezzi&repository-name=segnaprezzi&env=TURSO_DATABASE_URL,TURSO_AUTH_TOKEN,ANTHROPIC_API_KEY,BETTER_AUTH_SECRET,BETTER_AUTH_URL&envDescription=See%20the%20environment%20variables%20table%20in%20the%20README&envLink=https%3A%2F%2Fgithub.com%2FGiuseppeDM98%2Fsegnaprezzi%23environment-variables)

1. Create a database: `turso db create segnaprezzi`, then grab its URL (`turso db show segnaprezzi --url`) and a token (`turso db tokens create segnaprezzi`).
2. Click the button above and fill in the environment variables (generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`; set `BETTER_AUTH_URL` to your production URL, e.g. `https://segnaprezzi.yourdomain.com`).
3. In the Vercel project, add a **Blob store** (Storage → Blob) — this sets `BLOB_READ_WRITE_TOKEN` automatically.
4. Deploy, open the app, and create your account.
5. **Keep your instance private:** once your account exists, set `SIGNUP_ENABLED=false` in the Vercel project settings and redeploy. Registration closes; your data stays yours.

**Privacy note:** tag photos are stored as unguessable public Vercel Blob URLs — anyone who has a URL can open that photo, so treat the URLs like bearer tokens and don't share them. Private signed URLs are on the v1.1 roadmap.

## Local development

> **Note:** the commands below describe the intended workflow defined in the specs. They will work once Specs 01–02 are implemented.

Requirements: Node 22+ and pnpm.

```bash
git clone https://github.com/GiuseppeDM98/segnaprezzi.git
cd segnaprezzi
pnpm install

# Configure the environment
cp .env.example .env.local
# In .env.local: TURSO_DATABASE_URL="file:local.db" (no Turso account needed),
# your ANTHROPIC_API_KEY, a generated BETTER_AUTH_SECRET,
# and BETTER_AUTH_URL="http://localhost:3000"

pnpm db:migrate   # apply Drizzle migrations to local.db
pnpm db:seed      # optional: demo data to explore the dashboard
pnpm dev          # http://localhost:3000
```

Useful extras: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright), `pnpm lint` (Biome).

## Project status & roadmap

**Current status: specifications complete — implementation starting.**

segnaprezzi is built specs-first: every part of the system is fully specified — exact schemas, algorithms with worked numeric examples, prompts, test plans — before a line of application code is written. Each spec is then implemented in its own focused session. The specs are public and are the best way to understand the project in depth:

| Spec | Covers |
|---|---|
| [00 — Overview & Canonical Contract](docs/specs/00-overview.md) | Single source of truth: domain model, money rules, category taxonomy, routes, env vars |
| [01 — Foundation & Scaffold](docs/specs/01-foundation.md) | Next.js scaffold, tooling, repo layout, env validation, i18n shell |
| [02 — Database & Auth](docs/specs/02-database-auth.md) | Drizzle schema and migrations, Better Auth setup, repositories |
| [03 — Capture & AI Extraction](docs/specs/03-capture-ai.md) | Camera flow, `/api/extract`, Claude prompt and schema, review screen, product matching |
| [04 — Inflation Engine](docs/specs/04-inflation-engine.md) | Pure index math: bucketing, chaining, weighting, coverage stats, exhaustive test plan |
| [05 — UI & Design System](docs/specs/05-ui-design.md) | Design system, dashboard, charts, all screens |
| [06 — PWA & Offline](docs/specs/06-pwa-offline.md) | Serwist service worker, IndexedDB photo queue, sync manager |
| [07 — Receipt Import](docs/specs/07-receipt-import.md) | Digital receipt (PDF) → per-line extraction, catalog aliases, review, `source='receipt'` entries |

Implementation order: 01 → 02 → (03 ∥ 04) → 05 → 06 → 07.

### After v1

- **v1.1** — barcode scanning · richer ISTAT category-level comparison · private signed photo URLs · multi-file receipt upload and private receipt archive
- **v1.2** — household sharing (shared basket, private accounts) · price alerts ("olive oil below €7/L")
- **Later** — automatic receipt ingestion (e-mail/bank) · EU HICP comparison · multi-currency

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Start with [Spec 00](docs/specs/00-overview.md) to understand the canonical contract, and note that all code follows [docs/DEVELOPMENT_GUIDELINES.md](docs/DEVELOPMENT_GUIDELINES.md) and [docs/COMMENTS.md](docs/COMMENTS.md).

## License

[MIT](LICENSE) © [GiuseppeDM98](https://github.com/GiuseppeDM98)

---

<div align="center">

*segnaprezzi's specifications and code are built with [Claude](https://claude.com).*

</div>
