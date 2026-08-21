# AGENTS.md — Operating Manual for Coding Agents

This file is the operating manual for AI coding agents (and humans) working in
the **segnaprezzi** repository. It distills the project contract into rules you
can apply without re-deriving them. It does not replace the specs — it tells
you where the law is and how to work under it.

> **Reality check**: Specs 01 (Foundation & Scaffold) and 02 (Database & Auth)
> are implemented — there is a real DB, real auth, real repositories. The
> current implementation state is tracked in **`CLAUDE.md` → "Current
> status"** — read it first, trust it over any assumption. Sections below
> marked **[PLANNED]** describe code that does not exist yet (Spec 03
> onward) but whose shape is already decided; build exactly that shape. Where
> a spec's literal code text and the actually-implemented code differ, this
> file and the spec's own inline correction notes (search the spec for
> "Correction") describe what was actually verified to work — a handful of
> Spec 02's literal snippets didn't survive contact with the real dependency
> versions (see §4.15–§4.21).

**Reading order for any session**:
`CLAUDE.md` (state) → `WORKFLOW.md` (session/collaboration rules — branch,
commit, and guided-collaudo discipline) → `docs/specs/00-overview.md`
(contract) → the spec you are implementing → this file (conventions) →
`docs/DEVELOPMENT_GUIDELINES.md` and `docs/COMMENTS.md` (general discipline).

---

## 1. Project-Specific Patterns and Conventions

### 1.1 Canonical names are law

`docs/specs/00-overview.md` §6 is the **single source of truth** for table
names, column names, enum values, and the category taxonomy. Use those exact
names. Never invent a synonym, never "improve" a name, never contradict it. If
a spec or a session genuinely needs a deviation, **update 00-overview first**,
then propagate.

Ground rules from the contract:

- DB identifiers are `snake_case`; TypeScript identifiers are `camelCase`
  (Drizzle maps between them: column `total_price_cents` ↔ property
  `totalPriceCents`).
- All IDs are `text` **nanoid(21), generated app-side** — never DB-generated,
  never UUIDs.
- All timestamps are `integer` epoch **milliseconds UTC**, Drizzle
  `{ mode: 'timestamp_ms' }`. Booleans are `integer` 0/1.
- Enums are code-defined string unions (`stores.kind`, `products.category`,
  `products.unit_kind`, `shopping_sessions.status`, `price_entries.promo_kind`,
  `price_entries.source`) — no DB enum tables.

### 1.2 Money rules (never floats)

Money is **always integer**, in two distinct scales that must never be mixed:

| Column / field | Unit | Meaning | Example |
|---|---|---|---|
| `total_price_cents` | euro **cents** (1/100 €) | The price actually shown/paid | €2.49 → `249` |
| `unit_price_milli` | **milli-euros** (1/1000 €) per base unit | Comparable price per kg / L / piece | €1.799/L → `1799`; €2.34/kg → `2340` |

Why two scales: shelf totals never need more than 2 decimals; unit prices
(fuel above all) need 3. Conversion factor between them is **×10**
(1 cent = 10 milli-euros):

```ts
// src/lib/domain/money.ts

/**
 * Compute the unit price in milli-euros per base unit.
 *
 * @param totalPriceCents - price paid, in euro cents
 * @param packageSize - package size in base units of the product (kg, L, piece)
 * @returns integer milli-euros per base unit, rounded half-up
 *
 * @example calculateUnitPriceMilli(249, 0.5) === 4980  // €2.49 for 500 g → €4.98/kg
 * @example calculateUnitPriceMilli(9160, 50.9) === 1800 // €91.60 for 50.9 L → €1.80/L
 */
export function calculateUnitPriceMilli(totalPriceCents: number, packageSize: number): number {
  return Math.round((totalPriceCents * 10) / packageSize);
}
```

- Arithmetic on money (sums, conversions) is integer arithmetic with a single
  explicit `Math.round` at the end. The integer conversions
  (`calculateUnitPriceMilli`, `toCents`, `toMilli`, `centsToMilli`) live in
  `src/lib/domain/money.ts` (Spec 02) — pure, integer in/out, string-free.
- **All** string rendering of money (and every other `Intl.NumberFormat`
  display helper) lives exclusively in `src/lib/format.ts` (Spec 05), which
  divides at the last moment (`cents / 100`, `milli / 1000`) — components
  never divide by 100 themselves.
- The **only** place floats are legitimate: index math in `src/lib/inflation/`
  (price relatives and means are ratios, not money) and `package_size`
  (a physical quantity, stored as `real`).
- Zod schemas for money fields are `z.number().int().positive()` — a float
  reaching a `*_cents`/`*_milli` field is a validation bug at the boundary.

### 1.3 Base units and normalization

Three base units, keyed by `products.unit_kind`:

| `unit_kind` | Base unit | `package_size` examples |
|---|---|---|
| `weight` | **kg** | 500 g → `0.5`; 1.5 kg → `1.5` |
| `volume` | **L** | 330 mL can → `0.33`; 38.2 L of fuel → `38.2` |
| `count` | **piece** | 6 eggs → `6` |

Unit prices are **always stored per base unit**. Shelf tags shown per 100 g,
per 100 mL, per etto, etc. are normalized **at extraction time** (Spec 03) and
in every manual form: €/100g × 10 = €/kg; €/100mL × 10 = €/L. `src/lib/domain/units.ts`
defines the `UnitKind` enum and base-unit display symbols; the actual
normalization arithmetic is `calculateUnitPriceMilli` in `money.ts` above —
nothing outside `domain/` hand-rolls a unit conversion.

### 1.4 Time and month bucketing (Europe/Rome)

- Storage is epoch **ms UTC**, everywhere, no exceptions (see §1.1).
- The inflation engine buckets entries into **calendar months in the
  Europe/Rome timezone** — a purchase at 00:30 on May 1st Rome time belongs to
  May even though it is still April in UTC.
- Month keys are `"YYYY-MM"` strings, derived with `Intl.DateTimeFormat` (no
  date library dependency):

```ts
// src/lib/inflation/bucketing.ts  [PLANNED — Spec 04]

// Why 'en-CA': it is the one widely-supported locale whose formatted date
// parts come out ISO-like ('2026-04'), so no manual part reassembly and no
// DST/offset arithmetic of our own — the Intl database owns the timezone
// rules, including Italy's DST switches.
// Why module-level: constructing an Intl.DateTimeFormat is orders of
// magnitude more expensive than calling .format(); the engine formats one
// timestamp per entry on every recomputation.
const romeYearMonthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
});

/**
 * Map an epoch-milliseconds UTC timestamp to the 'YYYY-MM' calendar month
 * it falls in for the Europe/Rome timezone.
 *
 * Examples (2026 DST starts 29 March, so Rome is UTC+2 in late March):
 *   toRomeYearMonth(Date.parse('2026-03-31T22:30:00Z')) === '2026-04'
 *   toRomeYearMonth(Date.parse('2026-01-31T23:30:00Z')) === '2026-02'
 */
export function toRomeYearMonth(ms: number): string {
  return romeYearMonthFormatter.format(new Date(ms));
}
```

### 1.5 Layered architecture and import rules

```
[App Router pages / Server Actions / Route Handlers]   ← HTTP, parsing, i18n, no business logic
                    ↓
[Services  src/lib/services/*]                         ← use cases, orchestration
                    ↓
[Repositories  src/lib/db/repositories/*]              ← Drizzle queries, persistence only
[Gateways      src/lib/ai/*, src/lib/blob/*]           ← external APIs (Anthropic, Vercel Blob)

[Pure domain   src/lib/domain/*, src/lib/inflation/*]  ← zero I/O
[Client-side   src/lib/offline/*]                      ← IndexedDB (Dexie) queue, sync manager
```

Import rules — **what each layer may and must never import**:

| Layer (path) | May import | Must NEVER import |
|---|---|---|
| `src/app/**` (pages, actions, route handlers) | services, domain, inflation, `lib/i18n`, `lib/auth` helpers, `lib/errors`, components | repositories directly, `lib/ai`, `lib/blob`, `lib/db` client/schema |
| `src/lib/services/**` | repositories, gateways (`ai`, `blob`), domain, inflation, `lib/errors` | `next/*`, `react`, `src/app`, `src/components` |
| `src/lib/db/repositories/**` | `lib/db` client + schema, domain (types/enums), `lib/errors` | services, gateways, `next/*`, `react` |
| `src/lib/ai/**`, `src/lib/blob/**` (gateways) | domain, `lib/errors`, `lib/env` | `lib/db`, services, `next/*`, `react` |
| `src/lib/inflation/**` | `src/lib/domain` only | everything else (db, ai, blob, services, next, react) |
| `src/lib/domain/**` | nothing (TS/JS stdlib only) | every other project module |
| `src/lib/offline/**` (client) | domain, `dexie` | `lib/db`, services, gateways, server-only modules |
| `src/components/**` | domain, `lib/i18n` navigation, `motion`, other components | `lib/db`, repositories, services, gateways, `lib/env` |
| `src/lib/auth/**` | `lib/db` (adapter needs it), `lib/env` | services, components |

Enforcement is by review until a lint rule exists. When in doubt: **data flows
down, types flow up, and `domain/` + `inflation/` import nothing**.

### 1.6 The pure-domain rule

`src/lib/domain/` and `src/lib/inflation/` are **pure**: plain functions,
deterministic, zero I/O, no framework imports, no environment access, no
`Date.now()` buried inside (time is always a parameter). This is what makes
the index engine exhaustively unit-testable (Spec 04's test plan depends on
it). If a function in these directories needs a repository, the design is
wrong — the **service** fetches, the pure function computes.

### 1.7 Error handling: DomainError codes + translation at the boundary

**[PLANNED — decided]** Expected errors are `DomainError` subclasses in
`src/lib/errors.ts` (Spec 01 §9). The `code` is a stable `DomainErrorCode` —
a SCREAMING_SNAKE string union — that doubles as the i18n key under the
`errors` namespace (`errors.NOT_FOUND`). Classes carry **no** HTTP status;
route handlers own the code→status mapping:

```ts
// src/lib/errors.ts  [PLANNED — Spec 01 §9]

// WARNING: adding a code here requires updating:
// - the `errors` namespace in messages/it.json and messages/en.json
// - the code→HTTP-status mapping in route handlers (Spec 03)
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'EXTRACTION_FAILED'
  | 'INTERNAL';
// Later specs extend the union via the same checklist (Spec 03 adds
// SESSION_NOT_FOUND, SESSION_CLOSED, PHOTO_TOO_LARGE, INVALID_INPUT, ...).

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    // Why: `new.target.name` keeps subclass names in stack traces and logs
    // without each subclass having to set `this.name` itself.
    this.name = new.target.name;
    this.code = code;
  }
}

/** Serializable error shape returned by Server Actions. */
export type ActionError = {
  code: DomainErrorCode;
  message: string;
  issues?: string[];
};

// Guide: every Server Action returns this discriminated shape — the client
// narrows on `ok` and translates `error.code` on failure.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
```

The subclasses (`NotFoundError`, `ValidationError`, `UnauthorizedError`,
`ExtractionError`) and the `toActionError()` mapper live alongside them —
Spec 01 §9 has the full source. The HTTP mapping is `NOT_FOUND` → 404,
`VALIDATION_FAILED` → 400, `UNAUTHORIZED` → 401, `EXTRACTION_FAILED` → 422,
`INTERNAL` → 500.

Translation happens twice, at two different boundaries:

1. **Infrastructure → domain** (repository/gateway layer): a libSQL failure or
   an Anthropic SDK error never escapes raw. Missing rows become
   `NotFoundError`; the AI gateway's low-level `AiGatewayError` (internal to
   `src/lib/ai/`, carries `failureCode` + `isRetryable`) is translated by the
   service/route into `ExtractionError` with the cause attached and context
   logged.
2. **Domain → user** (app boundary): Server Actions catch, pass the thrown
   value through `toActionError()`, and return `ActionResult<T>` instead of
   throwing; route handlers map `code` to the HTTP statuses above. The UI
   renders `t(\`errors.${code}\`)` — services and repositories never touch
   next-intl, so error messages localize for free. The `message` field is
   developer-facing (logs, dev tools), never shown to users.

Unknown errors (bugs, outages) are **not** converted to `ok: false` silently:
log with full context (user id, operation, cause), collapse to
`{ ok: false, error: { code: 'INTERNAL', message: 'Unexpected error' } }`,
and never leak internals to the client. Never swallow an exception without
logging.

### 1.8 Zod at every boundary

Every point where untrusted data enters the system is validated with Zod
**before** any logic runs:

- Server Action inputs — `schema.safeParse(input)` first line of every action.
- Route handler bodies/params (`/api/extract`, `/api/export`).
- The Claude extraction response (Spec 03) — the model's output is untrusted
  input; parse it against the extraction schema before showing it to the user.
- Environment variables — `src/lib/env.ts` validates all of §11 of the
  overview with Zod at boot and **fails fast** with a readable message.
- IndexedDB queue items on sync replay (data may come from an old app
  version).

Schemas live next to the boundary that uses them; shared field shapes (money,
nanoid ids, month keys) are composed from small reusable schemas. Inside the
service/domain layers, inputs are already typed — do not re-validate.

```ts
// Reusable field schemas.  [PLANNED, e.g. src/lib/domain/schemas.ts]
export const nanoidSchema = z.string().length(21);
export const priceCentsSchema = z.number().int().positive();
export const unitPriceMilliSchema = z.number().int().positive();
export const epochMsSchema = z.number().int().positive();
```

### 1.9 Repository pattern — every query is user-scoped (security invariant)

The app is multi-tenant by `user_id`. **Every repository function has the
signature `(db: Db, userId: string, ...)`** — `db` injected first (Spec 02
§6.1: services pass the singleton from `src/lib/db/client.ts`, tests pass a
throwaway file-backed instance from `src/lib/db/testing/create-test-db.ts`,
**not** `:memory:` — see §4.17; repositories never import the `db` singleton
themselves) and `userId` second, included in every `WHERE` clause and JOIN
condition. No exceptions, not even "the id is already unique". This is the
single invariant that prevents cross-user data leaks; it is cheaper to
enforce mechanically than to reason about per-query.

```ts
// src/lib/db/repositories/stores.ts

/** Fetch one store by id, or null if it does not exist for this user. */
export async function getStoreById(
  db: Db,
  userId: string,
  storeId: string,
): Promise<Store | null> {
  const rows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.userId, userId), eq(stores.id, storeId)))
    .limit(1);
  return rows[0] ?? null;
}
```

- Repository modules are named **by aggregate, plural, kebab-case, no
  `Repository` suffix**: `price-entries.ts`, `products.ts`, `stores.ts`,
  `shopping-sessions.ts`, `settings.ts`.
- Read functions are `get*` (single row, returns `null` when missing) and
  `list*` (collections) — **never `find*`**. Writes are
  `create*`/`update*`/`delete*`.
- Repositories contain Drizzle queries and infrastructure-error translation —
  **no business rules** (no promo filtering logic, no index math, no "should
  this be archived" decisions).
- `userId` always comes from the server session
  (`requireUser()` helper in `src/lib/auth/session.ts`) — never
  from client input.

### 1.10 Server Actions vs route handlers

Default is **Server Actions** — colocated `actions.ts` files inside the route
segment that owns them, marked `"use server"`, thin (Zod → service → map
errors, ≤ ~15 lines each).

Route handlers exist **only** where a non-form client must call HTTP directly.
The complete list (overview §9):

| Handler | Why it cannot be an action |
|---|---|
| `/api/auth/[...all]` | Better Auth owns this surface |
| `/api/extract` | Called by the offline sync manager / service worker with a binary photo body |
| `/api/export` | Streams a downloadable JSON file |

Adding a fourth route handler requires a justification of this kind in the PR
description. "It felt more RESTful" is not one.

### 1.11 i18n rules (next-intl, `it` + `en`)

- **No hardcoded user-facing strings.** Every visible string goes through
  `useTranslations`/`getTranslations`. This includes error messages, empty
  states, aria-labels, `<title>`, PWA-manifest-adjacent strings, and chart
  axis labels.
- **Both locales in every PR.** A key added to `messages/en.json` without its
  `messages/it.json` twin (or vice versa) fails review. `it` is the default
  locale; `en` is the OSS-facing one — neither is optional.
- Keys are `camelCase` within namespaces, with two verbatim exceptions:
  `errors.*` keys are the `DomainErrorCode` names exactly as spelled
  (`errors.NOT_FOUND`), and category keys are the taxonomy ids verbatim
  (including `personal-care` — hyphens are valid next-intl keys).

Namespace map **[decided]** — top-level keys of both message files:

| Namespace | Contents |
|---|---|
| `common` | Shared verbs/labels: save, cancel, delete, confirm, loading, retry |
| `nav` | Tab bar and navigation labels |
| `dashboard` | Index hero, trend chart, category breakdown, top movers |
| `scan` | Camera screen, photo tray, queue status |
| `review` | Extraction review, product matching, confirm batch |
| `addManual` | Manual entry form |
| `addFuel` | Fuel quick-entry form |
| `products` | Catalog, merge flow |
| `productDetail` | Product detail screen, per-product price history |
| `history` | Entries timeline, filters |
| `stores` | Store management |
| `settings` | Profile, language, theme, index options, export |
| `auth` | Login, signup, signup-disabled notice |
| `errors` | One message per `DomainErrorCode`, keyed verbatim (`errors.NOT_FOUND`) |
| `offline` | Offline banner, queue/sync status |
| `categories` | One label per taxonomy id (`food`, …, `other`) |
| `units` | Unit labels and formats (kg, L, piece, €/kg, €/L) |
| `pwa` | Install prompt, update toast |

### 1.12 Design tokens (semantic only)

- Tailwind 4: tokens are defined in `src/app/globals.css` under `@theme` —
  there is **no `tailwind.config.*`** (see §4).
- Components use **semantic token utilities only** (`bg-surface`,
  `text-accent`, etc. — exact token names are fixed by `DESIGN.md` after
  Spec 05). Never hex colors, never `text-[#123456]` arbitrary values, never
  raw palette references in components.
- Colors are OKLCH at the token layer. Animation uses Motion springs
  (stiffness 400, damping 35 per the design guidelines).
- Until `DESIGN.md` exists, UI work is limited to what Spec 01–04 need
  (scaffold-level); the real design pass is Spec 05 with the impeccable skill.

### 1.13 Comments discipline (digest of docs/COMMENTS.md)

Six allowed comment types — each shown with a project-specific example:

| Type | Use for | Example (one-liner) |
|---|---|---|
| **Function** | Interface contract on exported functions | `/** Compute the chained index series; one point per Rome month, base month = 100. */` |
| **Design** | File/section-level approach + trade-offs | `// Matched-model Jevons within categories, expenditure-weighted across them — mirrors ISTAT elementary aggregates. See Spec 04.` |
| **Why** | Non-obvious decisions the code can't express | `// Promo entries stay in the mean when includePromosInIndex is on: the personal CPI tracks what the user actually pays, not list prices.` |
| **Teacher** | Domain knowledge the reader may lack | `// Jevons index = geometric mean of price relatives: exp(mean(ln(p1/p0))). Robust to outliers vs arithmetic mean.` |
| **Guide** | Rhythm in longer flows | `// Bucket entries per product per Rome month` … `// Impute gaps up to carryForwardMonths` |
| **Checklist** | Cross-file update reminders | See the category checklist in §2.3 below |

Three forbidden types:

- **Trivial** — `monthIndex += 1 // increment month` adds cost, not value.
- **Debt** — no bare `TODO`/`FIXME`/`XXX`. Use the issue tracker; if one is
  unavoidable, it carries a ticket ref: `// TODO(#42): …`.
- **Backup** — never leave commented-out code. Git remembers.

Comments explain **why**, not what. Proper grammar, capital letter, concise.

### 1.14 Naming conventions

| Thing | Convention | Examples |
|---|---|---|
| Files & directories | `kebab-case` | `price-entries.ts`, `photo-queue.ts` |
| React components | `PascalCase` export, `kebab-case` file | `price-trend-chart.tsx` → `export function PriceTrendChart` |
| Functions | `camelCase`, **verb + noun** | `calculateUnitPriceMilli`, `listPriceEntries`, `buildExtractionPrompt` |
| Booleans | `is` / `has` / `can` / `should` prefix | `isPromo`, `hasEnoughMonths`, `canMergeProducts` |
| Collections | Always plural | `priceEntries`, `monthKeys`, `categoryRelatives` |
| Repository modules | Aggregate name, plural, no suffix | `repositories/products.ts` (not `product-repository.ts`) |
| Zod schemas | `<subject>Schema` | `manualEntrySchema`, `extractionResponseSchema` |
| DB columns | `snake_case` (Drizzle maps to `camelCase`) | `total_price_cents` ↔ `totalPriceCents` |
| Tests | Behavior sentences | `test("should carry forward at most carryForwardMonths months")` |
| Branches | `feature/…`, `fix/…`, `refactor/…`, `chore/…` | `feature/inflation-chaining` |
| Commits | Conventional Commits, imperative, ≤72 chars | `feat: add fuel quick entry form` |

Consistency beats cleverness: this repo uses `get*`/`list*` for repository
reads (single row / collection — never `find*`), `create*`/`update*`/`delete*`
for writes, `calculate*`/`compute*` for pure calculations, `build*` for
constructing payloads/prompts, `format*` for display strings.

---

## 2. Code Organization and Structure [PLANNED]

### 2.1 The tree, annotated

Layout from overview §10, with what belongs in each directory — and what must
never appear there:

```
segnaprezzi/
├── docs/
│   ├── specs/                  # Specs 00–06. Contract docs — code never imports from here.
│   ├── assets/                 # Logo, favicon source SVG (build inputs, not served).
│   ├── COMMENTS.md
│   └── DEVELOPMENT_GUIDELINES.md
├── data/
│   └── istat-nic.json          # Committed ISTAT NIC monthly series. Only scripts/update-istat.ts writes it.
├── drizzle/                    # Generated SQL migrations + meta. Never hand-edited; always committed.
├── scripts/                    # tsx entry points: seed.ts, update-istat.ts, generate-icons.ts.
│                               #   Scripts may import src/lib/** but nothing imports scripts/.
├── messages/
│   ├── it.json                 # Default locale. Same key tree as en.json — always.
│   └── en.json
├── public/                     # PWA icons, manifest assets. Static only — no source files.
├── src/
│   ├── app/                    # App Router. [locale]/(app)/... pages, colocated actions.ts,
│   │   │                       #   api/ route handlers, globals.css (@theme tokens), layout.
│   │   │                       #   NEVER: business logic, Drizzle queries, fetch to Anthropic.
│   │   └── api/                # Only the three handlers in §1.10.
│   ├── components/
│   │   ├── ui/                 # Primitives (button, card, sheet, field...). Pure presentation.
│   │   ├── charts/             # Trend/history charts.
│   │   ├── capture/            # Camera, photo tray, queue status widgets.
│   │   └── layout/             # Tab bar, page shells.
│   │                           #   components/ NEVER imports db/, services/, ai/, blob/, env.
│   ├── lib/
│   │   ├── domain/             # categories.ts, units.ts, money.ts, schemas.ts. Pure, zero imports.
│   │   ├── inflation/          # Index engine: bucketing, relatives, chaining, coverage.
│   │   │                       #   Pure. Imports domain/ only. The most heavily unit-tested code.
│   │   ├── db/
│   │   │   ├── client.ts       # libSQL client + Drizzle instance (env-driven local/remote).
│   │   │   ├── schema/         # auth.ts (Better Auth CLI output), app.ts (our tables), index.ts.
│   │   │   └── repositories/   # One module per aggregate. Queries only, all userId-scoped.
│   │   ├── services/           # Use cases: record-entry.ts, merge-products.ts, compute-index.ts...
│   │   │                       #   Orchestration only — no SQL, no HTTP, no JSX.
│   │   ├── ai/                 # Anthropic gateway: extraction call, prompt, response schema.
│   │   ├── blob/               # Vercel Blob gateway: upload/delete photo.
│   │   ├── offline/            # CLIENT-side: Dexie schema, photo queue, sync manager.
│   │   │                       #   Never imported by server code.
│   │   ├── auth/               # auth.ts (Better Auth config), client.ts, session.ts (requireUser).
│   │   ├── i18n/               # routing.ts, navigation.ts (wrapped Link/router), request config.
│   │   ├── env.ts              # Zod-validated env access. The ONLY file reading process.env.
│   │   ├── format.ts           # ALL Intl display formatting (money, dates, units). Spec 05.
│   │   └── errors.ts           # DomainError + DomainErrorCode + ActionResult (§1.7).
│   └── middleware.ts           # next-intl locale routing + auth guard.
├── tests/
│   └── e2e/                    # Playwright specs (*.spec.ts). Critical paths only.
├── AGENTS.md · CLAUDE.md · README.md · CONTRIBUTING.md · DESIGN.md (after Spec 05)
├── LICENSE (MIT) · biome.json · drizzle.config.ts · next.config.ts · package.json
```

### 2.2 Test placement

- **Unit/integration tests are colocated**: `foo.ts` gets `foo.test.ts` in
  the same directory (`src/lib/inflation/chain.ts` →
  `src/lib/inflation/chain.test.ts`). Vitest picks up `src/**/*.test.ts(x)`.
- **Repository integration tests** run against a throwaway local libSQL
  database — a uniquely-named temp file per test, **not** `:memory:` (§4.17)
  — via `src/lib/db/testing/create-test-db.ts`, also colocated.
- **E2E lives in `tests/e2e/*.spec.ts`** (Playwright). The `.spec.ts` /
  `.test.ts` split keeps the two runners from grabbing each other's files.
- Test names are behavior sentences; bodies follow Arrange–Act–Assert.
- The inflation engine (Spec 04) carries the exhaustive numeric test plan from
  its spec — those tests are the correctness contract of the whole app; never
  weaken one to make an implementation pass.

### 2.3 Fan-out checklists (update these together)

Some changes are multi-file by design. The source file carries a checklist
comment; this section is the registry.

**Adding/renaming a category** (`src/lib/domain/categories.ts`):

```ts
// WARNING: when you add a category here, also update:
// - messages/it.json and messages/en.json ("categories" namespace)
// - the AI extraction prompt in src/lib/ai/ (Spec 03 — the model must know the new id)
// - AGENTS.md §1.11 namespace notes if semantics change
// The DB stores the raw id string: renaming an id requires a data migration.
export const categories = [ /* ... overview §6 taxonomy ... */ ] as const;
```

**Adding a `DomainErrorCode`** (`src/lib/errors.ts`): extend the union, add
the matching `errors.<CODE>` message to **both** `messages/it.json` and
`messages/en.json`, and update the code→HTTP-status mapping in route handlers.

**Adding an enum value** (e.g. `promo_kind`, `source`, `store.kind`): update
the Zod schema at every boundary that accepts it, both message files if it is
user-visible, and the extraction schema/prompt if the AI can emit it.

**Adding an env var**: `src/lib/env.ts` (Zod), `.env.example`, overview §11
table, README setup section, and the Vercel project settings.

**Adding a route**: overview §9 route map, `src/middleware.ts` matcher if
public/private status differs, and the tab bar in `components/layout/` if it
is a top-level destination.

**Regenerating `src/lib/db/schema/auth.ts`** (`pnpm auth:generate`): re-add
the hand-patched `issuer` column on `accounts` (§4.16) — the CLI output
doesn't include it, and signup breaks at runtime without it.

---

## 3. Common Commands

### 3.1 Canonical package.json scripts

This exact list is the project contract. Scripts that arrive with later specs
are listed now and marked; do not invent different names for them.

| Script | Command | Since | When to use |
|---|---|---|---|
| `dev` | `next dev` | Spec 01 | Daily development. Serwist is disabled here (§4.3). |
| `build` | `next build` | Spec 01 | Production build; also the only way to build the service worker. |
| `start` | `next start` | Spec 01 | Serve the production build locally (PWA testing). |
| `lint` | `biome check .` | Spec 01 | CI + pre-commit check. Formatting AND lint in one pass. |
| `lint:fix` | `biome check --write .` | Spec 01 | Auto-fix before committing. Run it, don't hand-format. |
| `typecheck` | `tsc --noEmit` | Spec 01 | Always run before declaring a task done; `next build` alone is not the type gate. |
| `test` | `vitest run` | Spec 01 | Full unit/integration suite, single pass (CI mode). |
| `test:watch` | `vitest` | Spec 01 | TDD loop while implementing (essential for Spec 04). |
| `test:e2e` | `playwright test` | Spec 01 | Critical-path E2E. Needs a prod build or dev server per Playwright config. |
| `db:generate` | `drizzle-kit generate` | Spec 02 | After every schema change: emits SQL migration into `drizzle/`. |
| `db:migrate` | `drizzle-kit migrate` | Spec 02 | Apply pending migrations to the DB in `TURSO_DATABASE_URL`. |
| `db:studio` | `drizzle-kit studio` | Spec 02 | Browse/edit data in a local GUI while debugging. |
| `db:seed` | `tsx --env-file-if-exists=.env.local scripts/seed.ts` | Spec 02 | Populate the local DB with demo data (products, entries across months). Not `--env-file` — see §4.21. |
| `auth:generate` | `pnpm dlx @better-auth/cli@1.4.22 generate --yes --config src/lib/auth/auth.ts --output src/lib/db/schema/auth.ts` | Spec 02 | Regenerate `src/lib/db/schema/auth.ts` after a Better Auth config change; always follow with `pnpm db:generate` (§3.5, §4.2, §4.16). |
| `icons` | `tsx scripts/generate-icons.ts` | Spec 06 | Regenerate PWA icon set from `docs/assets/logo.svg` into `public/`. |
| `istat:update` | `tsx scripts/update-istat.ts` | Spec 04 | Refresh `data/istat-nic.json` from ISTAT; commit the diff. |

`tsx` is a devDependency — scripts run TypeScript directly, no build step.
Always invoke through `pnpm` (`pnpm db:migrate`, `pnpm test`), never through
`npm`/`npx` — the lockfile is pnpm's.

### 3.2 Local bootstrap (from clean clone)

```bash
pnpm install
cp .env.example .env.local           # then edit: ANTHROPIC_API_KEY, BETTER_AUTH_SECRET
# Generate a secret:  openssl rand -base64 32
pnpm db:migrate                      # applies migrations to file:local.db
pnpm db:seed                         # optional: demo data
pnpm dev                             # http://localhost:3000
```

Local dev needs **no Turso account**: `.env.example` ships with
`TURSO_DATABASE_URL="file:local.db"` and an empty `TURSO_AUTH_TOKEN`
(§4.1). `local.db*` is gitignored.

### 3.3 Turso CLI (remote DB — staging/production only)

```bash
turso auth login
turso db create segnaprezzi
turso db show segnaprezzi --url        # → TURSO_DATABASE_URL
turso db tokens create segnaprezzi     # → TURSO_AUTH_TOKEN
turso db shell segnaprezzi             # ad-hoc SQL against the remote DB
```

Apply migrations to the remote DB by running `pnpm db:migrate` with the remote
env vars set (drizzle-kit reads them from the environment via
`drizzle.config.ts`).

### 3.4 Drizzle workflow (the only way schema changes happen)

1. Edit `src/lib/db/schema/app.ts` (never the generated `auth.ts`, never raw SQL).
2. `pnpm db:generate` — inspect the emitted SQL in `drizzle/` before applying.
3. `pnpm db:migrate` — apply locally; run the repository tests.
4. Commit schema change **and** migration files together in one commit.

Never edit an already-committed migration; add a new one. Never use
`drizzle-kit push` — migrations are the audit trail.

### 3.5 Better Auth CLI (Spec 02, then rarely)

```bash
pnpm auth:generate  # regenerates src/lib/db/schema/auth.ts
pnpm db:generate    # ALWAYS follows — see §4.2
pnpm db:migrate
```

Always invoke through the `auth:generate` script (§3.1) — never a raw
`npx`/`pnpm dlx` call inline; the script pins the CLI version. Re-run only
when the Better Auth config changes shape (new plugin, new field). The
generated `schema/auth.ts` is committed but not fully hand-off — it needs one
manual correction after every regeneration until the CLI catches up with the
installed core version; see §4.16 before touching it.

---

## 4. Gotchas and Non-Obvious Setup [PLANNED but decided]

**4.1 Turso local vs remote is an env switch, not a code switch.**
`src/lib/db/client.ts` creates one client from `TURSO_DATABASE_URL`. With
`file:local.db` it is a plain local SQLite file and `TURSO_AUTH_TOKEN` may be
empty; with a `libsql://` URL the token is required (`src/lib/env.ts` enforces
this conditionally). No `if (isDev)` branches anywhere else.

**4.2 Better Auth CLI generate, then drizzle-kit generate — in that order.**
The Better Auth CLI writes Drizzle table definitions (`users`, `sessions`,
`accounts`, `verifications`) into `src/lib/db/schema/auth.ts`; it does **not**
create migrations. Skipping the follow-up `pnpm db:generate` leaves the DB
without auth tables and every auth call failing with a table-not-found error.

**4.3 Serwist is disabled in dev.** The Serwist plugin sets
`disable: process.env.NODE_ENV === "development"`. `pnpm dev` serves no
service worker — offline behavior, caching, and the install prompt can only be
tested with `pnpm build && pnpm start`. Do not "fix" offline bugs against the
dev server; you are testing nothing. After testing SW changes, bump nothing
manually — Serwist handles SW versioning from the build.

**4.4 Every internal link goes through the wrapped navigation API.** Because
all routes live under `[locale]`, `src/lib/i18n/navigation.ts` exports
`Link`, `useRouter`, `usePathname`, `redirect`, `getPathname` from next-intl's
`createNavigation`. Importing `next/link` or `next/navigation` for an internal
route produces locale-less URLs that 404 or drop the user to the default
locale. Grep before review: the only allowed `next/link` usages are external
`<a>`-equivalent cases (none expected).

**4.5 Tailwind 4 has no `tailwind.config`.** Design tokens live in
`src/app/globals.css` under `@theme` (CSS-first configuration). Don't create a
`tailwind.config.ts` — plugins and tokens are declared in CSS (`@plugin`,
`@theme`). Content scanning is automatic.

**4.6 TypeScript 7 is the native (Go) compiler.** `tsc` on this repo is the
TS7 native port — same CLI name, dramatically faster, but stricter about a few
legacy patterns and not always in feature-parity with editors' bundled 5.x.
Point your editor at the workspace TypeScript version. If `pnpm typecheck`
and the editor disagree, the CLI verdict wins.

**4.7 Vercel Blob needs a real token even in dev.** There is no local Blob
emulator. Pull the dev token from the linked Vercel project:
`vercel link` once, then `vercel env pull .env.local` (this fills
`BLOB_READ_WRITE_TOKEN`). Without it, `/api/extract` fails at the upload step
— photo capture UI can still be developed offline against the queue.

**4.8 Timestamps are integer ms — never Date strings.** All schema timestamp
columns use `integer` with `{ mode: "timestamp_ms" }`; Drizzle hands you
`Date` objects and stores `getTime()` values. Never store an ISO string, never
store seconds. When comparing or bucketing, work with the epoch-ms number;
when displaying, format with `Intl.DateTimeFormat` and the active locale.

**4.9 Photo queue ids are client-generated nanoids — idempotency depends on
this.** The offline queue (Dexie) assigns each captured photo a nanoid(21) at
capture time. That id is reused as the Blob pathname
(`users/{userId}/photos/{entryId}.webp`, `addRandomSuffix: false`) and becomes
`price_entries.id` when the user confirms. A retry after a dropped connection
therefore overwrites the same blob, and the confirm action **inserts with
`onConflictDoNothing`** so a replay never duplicates the row. Never regenerate
an id on retry; never let the server mint ids for queued items.

**4.10 Category changes fan out.** The enum in
`src/lib/domain/categories.ts` is referenced by both message files, the AI
extraction prompt (Spec 03), and the checklist registry in §2.3 of this file.
The DB stores raw id strings, so renames are data migrations. Follow the
checklist comment — it exists because the compiler cannot catch a stale
prompt.

**4.11 `pnpm` is not always on `PATH` on this Windows dev machine.** Neither
Git Bash nor PowerShell resolve `pnpm` by default, and `corepack enable`
fails with `EPERM` writing shims into `C:\Program Files\nodejs` without admin
rights. Fix once per shell session: `npm install -g pnpm`, then prepend
`C:\Users\<user>\AppData\Roaming\npm` to `PATH` for that shell (Bash:
`export PATH="$PATH:/c/Users/<user>/AppData/Roaming/npm"`). `corepack pnpm`
also works ad hoc but does **not** put a `pnpm` binary on `PATH`, so tools
that spawn `pnpm` as a subprocess (e.g. `create-next-app --use-pnpm`) still
fail with `ENOENT` even when `corepack pnpm -v` succeeds.

**4.12 Biome's CSS parser needs `tailwindDirectives: true` for Tailwind 4
at-rules.** From Biome ~2.5, `@custom-variant` and `@theme` in
`src/app/globals.css` are rejected as parse errors unless `biome.json` sets
`"css": { "parser": { "tailwindDirectives": true } }`. Without it, `pnpm lint`
fails on the theming file even though the CSS is correct Tailwind 4 syntax.

**4.13 Next.js 16 rewrites `AGENTS.md` on every `next dev`/`next build`
unless disabled.** The "agent rules" feature appends a generated
`<!-- BEGIN:nextjs-agent-rules -->` block to this file describing the
installed Next.js version. This repo's `AGENTS.md` is a hand-maintained
contract, not a target for codegen — `next.config.ts` sets `agentRules:
false`. If a future Next upgrade reintroduces unwanted writes to project
docs, keep the flag; do not let generated content live in a committed file.

**4.14 Pin the Playwright browser locale, or the root-path smoke test is
flaky.** next-intl's middleware negotiates the locale from `Accept-Language`
when no `theme`/locale cookie is set. Playwright's default browser context
locale follows the host OS/CI runner, which is often `en-US` — that then
outranks the app's Italian default at `/`, and
`tests/e2e/smoke.spec.ts`'s Italian-heading assertion fails nondeterministically.
Fix: `playwright.config.ts` → `projects[].use.locale = 'it-IT'`. Any new
Playwright project added later (desktop in Spec 05, WebKit in Spec 06) needs
the same explicit locale.

**4.15 SQLite's `RESTRICT` FK action is not deferred to end-of-statement —
never use it when a cascading delete elsewhere can touch the same row
first.** Every other FK action (including the default `NO ACTION`) is
checked once, after the whole statement's cascades have run. `RESTRICT`
checks immediately, per row, as the cascade executes. `price_entries` has
both `productId → products.id` and `userId → users.id` (cascade); with
`productId` set to `restrict`, a single `DELETE FROM users` that cascades to
both `products` and `price_entries` could fail with a spurious FK violation
depending on which sibling cascade SQLite processes first (reproduced with a
minimal 3-table case). If a future table needs "block deletion while
children exist" semantics on a column that a cascade can also reach
transitively, default to omitting `onDelete` (`NO ACTION`) instead of
`restrict` — same user-facing blocking behavior for a direct delete, no
same-statement cascade race.

**4.16 `@better-auth/cli` lags behind the `better-auth` core package's own
versioning — pin an actual published version, and expect to patch the
output by hand.** There is no `@better-auth/cli@^1.7.0`; the CLI package
tops out around `1.4.22`/`1.5.0-beta.x` while `better-auth` core is at
`1.7.1`. Two consequences, both already applied in
`src/lib/db/schema/auth.ts` (correction note at the top of that file) and
`package.json`'s `auth:generate` script: (1) the CLI needs explicit
`--config src/lib/auth/auth.ts --output src/lib/db/schema/auth.ts` — it does
not autodetect either path in this project layout; (2) the CLI's schema
output is missing an `issuer: text('issuer').notNull()` column on
`accounts` that core 1.7.1 requires at runtime (`signUpEmail` throws "The
field 'issuer' does not exist..." without it) — re-add that column by hand
after every `pnpm auth:generate` until a CLI version that understands core
1.7+ ships. Check the latest `@better-auth/cli` version whenever this comes
up again; don't assume today's pin is still the best available.

**4.17 The test DB factory uses a uniquely-named temp file, never
`:memory:` — an anonymous in-memory libSQL connection silently resets
itself the instant a `db.transaction()` callback throws.** Verified with a
minimal repro: a table created before the transaction becomes "no such
table" on the very next query after a rolled-back transaction on the same
connection — this broke the `mergeProducts` rollback tests outright.
`file::memory:?cache=shared` avoids that crash but shares ONE anonymous
database across every client in the process (verified: an unrelated second
client immediately sees the first client's rows), breaking per-test
isolation. `@libsql/client` also rejects the standard SQLite named-memory-db
escape hatch (`file:name?mode=memory&cache=shared` → "Unsupported URL query
parameter 'mode'"). `src/lib/db/testing/create-test-db.ts` instead creates a
fresh temp file per call under `os.tmpdir()`, cleaned up on
`process.on('exit')` — same fresh-DB-per-test contract, none of the three
bugs above.

**4.18 A local file database needs WAL + a busy_timeout, or a handful of
concurrent requests throws `SQLITE_BUSY: database is locked`.** SQLite's
default rollback-journal mode serializes readers and writers tightly enough
that Playwright's parallel workers hitting `GET /api/export` reproduced it
reliably. `src/lib/db/client.ts` runs `PRAGMA journal_mode = WAL` and
`PRAGMA busy_timeout = 5000` once per process, only for `file:` URLs (Turso
remote already handles concurrency server-side). Fire-and-forget, not
awaited — a top-level `await` there breaks `tsx`'s CJS transform for
`scripts/*` — safe because the local driver executes synchronously
under the hood and `journal_mode=WAL` is persisted in the file itself, so
even a worst-case race self-heals after the first successful run.

**4.19 Better Auth's sign-out route (and any other state-changing call on an
existing session) enforces an Origin check that Playwright's `page.request`
doesn't satisfy by default.** Sign-in and sign-up work fine without extra
headers (open, unauthenticated entry points), but `POST /api/auth/sign-out`
403s with `MISSING_OR_NULL_ORIGIN` unless the request carries an `Origin`
header matching a trusted origin — `page.request.post()` is a raw API call,
not a real in-page `fetch()`, so it never sends one on its own (verified via
curl too). Pass `headers: { Origin: new URL(page.url()).origin }` explicitly
on any E2E call to a Better Auth route that acts on an authenticated
session, not just anonymous sign-in/sign-up.

**4.20 Next.js dev (Turbopack) can return a truncated response when several
Playwright workers race to be the first request to compile a route.**
Several E2E tests requesting `/` and `/en` as their very first action,
started by parallel workers at once, intermittently produced "Unexpected
end of JSON input" server-side instead of queuing behind the first compile
(reproduced twice, on different routes each time). `tests/e2e/global-setup.ts`
now does one serial warm-up `page.request.get()` per route before the
parallel run starts — stable across repeated runs since. Add a warm-up call
there for any new top-level route a future spec's E2E suite hits from
multiple parallel tests.

**4.21 Node's `--env-file` throws if the file is missing — CI has no
`.env.local`, so any `tsx --env-file=...` script fails there.** Caught by
the CI `e2e` job: `pnpm db:seed` worked locally and failed in CI with
`.env.local: not found`, because CI injects env vars via the workflow's
`env:` block, not a file. `drizzle-kit` doesn't hit this — `drizzle.config.ts`
loads `.env.local` through the `dotenv` package's `config()`, which silently
no-ops on a missing file. Use `--env-file-if-exists=.env.local` (Node 20.12+)
for any `tsx` script invoked by both a local dev workflow and CI/production —
never bare `--env-file` unless the file's presence is actually guaranteed
everywhere the script runs.

---

## 5. Spec-Driven Workflow

### 5.1 Spec index

| Spec | File | One line |
|---|---|---|
| 00 | `docs/specs/00-overview.md` | Canonical contract: names, money rules, taxonomy, routes, env, plan. **Law.** |
| 01 | `docs/specs/01-foundation.md` | Scaffold: Next.js 16, Biome, Vitest/Playwright, next-intl wiring, env validation, CI. |
| 02 | `docs/specs/02-database-auth.md` | Turso + Drizzle schema, migrations, repositories, Better Auth, seed script. |
| 03 | `docs/specs/03-capture-ai.md` | Camera capture, `/api/extract`, Blob upload, Claude Haiku extraction, review flow, product matching. |
| 04 | `docs/specs/04-inflation-engine.md` | Pure index engine: bucketing, carry-forward, Jevons, weighting, chaining, ISTAT comparison, exhaustive tests. |
| 05 | `docs/specs/05-ui-design.md` | Full design system + all screens; produces `DESIGN.md`. |
| 06 | `docs/specs/06-pwa-offline.md` | Serwist, IndexedDB queue, sync manager, install experience, icons. |

Order: **01 → 02 → (03 ∥ 04) → 05 → 06**. Spec 04 depends on 02 for types
only — it can proceed against the schema definitions without a running DB.

### 5.2 One spec per session

The protocol, per session:

1. Read `CLAUDE.md` → "Current status" to confirm where the project actually is.
2. Read the target spec **in full**, plus 00-overview §5–§6 again.
3. Use the **Implementation Prompt at the end of the spec file** as the task
   definition — it is written to be self-sufficient for that session.
4. Implement only that spec's scope. Resist pulling forward work from later
   specs; stubs belong to the spec that owns them.
5. Gate before finishing: `pnpm lint && pnpm typecheck && pnpm test`
   (plus `pnpm test:e2e` when the spec touches user flows).
6. Update `CLAUDE.md` → "Current status" (what is done, what is next, any
   deviations that were written back into the specs).
7. Commit with Conventional Commits. One logical change per commit — a spec
   typically lands as a short series (`feat: …`, `test: …`, `docs: …`), not
   one mega-commit.

If an implementation forces a contract change (name, column, route), stop,
edit `docs/specs/00-overview.md` first, then continue — the contract never
drifts silently.

### 5.3 Recommended model and effort per spec (from overview §12)

| Spec | Title | Depends on | Model | Effort |
|---|---|---|---|---|
| 01 | Foundation & Scaffold | — | Claude Sonnet 5 | medium |
| 02 | Database & Auth | 01 | Claude Sonnet 5 | high |
| 03 | Capture & AI Extraction | 02 | Claude Opus 5 | high |
| 04 | Inflation Engine | 02 (types only) | Claude Opus 5 (Fable 5 if available) | xhigh |
| 05 | UI & Design System | 02–04 | Claude Fable 5 + impeccable skill | xhigh |
| 06 | PWA & Offline | 03, 05 | Claude Opus 5 | high |

### 5.4 Definition of done (every task, not just specs)

- `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.
- New behavior has tests (pure logic → unit; wiring → integration; critical
  user path → E2E).
- Both message files updated for any new user-facing string.
- No new import-rule violations (§1.5), no unscoped queries (§1.9), no float
  money (§1.2).
- `CLAUDE.md` status updated when a milestone lands.

---

## 6. References

| Document | What it governs | When to read |
|---|---|---|
| `docs/specs/00-overview.md` | The contract: names, shapes, decisions | Every session, before writing code |
| `docs/specs/01–06` | Per-area implementation specs | The one you are implementing, in full |
| `docs/DEVELOPMENT_GUIDELINES.md` | Layers, naming, errors, testing, security, performance | Once fully; re-check when unsure |
| `docs/COMMENTS.md` | Comment types and discipline | Before writing any code with comments |
| `DESIGN.md` | Tokens, typography, layout vocabulary, animation, anti-patterns | **Mandatory before any UI work** — exists after Spec 05 |
| `CLAUDE.md` | Current implementation status + working notes | First thing, every session |
| `CONTRIBUTING.md` | External-contributor workflow (PRs, issues) | When touching contribution flow |

Precedence when documents appear to conflict:
`00-overview.md` → the area spec → `AGENTS.md` → the general guideline docs.
A real conflict is a bug: fix the documents, starting from the top.
