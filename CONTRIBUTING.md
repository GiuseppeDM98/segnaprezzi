# Contributing to segnaprezzi

Thanks for your interest in segnaprezzi — a mobile-first, offline-first PWA that
turns photos of supermarket price tags into your **personal inflation index**.
Contributions of every size are welcome: bug reports, spec discussions, docs,
translations, tests, and code.

Everything below assumes you have read this repo's canonical contract at least
once. That is not optional — see the next section.

---

## Project philosophy: spec-driven development

segnaprezzi is **spec-first**. The behavior of the app is defined in
[`docs/specs/`](docs/specs/), and [`docs/specs/00-overview.md`](docs/specs/00-overview.md)
is the single source of truth for table names, column names, money rules, the
category taxonomy, routes, and environment variables. Code that contradicts the
spec is a bug — even if it "works".

Practical consequences:

- **Read `docs/specs/00-overview.md` before writing any code.** It is short and
  it will save you a rejected PR.
- **Every feature starts as a spec change.** If your idea changes behavior, open
  a PR against `docs/specs/` (or an issue proposing one) *before* implementing.
  Small bug fixes that restore spec-compliant behavior don't need a spec change.
- If a spec must deviate from `00-overview.md`, update `00-overview.md` first,
  in the same PR.

---

## Development setup

### Prerequisites

- **Node.js 22+**
- **pnpm 10+** — easiest via Corepack: `corepack enable pnpm`
- A **Claude API key** ([console.anthropic.com](https://console.anthropic.com)) if you
  want to work on the photo-extraction flow

### Steps

```bash
git clone https://github.com/GiuseppeDM98/segnaprezzi.git
cd segnaprezzi
pnpm install

# Configure the environment
cp .env.example .env.local
```

Edit `.env.local`. For local development you do **not** need a Turso account —
the app runs against a local SQLite file:

| Variable | Local dev value |
|---|---|
| `TURSO_DATABASE_URL` | `file:local.db` |
| `TURSO_AUTH_TOKEN` | leave empty (only needed against hosted Turso) |
| `ANTHROPIC_API_KEY` | your key — required to boot; only exercised by the extraction flow |
| `BETTER_AUTH_SECRET` | generate one: `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` |
| `BLOB_READ_WRITE_TOKEN` | token of a (free) Vercel Blob store; a placeholder lets the app boot, but photo upload will fail until it is real |
| `SIGNUP_ENABLED` | leave unset (defaults to open registration) |

`src/lib/env.ts` validates all of these with Zod at boot and fails fast, so the
app tells you immediately if something is missing.

Then:

```bash
pnpm db:migrate    # apply Drizzle migrations to local.db
pnpm db:seed       # optional: demo stores/products/price entries so the dashboard isn't empty
pnpm dev           # http://localhost:3000
```

For E2E work, install the Playwright browsers once: `pnpm exec playwright install`.

### Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm lint` | Biome — lint + format check |
| `pnpm typecheck` | TypeScript compiler, no emit |
| `pnpm test` | Vitest unit/integration tests |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm db:migrate` | Apply pending Drizzle migrations |
| `pnpm db:seed` | Load demo data into the local DB |
| `pnpm db:studio` | Browse the local DB with Drizzle Studio |
| `pnpm istat:update` | Refresh `data/istat-nic.json` from ISTAT's SDMX service (commit the diff) |

---

## Quality bar

A PR is ready for review only when **all four** are green locally:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

CI runs the same checks, with E2E in a separate non-blocking job; a red
pipeline means the PR won't be reviewed yet.
New behavior needs tests at the right level of the pyramid: unit tests
(colocated `*.test.ts`) for logic — especially anything under `src/lib/inflation/`
and `src/lib/domain/` — integration tests for wiring, Playwright only for
critical user paths.

---

## Code style

Two documents define the style, and reviews enforce both:

**[`docs/DEVELOPMENT_GUIDELINES.md`](docs/DEVELOPMENT_GUIDELINES.md)** — architecture and
naming. In one paragraph: layers are strict and unidirectional — route handlers
and Server Actions stay thin (validate input with Zod at the boundary, call a
service, map errors to responses); services (`src/lib/services/`) orchestrate
use cases and never import `next/*` or touch HTTP; repositories
(`src/lib/db/repositories/`) contain only Drizzle queries, never business
rules; gateways (`src/lib/ai/`, `src/lib/blob/`) wrap external APIs; and
`src/lib/inflation/` plus `src/lib/domain/` are pure — zero I/O, no imports
from db/ai/next. Functions are named verb+noun (`calculateMonthlyIndex`, not
`process`), booleans get `is`/`has`/`can`/`should` prefixes, collections are
plural, functions stay small (~30 lines), and errors are never swallowed —
they are translated at the layer that has context.

**[`docs/COMMENTS.md`](docs/COMMENTS.md)** — comment discipline. In one paragraph:
comments explain **why**, never what; the six accepted types are function
(interface contracts), design (file-level approach and trade-offs), why
(non-obvious decisions), teacher (domain knowledge like the Jevons index),
guide (section rhythm in longer functions), and checklist ("if you change X,
also update Y"). Trivial comments, bare `TODO`/`FIXME` debt comments, and
commented-out backup code are rejected in review.

### The money rule (project-wide, non-negotiable)

**Never floats for money.** Prices are integers end to end:

```ts
// €2.49 on the shelf → integer euro cents
const totalPriceCents = 249;

// €1.799/L at the pump → integer milli-euros per base unit (kg, L, piece)
const unitPriceMilli = 1799;
```

Floats appear only inside the index math (`src/lib/inflation/`), where the
values are ratios between prices, not money. If a PR introduces a `number`
that holds euros with decimals, it will be sent back.

---

## Commits and branches

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add carry-forward imputation to monthly bucketing
fix: normalize €/100g unit prices to €/kg at extraction time
refactor: extract product matching into matchProducts service
chore: bump drizzle-kit to 0.31.x
docs: clarify promo handling in spec 04
test: cover YoY headline with fewer than 13 months of data
```

Subject line ≤ 72 characters, imperative mood, no trailing period. Explain the
*why* in the body when it isn't obvious. One logical change per commit — don't
mix refactoring with feature work.

Branches:

```
feature/short-description
fix/short-description
refactor/short-description
chore/short-description
```

Lowercase, hyphen-separated, specific (`feature/fuel-quick-form`, not
`feature/stuff`).

---

## Pull requests

- **Small and focused.** One concern per PR. A 200-line focused PR gets
  reviewed in a day; a 2000-line PR sits.
- **PR title = a Conventional Commit subject** (PRs are squash-merged, so the
  title becomes the commit).
- **Tests are behavioral.** Test what the code does through its public
  interface, Arrange–Act–Assert, names that read as sentences
  (`"should exclude promo entries when include_promos_in_index is 0"`).
- **i18n is mandatory, both locales, every time.** Every user-visible string
  goes through next-intl, and every new key lands in **both**
  `messages/it.json` and `messages/en.json` in the same PR. English-only (or
  Italian-only) strings fail review. If you don't speak the other language, a
  best-effort machine translation marked in the PR description is fine — the
  maintainer will polish it.
- **Spec updated** in the same PR if the change alters documented behavior.
- Fill in the PR template — the checklist mirrors everything above.

By submitting a contribution you agree it is licensed under the project's
[MIT License](LICENSE).

---

## Where to ask questions

- **[GitHub Discussions](https://github.com/GiuseppeDM98/segnaprezzi/discussions)** —
  questions, ideas, "would this feature fit?", methodology talk (index math
  nerds especially welcome).
- **[GitHub Issues](https://github.com/GiuseppeDM98/segnaprezzi/issues)** —
  confirmed bugs and concrete, scoped feature proposals, using the templates.

Don't be shy about opening a Discussion before writing code — five minutes of
alignment beats a rewritten PR.
