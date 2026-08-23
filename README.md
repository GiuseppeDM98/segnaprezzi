<div align="center">

<img src="docs/assets/logo.svg" alt="segnaprezzi logo" width="110" />

# segnaprezzi

**Your personal inflation index**

Photograph supermarket price tags, let AI read them, and watch *your* cost of living — not the national average — take shape month by month.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/GiuseppeDM98/segnaprezzi/actions/workflows/ci.yml/badge.svg)](https://github.com/GiuseppeDM98/segnaprezzi/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Why

Official inflation — ISTAT's NIC index in Italy, and its equivalents everywhere else — is computed on a national basket that is nobody's actual basket. It averages the spending of millions of households into a single number, weighting products you never buy and stores you never enter. When the headline says "+1.8%", your own groceries may have moved twice that, or not at all.

Your inflation is what **you** pay for what **you** buy. *Segnaprezzi* is the Italian word for the shelf price tags in a supermarket — the little labels showing the price and the price per kg or per liter. This app turns those tags into your own price statistics: photograph them while you shop, and over time it computes a personal Consumer Price Index from the exact products, stores, and prices of your real life — with the official index alongside for comparison.

## How it works

1. **Snap.** While shopping, photograph the shelf tag of each item you put in the cart. Photos are captured and queued locally — the app is offline-first, because supermarkets have terrible connectivity. Zero signal is fine; everything syncs when the network returns.
2. **Extract.** Claude Haiku 4.5 reads each photo and pulls out the product, brand, category, total price, and unit price (€/kg, €/L, €/piece), normalized to comparable base units. You review every extraction before anything is saved — the AI proposes, you confirm.
3. **Or import.** Got the digital receipt your supermarket e-mailed you? Upload the PDF (or a photo of a paper one) and every product line on it becomes its own observation — at the price you actually paid. The app matches each abbreviated line to your catalog and remembers your corrections, so the next receipt from that chain resolves itself. The file is read and discarded, never stored.
4. **Track.** The app buckets your entries by month, chains matched products into a personal CPI (base month = 100), and shows headline numbers ("your inflation: +4.2% YoY"), category breakdowns, per-product price histories, and a comparison against the official ISTAT index.

**The honesty principle:** a personal index built from a few dozen products is statistically thin, and the app never pretends otherwise. Every number ships with its coverage stats — how many products were compared, which categories had data, how much was imputed — so you always know how much to trust what you see.

## Features

- [x] **Tag scanning** — photograph shelf price tags; Claude Haiku 4.5 extracts product, total price, and unit price with a review-before-save flow
- [x] **Receipt import** — one PDF or photo becomes N observations: per-line extraction, automatic matching against your catalog, learned aliases so the next receipt from the same chain needs no work, identical lines folded into one purchase, and the file itself is never kept
- [x] **Fuel & manual quick entry** — a fuel form (benzina, diesel, GPL, metano) where any two of unit price, quantity and total fill in the third, and a manual form for everything without a tag
- [x] **Personal CPI** — chained monthly index with category breakdown, expenditure-share weighting, and a one-tap ISTAT comparison rebased to your own starting month, on a dashboard that leads with your year-over-year number and its coverage line
- [x] **Product price histories** — per-product charts with promo markers, min/max/average/latest, where each product is cheapest across your stores, duplicate-product merging, and deleting a product with its observations when you want it gone for good
- [x] **History & stores** — every observation day by day with shopping trips grouped under their total, filters by category/store/promo/source, and store management
- [x] **Promo tracking** — flag discounts, loyalty prices, coupons, and bundles; choose whether promos count toward your index
- [x] **Offline-first PWA** — installable on your phone, captures photos with zero connectivity, drains the queue by itself when the signal returns, and shows a localized offline page instead of a browser error
- [x] **Accounts & private data** — email + password sign-up/login; every price, product, and store is scoped to your account alone
- [x] **Italian + English** — full i18n from day one
- [x] **Dark / light theme**
- [x] **Data export** — your complete data as JSON, always
- [x] **Backup import** — restore a previous export into your account, merged by id and never wiped
- [x] **Self-hostable** — your prices live in your own database, on your own deployment (see [Self-hosting](#self-hosting) below)

## Design

The interface is a *tabulato a modulo continuo* — your index printed as a continuous-form statement: cream stock and ribbon ink (a print-negative dark theme), green-bar rows behind every list, a monospace with tabular figures for everything the machine printed, one highlighter-orange accent. It was designed with the [impeccable](https://impeccable.style) skill and is recorded in [`DESIGN.md`](DESIGN.md); every screen passes automated accessibility checks (axe, WCAG 2.1 AA) in both themes and scores 100 on Lighthouse accessibility. Screenshots will live in `docs/assets/screenshots/`.

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
| Styling | Tailwind CSS 4 (CSS-first tokens, see [`DESIGN.md`](DESIGN.md)) |
| Icons | [lucide-react](https://lucide.dev) |
| Animation | [Motion](https://motion.dev) |
| Validation | Zod |
| Lint / format | [Biome](https://biomejs.dev) |
| Testing | Vitest (unit/integration) + Playwright (E2E, with axe-core accessibility checks) |
| Package manager | pnpm |

## Self-hosting

segnaprezzi is designed to run on free tiers: Vercel Hobby, Turso's free plan, and an Anthropic API key with a spend cap (a tag photo costs well under €0.01, a receipt about €0.03 — a few hundred a month is pocket change). It is meant to run as **one** environment — no preview deployments, no second database — which keeps the moving parts to a minimum for a single-user instance.

### Prerequisites

- A [Turso](https://turso.tech) account (database)
- A [Vercel](https://vercel.com) account (hosting + Blob photo storage)
- An [Anthropic API key](https://console.anthropic.com) (tag and receipt extraction) — set a monthly spend cap

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

### Deploy

1. **Database** — create one Turso database (`turso db create`), ideally with its primary region close to where your Vercel functions run, and apply the committed migrations (`pnpm db:migrate`) before the first deploy.
2. **Vercel project** — import the repo; the committed `vercel.json` pins the function region and limits deployments to `main`, so nothing deploys from a branch or a fork's PR by accident.
3. **Blob store** — create one Vercel Blob store and connect it to the project (Production and Development scopes); this sets `BLOB_READ_WRITE_TOKEN` for you.
4. **Anthropic key** — one API key with a spend cap, pasted into Vercel's environment variables once.
5. **Variables** — set the rest of the table above, then run `vercel env pull .env.local` locally for a development environment that reaches the real Blob store and the real model.
6. Deploy, open the app, and create your account.
7. **Close the door** — once your account exists, set `SIGNUP_ENABLED=false` and redeploy. Registration closes; your data stays yours.

**Privacy note:** tag photos are stored as unguessable public Vercel Blob URLs — anyone who has a URL can open that photo, so treat the URLs like bearer tokens and don't share them. Receipt files are never stored at all, by design. Private signed photo URLs are on the v1.1 roadmap.

## Local development

Requirements: Node 22+ and pnpm.

```bash
git clone https://github.com/GiuseppeDM98/segnaprezzi.git
cd segnaprezzi
pnpm install
cp .env.example .env.local        # then fill in ANTHROPIC_API_KEY and BETTER_AUTH_SECRET
                                   # (generate a secret: openssl rand -base64 32)
pnpm db:migrate                   # applies migrations to a local file:local.db — no Turso account needed
pnpm db:seed                      # optional: seeds a demo account (dev@segnaprezzi.local / segnaprezzi-dev)
                                   # with 14 months of prices, so the dashboard shows a real year-over-year number
pnpm dev                          # http://localhost:3000 (Italian), http://localhost:3000/en
```

`TURSO_DATABASE_URL="file:local.db"` in `.env.example` already points at a
local SQLite file, so `TURSO_AUTH_TOKEN` can stay empty for local work.

Two variables now matter for real: `ANTHROPIC_API_KEY` and
`BLOB_READ_WRITE_TOKEN`, which `POST /api/extract` needs to read a photo and
store it. There is no local emulator for Vercel Blob — run `vercel link` once,
then `vercel env pull .env.local`, to get a development token. Without them the
capture screen, the queue, the review screen and both quick-entry forms still
work; only the extraction call itself fails (and the queue treats it as
retryable, so the photo waits rather than being lost).

Useful extras: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright — four projects: `mobile`, `desktop`, `offline-queue` and `pwa`, including the axe accessibility suite; it builds and starts a production server itself, because the service worker exists only there, so `PORT=3001 pnpm test:e2e` is all you need if port 3000 is busy), `pnpm lint` (Biome), `pnpm build` (production build), `pnpm icons` (regenerate the PWA icons from `docs/assets/logo.svg`), `pnpm db:studio` (browse the local DB), `pnpm istat:update` (refresh the bundled ISTAT NIC series in `data/istat-nic.json`), `pnpm photos:prune` (report — or with `--delete` remove — shelf photos in Blob that no entry references any more; run it with the environment of the deployment you mean, and read the two lines it prints first).

The service worker is disabled under `pnpm dev`. To try the app offline or install it, run `pnpm build && pnpm start` and open http://localhost:3000 — localhost counts as a secure origin.

## Roadmap

- **v1.1** — barcode scanning · richer ISTAT category-level comparison · private signed photo URLs · multi-file receipt upload and private receipt archive
- **v1.2** — household sharing (shared basket, private accounts) · price alerts ("olive oil below €7/L")
- **Later** — automatic receipt ingestion (e-mail/bank) · EU HICP comparison · multi-currency

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Start with [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md) to understand the codebase's conventions, and note that all code follows [docs/DEVELOPMENT_GUIDELINES.md](docs/DEVELOPMENT_GUIDELINES.md) and [docs/COMMENTS.md](docs/COMMENTS.md).

## License

[MIT](LICENSE) © [GiuseppeDM98](https://github.com/GiuseppeDM98)

---

<div align="center">

*segnaprezzi is built with [Claude](https://claude.com).*

</div>
