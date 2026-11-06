# AGENTS.md — Operating Manual for Coding Agents

This file is the operating manual for AI coding agents (and humans) working in
the **segnaprezzi** repository: the conventions and setup traps that hold for the
whole repo. Domain narratives live in `docs/guide/`, one file per theme, read
only when you touch that domain: § Domain guides says which, and carries what to
know before opening one. Session rules are in `WORKFLOW.md`.

> **Current state**: segnaprezzi has a real DB, real auth, real repositories,
> one real Anthropic gateway (shelf tags, Claude Opus 5.5), the pure
> personal-CPI engine with its service and the committed ISTAT series, every
> screen of the app in the "tabulato a modulo continuo" visual world recorded
> in **`DESIGN.md`** (mandatory reading before any UI work), and a real
> service worker with the sync engine that drains the photo queue. Receipt
> import was built, shipped and retired (2026-10-27): receipts rarely print
> the unit price the index needs. The current implementation
> state is tracked in **`CLAUDE.md` → "Current status"** — read it first,
> trust it over any assumption. Where this file's guidance and the
> actually-implemented code differ, this file describes what was actually
> verified to work (§4 and the guides).

**Reading order for any session**:
`CLAUDE.md` (state) → `WORKFLOW.md` (session/collaboration rules — branch,
commit, and guided-collaudo discipline) → this file (conventions) →
`DEVELOPMENT_GUIDELINES.md` and `COMMENTS.md` (general discipline)
→ the guide in `docs/guide/` for the domain you touch
→ **`DESIGN.md`** whenever the session touches anything under
`src/components/` or a `*.tsx` in `src/app/`.

---

## 1. Project-Specific Patterns and Conventions

### 1.1 Canonical names are law

The table names, column names, enum values, and category taxonomy already in
the codebase (`src/lib/db/schema/`, `src/lib/domain/`) are the **single
source of truth**. Use those exact names. Never invent a synonym, never
"improve" a name, never contradict it.

Ground rules:

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
// src/lib/domain/money.ts: integer milli-euros per base unit, rounded half-up.
// calculateUnitPriceMilli(249, 0.5) === 4980   // €2.49 for 500 g → €4.98/kg
// calculateUnitPriceMilli(9160, 50.9) === 1800 // €91.60 for 50.9 L → €1.80/L
export function calculateUnitPriceMilli(totalPriceCents: number, packageSize: number): number {
  return Math.round((totalPriceCents * 10) / packageSize);
}
```

- Arithmetic on money (sums, conversions) is integer arithmetic with a single
  explicit `Math.round` at the end. The integer conversions
  (`calculateUnitPriceMilli`, `toCents`, `toMilli`, `centsToMilli`) live in
  `src/lib/domain/money.ts` — pure, integer in/out, string-free.
- **All** string rendering of money (and every other `Intl.NumberFormat` /
  `Intl.DateTimeFormat` display helper) lives exclusively in
  `src/lib/format.ts`, which divides at the last moment
  (`cents / 100`, `milli / 1000`) — components never divide by 100
  themselves. Input parsing (`parseDecimalInput`, comma or dot, `null` when
  not a number) lives there too; `money.ts` stays string-free.
- The **only** place floats are legitimate: index math in `src/lib/inflation/`
  (price relatives and means are ratios, not money) and `package_size`
  (a physical quantity, stored as `real`). Sums of integer money stay exact in a
  double, so monthly means are bit-identical for any input order; the logs
  iterate in sorted order for the same reason.
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
per 100 mL, per etto, etc. are normalized **at extraction time** and
in every manual form: €/100g × 10 = €/kg; €/100mL × 10 = €/L. `src/lib/domain/units.ts`
defines the `UnitKind` enum, the base-unit display symbols, and
`convertToBaseUnits` (which rounds: `700 * 0.001` is `0.7000000000000001` in
binary floating point, and that noise would be persisted into `package_size`);
the price arithmetic is `calculateUnitPriceMilli` in `money.ts` above —
nothing outside `domain/` hand-rolls a unit conversion.

**Do not assume a product category implies a unit kind.** Fuel is the standing
counter-example: petrol, diesel and LPG are per litre, Italian CNG (metano) per
**kilogram**. Each entry in `FUEL_QUICK_PICKS` carries its own `unitKind`, and
`createFuelEntry` reads it from the pick rather than hardcoding `'volume'`.

### 1.4 Time and month bucketing (Europe/Rome)

- Storage is epoch **ms UTC**, everywhere, no exceptions (see §1.1).
- The inflation engine buckets entries into **calendar months in the
  Europe/Rome timezone** — a purchase at 00:30 on May 1st Rome time belongs to
  May even though it is still April in UTC.
- Month keys are `"YYYY-MM"` strings, derived with `Intl.DateTimeFormat` (no
  date library dependency):

`toRomeYearMonth(ms)` in `src/lib/inflation/bucketing.ts` uses a module-level
`romeYearMonthFormatter` (`new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', … })`):
`en-CA` gives ISO-like parts so the Intl database owns DST, and one formatter
per module because constructing it costs far more than `.format()`.
`toRomeYearMonth(Date.parse('2026-03-31T22:30:00Z')) === '2026-04'` and
`toRomeYearMonth(Date.parse('2026-01-31T23:30:00Z')) === '2026-02'` (2026 DST
starts 29 March).

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
| `src/app/**` (pages, actions, route handlers) | services, domain, inflation, `lib/i18n`, `lib/auth` helpers, `lib/errors`, components, **the `db` singleton from `lib/db/client`** (to pass into a service — see below) | repositories directly, `lib/ai`, `lib/blob`, `lib/db/schema` |
| `src/lib/services/**` | repositories, gateways (`ai`, `blob`), domain, inflation, `lib/errors` | `next/*`, `react`, `src/app`, `src/components` |
| `src/lib/db/repositories/**` | `lib/db` client + schema, domain (types/enums), `lib/errors` | services, gateways, `next/*`, `react` |
| `src/lib/ai/**`, `src/lib/blob/**` (gateways) | domain, `lib/errors`, `lib/env` | `lib/db`, services, `next/*`, `react` |
| `src/lib/inflation/**` | `src/lib/domain` only | everything else (db, ai, blob, services, next, react) |
| `src/lib/domain/**` | nothing (TS/JS stdlib only) | every other project module |
| `src/lib/offline/**` (client) | domain, `dexie`, `dexie-react-hooks` | `lib/db`, services, gateways, server-only modules, `next/*` (the sync engine also runs inside `src/app/sw.ts`) |
| `src/components/**` | domain, `lib/i18n` navigation, `motion`, other components | `lib/db`, repositories, services, gateways, `lib/env` |
| `src/lib/auth/**` | `lib/db` (adapter needs it), `lib/env` | services, components |

The `db`-singleton carve-out (established by the `/api/export` route, followed
by every capture page and action and by `getPersonalCpi(db, userId)`): services
take the Drizzle handle first, like repositories, so the confirm flow can pass a
transaction and tests a throwaway database. The app layer only passes it through:
reading or writing through it in a page or an action is forbidden.

Enforcement is by review until a lint rule exists. When in doubt: **data flows
down, types flow up, and `domain/` + `inflation/` import nothing**.

### 1.6 The pure-domain rule

`src/lib/domain/` and `src/lib/inflation/` are **pure**: plain functions,
deterministic, zero I/O, no framework imports, no environment access, no
`Date.now()` buried inside (time is always a parameter). This is what makes
the index engine exhaustively unit-testable (its test plan depends on
it). If a function in these directories needs a repository, the design is
wrong — the **service** fetches, the pure function computes.

### 1.7 Error handling: DomainError codes + translation at the boundary

Expected errors are `DomainError` subclasses in `src/lib/errors.ts`
(`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ExtractionError`).
The `code` is a stable `DomainErrorCode`, a SCREAMING_SNAKE string union that
doubles as the i18n key under the `errors` namespace (`errors.NOT_FOUND`).
Classes carry **no** HTTP status. `new.target.name` keeps subclass names in stack
traces without each one setting `this.name`.

- **Codes**: `NOT_FOUND`, `VALIDATION_FAILED`, `UNAUTHORIZED`,
  `EXTRACTION_FAILED`, `INTERNAL`; for capture `INVALID_INPUT`, `INVALID_DATE`,
  `INVALID_PRICE`, `INVALID_SIZE`, `INVALID_STORE_KIND`,
  `INCONSISTENT_FUEL_PRICES`, `SESSION_NOT_FOUND`, `STORE_NOT_FOUND`,
  `PRODUCT_NOT_FOUND`, `SESSION_CLOSED`, `PHOTO_TOO_LARGE`,
  `UNSUPPORTED_PHOTO_TYPE`, `EXTRACTION_UNAVAILABLE`. The seven `RECEIPT_*` codes
  left with receipt import. A new code follows the checklist in §2.3.
- **HTTP**: `HTTP_STATUS_BY_CODE` in `src/app/api/route-errors.ts`, one
  exhaustive `Record<DomainErrorCode, number>` shared by every route handler, so
  the compiler catches a code without a status. `NOT_FOUND` → 404,
  `VALIDATION_FAILED` → 400, `UNAUTHORIZED` → 401, `EXTRACTION_FAILED` → 422,
  `INTERNAL` → 500.
- **Actions**: every Server Action returns
  `ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError }`,
  with `ActionError = { code; message; issues?: string[] }`. The client narrows on
  `ok` and translates `error.code`. `toActionError()` is the mapper.

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
- The Claude extraction response — the model's output is untrusted
  input; parse it against the extraction schema before showing it to the user.
- Environment variables — `src/lib/env.ts` validates every required variable
  with Zod at boot and **fails fast** with a readable message.
- IndexedDB queue items on sync replay (data may come from an old app
  version).

Schemas live next to the boundary that uses them; shared field shapes (money,
nanoid ids, month keys) are composed from small reusable schemas. Inside the
service/domain layers, inputs are already typed — do not re-validate.

Reusable field schemas are in `src/lib/domain/schemas.ts`: `nanoidSchema`
(`z.string().length(21)`), `priceCentsSchema`, `unitPriceMilliSchema`,
`epochMsSchema` (each `z.number().int().positive()`).

### 1.9 Repository pattern — every query is user-scoped (security invariant)

The app is multi-tenant by `user_id`. **Every repository function has the
signature `(db: Db, userId: string, ...)`** — `db` injected first (services
pass the singleton from `src/lib/db/client.ts`, tests pass a
throwaway file-backed instance from `src/lib/db/testing/create-test-db.ts`,
**not** `:memory:` — see §4.17; repositories never import the `db` singleton
themselves) and `userId` second, included in every `WHERE` clause and JOIN
condition. No exceptions, not even "the id is already unique". This is the
single invariant that prevents cross-user data leaks; it is cheaper to
enforce mechanically than to reason about per-query.

The shape is `getStoreById(db, userId, storeId)` in
`src/lib/db/repositories/stores.ts`:
`.where(and(eq(stores.userId, userId), eq(stores.id, storeId)))`, returning
`rows[0] ?? null`.

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
The complete list:

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
| `pwa` | Install prompt and install sheets |

### 1.12 Design tokens (semantic only)

- Tailwind 4: tokens are defined in `src/app/globals.css` under `@theme` —
  there is **no `tailwind.config.*`** (see §4). `DESIGN.md` is the
  authoritative record of every token, type role, spacing and motion rule —
  read it before touching UI.
- Components use **semantic token utilities only** (`bg-surface`,
  `text-text-muted`, `bg-band`, `text-accent-ink`, …). Never hex colors,
  never `text-[#123456]` arbitrary values, never Tailwind palette colors
  (`bg-orange-600`, `text-white`) in components — the only literal colors
  live in `src/app/globals.css` and `docs/assets/logo.svg`. The viewfinder
  uses the theme-invariant `camera` / `camera-contrast` tokens, not
  `black`/`white`.
- **Accent has two utilities on purpose**: `bg-accent` / `text-accent` for
  fills and icons (the highlighter, 3.3:1 on paper) and `text-accent-ink`
  for any *word* in accent (≥ 4.5:1). Text on `bg-accent` is
  `text-accent-contrast` (ink), never white.
- **One meaning per color**: `negative` = a price that went **up**,
  `positive` = a price that went **down**, `warning` = needs a human look,
  `promo` = promotional price, `accent` = the one live/active thing.
- Colors are OKLCH at the token layer. Motion uses `houseSpring` /
  `quickFade` from `src/lib/motion.ts` (stiffness 400, damping 35) and asks
  `useAppMotion()` about reduced motion — ad-hoc spring values are forbidden.
- Breakpoints are the named `tablet:` (48rem), `rail:` (64rem), `desktop:`
  (90rem) variants; `sm:`/`md:`/`lg:` are reset to nothing.
- Every display number goes through `src/lib/format.ts`; every data element
  is `font-mono` (tabular by the base stylesheet); every list of rows is a
  `zebra` list of 48 px rows.

### 1.13 Comments discipline (digest of COMMENTS.md)

Six allowed comment types — each shown with a project-specific example:

| Type | Use for | Example (one-liner) |
|---|---|---|
| **Function** | Interface contract on exported functions | `/** Compute the chained index series; one point per Rome month, base month = 100. */` |
| **Design** | File/section-level approach + trade-offs | `// Matched-model Jevons within categories, expenditure-weighted across them — mirrors ISTAT elementary aggregates.` |
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

## 2. Code Organization and Structure

### 2.1 The tree, annotated

One line per group of files, with what must never appear there. What each module
does is in its own header comment.

```
segnaprezzi/
├── docs/assets/        # Logo, favicon source SVG (build inputs, not served).
├── docs/guide/         # Domain guides, one file per theme (§ Domain guides).
├── data/istat-nic.json # Committed ISTAT series. Only scripts/update-istat.ts writes it.
├── drizzle/            # Generated SQL migrations + meta. Never hand-edited; always committed.
├── scripts/            # tsx entry points (seed, update-istat, generate-icons, prune-photos) and pure
│                       #   helpers (seed-ids, seed-users, istat-nic). May import src/lib/**; nothing imports scripts/.
├── messages/           # it.json (default locale) and en.json. Same key tree, always.
├── public/             # PWA icons, manifest assets. Static only, no source files.
├── src/
│   ├── app/            # App Router: [locale]/(app)/ pages, colocated actions.ts, globals.css (@theme), layout.
│   │   │               #   NEVER: business logic, Drizzle queries, fetch to Anthropic.
│   │   ├── [locale]/(app)/ # A screen too long for one file keeps its parts in its route folder, beside
│   │   │               #   page.tsx and actions.ts (scan/review, add/manual, history, products,
│   │   │               #   products/[id], settings); *-derivations, catalog-view and chart-window are pure and tested.
│   │   └── api/        # Only the handlers in §1.10, plus route-errors.ts: the one status table and error body.
│   ├── components/     # ui/ (primitives, use-focus-trap), pwa/ (client-only), charts/ (hand-rolled SVG, scale.ts
│   │                   #   pure and tested), capture/, entries/, products/, auth/, layout/.
│   │                   #   NEVER imports db/, services/, ai/, blob/, env, nor Server Actions:
│   │                   #   screens pass actions down as callbacks.
│   ├── lib/
│   │   ├── domain/     # Shared rules and wire types (categories, units, money, schemas, entries…). Pure, zero imports.
│   │   ├── inflation/  # Index engine. Pure, imports domain/ only. The most heavily unit-tested code.
│   │   ├── db/         # client.ts (env-driven libSQL + Drizzle), schema/ (auth.ts CLI output, app.ts ours, index.ts),
│   │   │               #   repositories/ (one module per aggregate, queries only, all userId-scoped), testing/.
│   │   ├── services/   # Use cases (create-price-entry, confirm-shopping-session, dashboard, inflation, export…).
│   │   │               #   Orchestration only: no SQL, no HTTP, no JSX.
│   │   ├── ai/         # The Anthropic gateway: shelf-tag call, prompt, response schema, toAiGatewayError.
│   │   ├── blob/       # Vercel Blob gateway: upload/delete photo.
│   │   ├── offline/    # CLIENT-side: Dexie schema, photo queue, sync manager, safe-storage.ts. Never imported by server code.
│   │   ├── auth/       # auth.ts (Better Auth config), client.ts, session.ts (requireUser).
│   │   ├── i18n/       # routing.ts, navigation.ts (wrapped Link/router), request.ts.
│   │   ├── env.ts      # Zod-validated env access. The ONLY file reading process.env.
│   │   ├── format.ts   # ALL Intl display formatting (money, dates, units) + input parsing.
│   │   ├── motion.ts   # houseSpring, quickFade, chartDraw…, useAppMotion(): the only place springs and easings are declared.
│   │   ├── errors.ts   # DomainError + DomainErrorCode + ActionResult (§1.7).
│   │   └── …           # theme.ts, call-action.ts (client guard), action-results.ts (server-only), redirects.ts
│   │                   #   (no open redirect), cx.ts, use-media-query.ts, use-container-width.ts.
│   └── middleware.ts   # next-intl locale routing + auth guard.
├── tests/e2e/          # Playwright specs (*.spec.ts). Critical paths only.
├── AGENTS.md · CLAUDE.md · DESIGN.md · PRODUCT.md · README.md · CONTRIBUTING.md · COMMENTS.md · DEVELOPMENT_GUIDELINES.md
└── LICENSE (MIT) · biome.json · drizzle.config.ts · next.config.ts · package.json
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
- The inflation engine carries an exhaustive numeric test plan — those tests
  are the correctness contract of the whole app; never weaken one to make an
  implementation pass.

### 2.3 Fan-out checklists (update these together)

Some changes are multi-file by design. The source file carries a checklist
comment; this section is the registry.

**Adding/renaming a category** (`src/lib/domain/categories.ts`):

Update `messages/it.json` and `messages/en.json` (`categories` namespace), the
AI extraction prompt in `src/lib/ai/` (the model must know the new id), and
AGENTS.md §1.11 if semantics change. The DB stores the raw id string: renaming an
id requires a data migration. `src/lib/domain/categories.ts` carries this as a
`WARNING` comment above `export const categories`.

**Adding a `DomainErrorCode`** (`src/lib/errors.ts`): extend the union, add
the matching `errors.<CODE>` message to **both** `messages/it.json` and
`messages/en.json`, and give it a status in `HTTP_STATUS_BY_CODE`
(`src/app/api/route-errors.ts`).

**Adding an enum value** (e.g. `promo_kind`, `source`, `store.kind`): update
the Zod schema at every boundary that accepts it, both message files if it is
user-visible, and the extraction schema/prompt if the AI can emit it.

**Adding an `EntrySource`** (`src/lib/domain/entries.ts`): add the
`productDetail.source.<id>` label to **both** message files and an icon to
`SOURCE_ICONS` in `src/components/entries/entry-sheet.tsx` (a `Record<EntrySource, …>`,
so the compiler names the site). The history filter chips and the export
schema iterate `ENTRY_SOURCES` and need nothing.

**Adding or renaming a fuel quick pick** (`src/lib/domain/fuel-products.ts`):
add the `addFuel.products.<key>` label to **both** message files, and give the
pick the `unitKind` it is actually sold in (§1.3). Renaming a `canonicalName`
is **not** a copy edit: it is the stored product name, so after entries exist
it splits that fuel's price history in two and becomes a data migration.

**Adding an env var**: `src/lib/env.ts` (Zod), `.env.example`, README setup
section, and the Vercel project settings.

**Adding a route**: `src/middleware.ts` matcher if public/private status
differs, and the tab bar in `components/layout/` if it is a top-level
destination.

**Regenerating `src/lib/db/schema/auth.ts`** (`pnpm auth:generate`): diff the
output against the committed file and keep what the installed core requires
(`docs/guide/auth.md` §4.16); `accounts.issuer` no longer exists (§4.69 there).

---

## 3. Common Commands

### 3.1 Canonical package.json scripts

This exact list is the project contract; do not invent different names for
these scripts.

| Script | Command | When to use |
|---|---|---|
| `dev` | `next dev` | Daily development. Serwist is disabled here (`docs/guide/offline-pwa.md` §4.3). |
| `build` | `next build --webpack` | Production build; also the only way to build the service worker. **The `--webpack` flag is load-bearing** — see `docs/guide/offline-pwa.md` §4.39. |
| `start` | `next start` | Serve the production build locally (PWA testing). |
| `lint` | `biome check .` | The pre-commit check (there is no CI). Formatting AND lint in one pass. |
| `lint:fix` | `biome check --write .` | Auto-fix before committing. Run it, don't hand-format. |
| `typecheck` | `tsc --noEmit` | Always run before declaring a task done; `next build` alone is not the type gate. |
| `test` | `vitest run` | Full unit/integration suite, single pass. |
| `test:watch` | `vitest` | TDD loop while implementing (essential for the inflation engine). |
| `test:e2e` | `playwright test` | Critical-path E2E + axe. Four projects (`mobile`, `desktop`, `offline-queue`, `pwa`); runs `pnpm build && pnpm start` itself (§4.41). `PORT=3100 pnpm test:e2e` when :3000 is taken (§4.32). |
| `db:generate` | `drizzle-kit generate` | After every schema change: emits SQL migration into `drizzle/`. |
| `db:migrate` | `drizzle-kit migrate` | Apply pending migrations to the DB in `TURSO_DATABASE_URL`. |
| `db:studio` | `drizzle-kit studio` | Browse/edit data in a local GUI while debugging. |
| `db:seed` | `tsx --env-file-if-exists=.env.local scripts/seed.ts` | Populate the local DB with demo data (products, entries across months). Not `--env-file` — see §4.21. |
| `auth:generate` | `pnpm dlx @better-auth/cli@1.4.22 generate --yes --config src/lib/auth/auth.ts --output src/lib/db/schema/auth.ts` | Regenerate `src/lib/db/schema/auth.ts` after a Better Auth config change; always follow with `pnpm db:generate` (`docs/guide/auth.md` §3.5, §4.2, §4.16). |
| `icons` | `tsx scripts/generate-icons.ts` | Regenerate PWA icon set from `docs/assets/logo.svg` into `public/`. |
| `istat:update` | `tsx scripts/update-istat.ts` | Refresh `data/istat-nic.json` from ISTAT; commit the diff. |
| `photos:prune` | `tsx --env-file-if-exists=.env.local scripts/prune-photos.ts` | Report (or `--delete`) entry photos in Blob that no entry references. Dry run by default; run it with the target deployment's env — see `docs/guide/capture.md` §4.61. |

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

### 3.5 Better Auth CLI (rarely needed)

Moved with the rest of auth: `docs/guide/auth.md` §3.5. Always through the
`auth:generate` script, always followed by `pnpm db:generate`.

---

## 4. Gotchas and Non-Obvious Setup

Each gotcha is a rule, with its date and the file or test that fixes it where
one exists; the story behind it is in `git log`. Numbers are stable and never
reused, so a block that moved to a guide keeps its number there.

### Domain guides

| Guide | Read it when you touch | Blocks |
|---|---|---|
| `docs/guide/auth.md` | Better Auth config, its schema, sign-in from scripts or tests | §3.5, §4.2, §4.16, §4.19, §4.42, §4.69 |
| `docs/guide/offline-pwa.md` | photo queue, sync, service worker, manifest, icons, toasts over the camera | §4.3, §4.9, §4.39, §4.40, §4.43–§4.48, §4.76 |
| `docs/guide/capture.md` | AI gateway, prompt, Blob, price invariant, photo deletion | §4.7, §4.51, §4.54, §4.59, §4.61, §4.63, §4.64–§4.66, §4.70 |
| `docs/guide/inflation-index.md` | index engine, coverage figures, ISTAT series and its workflow | §4.27, §4.29, §4.71–§4.73, §4.75 |

**Authentication (Better Auth).** After `pnpm auth:generate`, always run
`pnpm db:generate`, or the DB has no auth tables (§4.2), and diff the result
by hand against the committed file: the CLI lags behind core, so keep what the
installed core requires (§4.16). A script outside a browser must set `Origin`
explicitly on every Better Auth route, and so must any E2E call acting on an
authenticated session (§4.19). Never disable the rate limiter for tests: it is
the app's only brute-force defence (§4.42). An upgrade that touches auth is
verified by a running server and a real sign-in, not by `pnpm test` (§4.69).
The rest — the CLI flags and version history, how the E2E helper waits out a
429, and the `accounts.issuer` story — in `docs/guide/auth.md`.

**Offline queue, service worker and PWA.** `next build` without `--webpack`
emits no service worker and still reports success, and `pnpm dev` serves none:
offline behavior can only be tested with `pnpm build && pnpm start` (§4.3,
§4.39). Idempotency depends on a queued photo's client-generated nanoid: never
regenerate it on retry, never let the server mint ids for queued items (§4.9).
Adding a locale means an entry in `next.config.ts`'s
`additionalPrecacheEntries` and in `src/app/sw.ts`'s `fallbacks` list (§4.40).
In Vitest, fake `Date` only around Dexie, never the timers (§4.43). A new
service worker is never announced: it takes over at the next app start, and
`skipWaiting` stays off so it never swaps chunks under a live page (§4.76). The rest —
the happy-dom `FormData` workaround, Serwist's event and matcher types, the
installability test, the favicon conflict — in `docs/guide/offline-pwa.md`.

**Tag capture, AI extraction and photo storage.** `claude-opus-5-5` returns
400 on `temperature` and pays its thinking tokens out of `max_tokens`, so
leave `temperature` out and `max_tokens` at 8000 (§4.70). A gateway that
needs different SDK options gets its own `Anthropic` instance, not
`client.withOptions()` (§4.51). Blobs do not follow the database's cascades:
any new path that destroys entries owes the store an explicit cleanup, row
first and blob after (§4.59). `isUnitPriceConsistent` is the ONE predicate
the review screens, the fuel form and every write ask, and its tolerance
scales with the package size (§4.63). The rest — the dev Blob token, worked
examples in prompts, the prune tool's guard — in `docs/guide/capture.md`.

**Personal inflation index and ISTAT series.** The index compares each store
with itself: every store keeps its own carried price, a product's relative is
the Jevons of the stores priced in both months, and a price seen only at a new
store reads 0% (§4.72). `isPriceCompared` is not `!isToImputed`, and coverage
counts products, never a share of prices (§4.73). The overall relative is the
Jevons of every compared product: no expenditure weights, nothing in the engine
reads what a package cost (§4.75). The dashboard loads
`data/istat-nic.json` as a static import and never fetches ISTAT at runtime;
ISTAT is always queried with a narrow key (§4.27). `update-istat.yml` needs a
repository setting, not a token, to open its pull request (§4.71). The rest —
the SDMX dataflows and headers, the worked store example, removing the
engine's dead branches (§4.29) — in `docs/guide/inflation-index.md`.

### Setup and tooling

**4.1 Turso local vs remote is an env switch, not a code switch.**
`src/lib/db/client.ts` creates one client from `TURSO_DATABASE_URL`. `file:local.db`
is a plain SQLite file and `TURSO_AUTH_TOKEN` may be empty; a `libsql://` URL
requires the token (`src/lib/env.ts`). No `if (isDev)` branches anywhere else.

**4.5 Tailwind 4 has no `tailwind.config`.** Tokens and plugins are declared in
`src/app/globals.css` under `@theme` and `@plugin`. Don't create a
`tailwind.config.ts`; content scanning is automatic.

**4.6 TypeScript 7 is the native (Go) compiler.** `tsc` is the TS7 native port:
same CLI, stricter about some legacy patterns, not always at parity with an
editor's bundled 5.x. Point the editor at the workspace version. If
`pnpm typecheck` and the editor disagree, the CLI wins.

**4.11 `pnpm` is not always on `PATH` on this Windows dev machine.** Windows:
`corepack enable` fails with `EPERM` on `C:\Program Files\nodejs`; run
`npm install -g pnpm`, then prepend `C:\Users\<user>\AppData\Roaming\npm` to
`PATH` per shell (Bash: `export PATH="$PATH:/c/Users/<user>/AppData/Roaming/npm"`).
`corepack pnpm` works ad hoc but puts no `pnpm` on `PATH`, so a subprocess (e.g.
`create-next-app --use-pnpm`) still fails with `ENOENT` even when
`corepack pnpm -v` succeeds. **Mac**: `corepack enable` fails with `EACCES` on
`/usr/local/bin`, and `corepack pnpm run <script>` dies with `spawnSync pnpm
ENOENT` because pnpm's own `verifyDeps` re-spawns `pnpm`. Fix once:
`corepack enable --install-directory ~/.local/bin`, then every shell and agent
command needs `export PATH="$HOME/.local/bin:$PATH"`.

**4.12 Biome's CSS parser needs `tailwindDirectives: true` for Tailwind 4
at-rules.** From Biome ~2.5, `@custom-variant` and `@theme` in
`src/app/globals.css` are parse errors unless `biome.json` sets
`"css": { "parser": { "tailwindDirectives": true } }`.

**4.13 Next.js 16 rewrites `AGENTS.md` on every `next dev`/`next build`
unless disabled.** The generated `<!-- BEGIN:nextjs-agent-rules -->` block is
kept out by `agentRules: false` in `next.config.ts`. This file is a
hand-maintained contract: keep the flag through any Next upgrade, and let no
generated content live in a committed file.

**4.21 Node's `--env-file` throws if the file is missing — any environment
without `.env.local` (a fresh clone, a GitHub Actions job, Vercel) breaks a
`tsx --env-file=...` script.** Use `--env-file-if-exists=.env.local` (Node
20.12+) for any `tsx` script run both locally and elsewhere. `drizzle-kit` is
immune: `drizzle.config.ts` loads `.env.local` through the `dotenv` package's
`config()`, which no-ops on a missing file. The former CI `e2e` job caught
`pnpm db:seed` failing with `.env.local: not found`, env vars coming from an
`env:` block.

**4.30 The Bash tool on this Windows machine truncates long commands (~8 KB).**
The symptom is `unexpected EOF while looking for matching `''`: the command was
cut, not mis-quoted. Write new source files with the Write tool, make edits with
short Python one-liners, and split multi-file documentation edits, including
Python scripts with large `old`/`new` blocks.

**4.31 Python one-liners on Windows write CRLF unless told otherwise.**
`open(path, 'w')` in text mode turns `\n` into `\r\n`, and Biome then fails every
touched file ("Formatter would have printed…") on a diff that looks unchanged.
Open with `newline=''`, write bytes, or normalize CRLF→LF over `git status` files
before `pnpm lint`. Biome's `--write` does the reverse: it rewrites a CRLF file
to LF, so convert it back and count CRs with `tr -cd '\r' | wc -c` (what
`grep -c $'\r$'` gets wrong in Git Bash). The index is LF throughout (`git ls-files --eol`);
with `core.autocrlf=true` the checkout is CRLF and `pnpm lint` fails about
twenty of those files as they come out of git (2026-11-06). On Windows run
`pnpm lint:fix` first: it rewrites the checkout to LF, which is content-neutral
for git — `git status` may list the files, `git add` normalizes them and the
commit holds no change. Never `git checkout` them back to CRLF to quiet the
status: that is what made the gate red.

**4.77 `pnpm typecheck` reads `.next/types`, so a stale build output fails it
on routes that no longer exist.** A `.next/` left by an older checkout (the
retired receipt pages, 2026-11-06) breaks `tsc --noEmit` with `Cannot find
module '../../../src/app/[locale]/(app)/add/receipt/page.js'` while the source
tree is fine. `rm -rf .next` and run it again; the directory is gitignored.

**4.38 The impeccable decision page needs an unsandboxed shell.**
`serve-question.mjs --start` binds a local port and daemonizes, so run it and
the `--wait` with the sandbox disabled, then open the printed URL with
`Start-Process` from PowerShell.

**4.50 A `biome-ignore` suppression must be ONE comment node.** Biome reads only
the first of several consecutive `//` lines, then reports both
`suppressions/unused` and the original rule. Use a `/* … */` block for a
multi-line justification (`{/* … */}` inside JSX children), directly above the
node.

**4.53 An all-ASCII binary fixture needs a `.gitattributes` entry, or
`core.autocrlf` silently corrupts it.** Git classifies a hand-written PDF with no
compressed streams as text and rewrites its line endings under Windows'
`core.autocrlf=true`, which breaks every xref offset while a test hashing the
file on disk still passes. `.gitattributes` declares `*.pdf` and the image formats
`binary`; verify with `git cat-file -p :<path> | sha256sum`. The fixture is gone;
the attributes file stays.

**4.68 pnpm 11 reads `overrides` from `pnpm-workspace.yaml`, not from
`package.json`.** A `"pnpm": { "overrides": … }` block in `package.json` is
accepted silently and does nothing: `pnpm why` still shows the old version. The
overrides in `pnpm-workspace.yaml` (`vite`, `browserslist`, `esbuild@<0.24.3`,
`glob`, `minimatch`) exist because a parent pins a vulnerable version (vitest,
`@serwist/utils` with an exact `4.28.6`, drizzle-kit's `@esbuild-kit`, `@serwist`
with an exact `glob`); `docs/guide/dipendenze.md` says when each can go.
`pnpm update --depth Infinity <name>` is enough when the parent's range already
allows the fix (`brace-expansion`, `source-map-js`); an exact pin needs the
override.

### Data and schema

**4.8 Timestamps are integer ms — never Date strings.** Schema timestamps are
`integer` with `{ mode: "timestamp_ms" }`; Drizzle hands you `Date` objects and
stores `getTime()` values. Never store an ISO string or seconds. Compare and
bucket on the epoch-ms number; display with `Intl.DateTimeFormat` and the active
locale.

**4.10 Category changes fan out.** `src/lib/domain/categories.ts` is referenced
by both message files, the AI extraction prompt and the registry in §2.3. The DB
stores raw id strings, so renames are data migrations. The compiler cannot catch
a stale prompt: follow the checklist comment.

**4.15 SQLite's `RESTRICT` FK action is not deferred to end-of-statement —
never use it when a cascading delete elsewhere can touch the same row
first.** Every other FK action, including the default `NO ACTION`, is checked
after the statement's cascades; `RESTRICT` checks per row as they run. With
`productId → products.id` set to `restrict` and `userId → users.id` cascading on
`price_entries`, a `DELETE FROM users` could fail with a spurious FK violation.
For "block deletion while children exist" on a column a cascade can reach, omit
`onDelete` (`NO ACTION`) instead of `restrict`.

**4.17 The test DB factory uses a uniquely-named temp file, never
`:memory:` — an anonymous in-memory libSQL connection silently resets
itself the instant a `db.transaction()` callback throws.** The table becomes "no
such table" on the next query, which broke the `mergeProducts` rollback tests.
`file::memory:?cache=shared` shares ONE database across every client in the
process, and `@libsql/client` rejects `file:name?mode=memory&cache=shared`
("Unsupported URL query parameter 'mode'").
`src/lib/db/testing/create-test-db.ts` creates a fresh temp file per call under
`os.tmpdir()`, cleaned up on `process.on('exit')`.

**4.18 A local file database needs WAL + a busy_timeout, or a handful of
concurrent requests throws `SQLITE_BUSY: database is locked`.** Playwright's
parallel workers on `GET /api/export` reproduced it. `src/lib/db/client.ts` runs
`PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` once per process,
only for `file:` URLs. Fire-and-forget on purpose: a top-level `await` there
breaks `tsx`'s CJS transform for `scripts/*`, and `journal_mode=WAL` persists in
the file, so a race self-heals.

**4.23 Seed ids are padded to 21 characters — never add a short readable id.**
`scripts/seed-ids.ts` → `seedId('seed-prod-latte')` gives a `nanoid(21)`-length
readable id. A 15-character id makes the review screen reject suggestions pointing
at a seeded product (`INVALID_INPUT` on confirm), visible only in a real capture
flow.

**4.36 `seedId()` pads with zeros, so readable seed labels that differ only
by a trailing digit collide.** `seed-session-m1` and `seed-session-m10` both pad
to `seed-session-m1000000`. Use fixed-width suffixes (`m01`, `m10`).

**4.49 SQLite treats NULLs as DISTINCT inside a UNIQUE index, so
`ON CONFLICT` never fires for a nullable key column.** Learned on the retired
`product_aliases` table (`store_chain`): an `onConflictDoUpdate` upsert silently
inserts a duplicate. A unique key with a nullable column must read-before-write
in a transaction (with `isNull()`, not `eq(col, null)`, never true in SQL) or
replace the NULL with a sentinel.

**4.62 Two naming facts that cost a grep each.** The source-icon chip key on
history and product detail is `productDetail.source.*`, not `history.*`. Merging
duplicates lives in `db/repositories/products.ts`, exporting a user's full data
in `services/export.ts`.

### Routing and React

**4.4 Every internal link goes through the wrapped navigation API.**
`src/lib/i18n/navigation.ts` exports `Link`, `useRouter`, `usePathname`,
`redirect`, `getPathname` from next-intl's `createNavigation`. `next/link` or
`next/navigation` on an internal route produces locale-less URLs that 404 or drop
to the default locale. Grep before review: the only allowed `next/link` usages are
external `<a>`-equivalent cases (none expected).

**4.22 A `"use server"` module may only export async functions — Zod schemas
cannot live in `actions.ts`.** An `export const confirmShoppingSessionSchema` in
`scan/review/actions.ts` does not compile. Keep it module-local, or put it in a
sibling such as `scan/review/schema.ts` when tests need it. Type-only exports are
fine. Field schemas shared across boundaries go in `src/lib/domain/schemas.ts`
(§1.8).

**4.34 A `<fieldset>` with `display: grid` reserves a row for its legend
even when the legend is `sr-only`.** Seen on `Segmented`. Keep the fieldset
unstyled (`m-0 border-0 p-0`) and put the grid on an inner `<div>`.

**4.35 Motion's `whileTap` on a non-button element adds `tabindex="0"` on
the client only.** A `motion.span` inside a `<Link>` gave a hydration mismatch on
every page. Use a real `<button>`, or CSS (`group-active:scale-95`) when the
element is not the interactive one.

**4.37 Input file elements hidden with `sr-only` still need an accessible
name.** axe's `label` rule flags a label-less `<input type="file">` even when a
visible button triggers it; give it `aria-label`.

**4.55 A `<table class="sr-only">` is not hidden from layout, and can widen
the whole document.** A `<table>` ignores `width: 1px` with `overflow: hidden`, and
`white-space: nowrap` makes its caption unbreakable, so `/products/[id]` scrolled sideways and every
`fixed inset-x-0` element stretched. Wrap the table in a `<div class="sr-only">`
and leave the table unstyled. Measure it:
`document.documentElement.scrollWidth > clientWidth` on every route.

**4.56 A portal that renders on the client's first pass is a hydration
mismatch, and `typeof document === 'undefined'` does not prevent it.** `Sheet`,
opened at mount (the resume-session prompt on `/scan`), had no server counterpart.
The guard is a mounted flag set in an effect, not a document check.

**4.57 A sticky action bar and the toast outlet are anchored to the same
bottom edge, and the toast wins.** The toast sits at `4.5rem + safe-area`, a
sticky footer at `3.5rem + safe-area` plus its height, and because the toast card
is `pointer-events-auto` it also eats the tap. The bar publishes its measured
height onto `document.documentElement` as `--sticky-action-bar-height` and the
outlet adds it to its offset. Use `StickyActionBar` (or
`STICKY_ACTION_BAR_CLASSES` + `useStickyActionBarHeight()` when the bar must be a
`motion.div`), never a hand-copy of the class string. The hook returns a callback
ref on purpose: the catalog's bulk bar mounts late, and an effect at screen mount
would find no element.

### Testing

**4.14 Pin the Playwright browser locale, or the root-path smoke test is
flaky.** next-intl negotiates from `Accept-Language` when no `theme`/locale cookie
is set, and a host's `en-US` outranks the Italian default at `/`, failing
`tests/e2e/smoke.spec.ts`. `playwright.config.ts` → `projects[].use.locale = 'it-IT'`
on every project; `mobile`, `offline-queue` and `pwa` share one `mobileDevice`
literal. WebKit was deliberately left out: it is not Safari, so
`beforeinstallprompt` absence, the 7-day storage eviction and the real share sheet
stay owner checks on a real device.

**4.20 Next.js dev (Turbopack) can return a truncated response when several
Playwright workers race to be the first request to compile a route.** The symptom
is "Unexpected end of JSON input" server-side. Largely historical since §4.41. The
warm-up in `tests/e2e/global-setup.ts` stays but is no longer load bearing; a new
route need not join it. The hazard remains for anything driving `next dev` from
parallel clients.

**4.24 Playwright must wait for hydration before `setInputFiles` on `/scan`.**
`page.goto()` resolves on server HTML, with the camera panel in its `idle` branch
and no change handler attached, and setting the file silently does nothing. Assert `data-testid="camera-fallback"` is visible
first. The race appears only under parallel load.

**4.25 `getByRole('alert')` is never unique in this app.** Next.js renders
`<div role="alert" id="__next-route-announcer__">`, which breaks strict mode.
Target the specific `data-testid`.

**4.26 `vitest.config.ts` pins the environment variables the unit suite runs
with.** Modules importing `src/lib/env.ts` fail fast on a missing variable, so the
`test.env` block keeps the suite off a developer's `.env.local`. The values are
placeholders on purpose: a real `ANTHROPIC_API_KEY` must never be reachable from a
test run, and every network call is mocked.

**4.32 Playwright's `baseURL` must follow the dev server's port, and Better
Auth must agree.** `next dev` silently moves to :3001, and `reuseExistingServer`
would then test the *other* app. `playwright.config.ts` reads `PORT`
(`PORT=3001 pnpm test:e2e`), starts its own server and passes `BETTER_AUTH_URL`.
Outside Playwright, on a non-default port, set `BETTER_AUTH_URL` to that origin or
sign-out 403s and looks like an auth bug.

**4.33 axe measures contrast on rendered pixels — let the 150 ms route
cross-fade finish first.** `AppShell` fades `<main>` in, and a half-transparent
page fails `color-contrast` on every text node. `tests/e2e/a11y.spec.ts` waits for `main` to reach
opacity 1 before `AxeBuilder` runs. The accent (`--color-accent`, 3.3:1) is for
fills and icons, not words: hence `--color-accent-ink` (§1.12).

**4.41 The whole E2E suite runs against a production build, and a dev server
must not run beside it.** The service worker exists only there, so the single
`webServer` is `pnpm build && pnpm start`. Two Next processes sharing one `.next`
corrupt each other's generated types (`.next/dev/types/root-params.d.ts`), and the
build then fails to type-check. `mobile` and `desktop` set
`serviceWorkers: 'block'`.

**4.52 `test.beforeEach` in a `describe.configure({ mode: 'serial' })` group
wipes the state the next test depends on.** A serial group whose second test reads
what the first wrote needs `beforeAll` for its reset; Playwright re-runs it on a
retry of the group, so the fixture stays idempotent.

**4.58 A message that is true in two places at once breaks a `getByText`
locator.** "1 da completare" appeared on the review card and in the confirm bar,
failing strict mode. Fixed editorially: the count belongs to the bar, the card says
"Da completare". Same class as §4.25: prefer a `data-testid` unless the string is
structurally unique.

**4.60 Spy words must be disjoint across E2E suites that share a seed user.** The
scan review's suggestions fuzzy-match the seed user's whole catalog, so a product
from a parallel spec can capture an assertion ("Fenicottero in scatola E2E" once
did). Invented names keep fixtures away from real data (`WORKFLOW.md` obligation
1) and must keep them away from each other: the delete suite owns "vombato" and
"axolotl". **The same applies inside one file**: "Pesto narvalo 190g" and "Pesto
capibara 190g" still match, so vary the noun too. The symptom is a card stuck on
`needs-product`, which reads like a matcher bug.

**4.67 Every E2E suite that writes as the second seed user leaves the account
as it found it, because the thin dashboard is a state, not a page.** `a11y.spec.ts`
expects `dashboard-thin` for `dev2`, which `getDashboardData` shows only below two
months of series; a fixture from another month flipped it under `fullyParallel`
(seen 2026-10-27). `quick-entry` and `delete-product` clean up in `afterAll`. A new
flow suite owes the same `afterAll`, and a fixture dated outside the current month
is the tell.

**4.74 With `fullyParallel`, a `beforeAll` runs once per worker, so a spec that
recreates its account there deletes it under another worker's login.** The symptom
is `loginViaApi failed: 500` in a test that does nothing wrong. A spec owning a
throwaway account declares `mode: 'serial'` (`dashboard-coverage.spec.ts`,
2026-11-03). Two more traps from that spec: a category section holds the visible
list and a screen-reader table, so scope a text count to the `ol`; and
`not.toContainText('0,0%')` also rejects `+10,0%`.

## 5. Definition of Done

Every task, not just a large feature, is done only when:

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
| `docs/guide/*.md` | Domain narratives: auth, offline and PWA, capture, the index, dependencies (`dipendenze.md`) | When you touch that domain |
| `DEVELOPMENT_GUIDELINES.md` | Layers, naming, errors, testing, security, performance | Once fully; re-check when unsure |
| `COMMENTS.md` | Comment types and discipline | Before writing any code with comments |
| `DESIGN.md` | Tokens, typography, layout vocabulary, animation, anti-patterns — generated by the impeccable documenter from the shipped UI build | **Mandatory before any UI work** |
| `PRODUCT.md` | Product truth for the impeccable skill (users, positioning, constraints, brand commitments) | Before any impeccable command or a new surface |
| `CLAUDE.md` | Current implementation status + working notes | First thing, every session |
| `CONTRIBUTING.md` | External-contributor workflow (PRs, issues) | When touching contribution flow |

Precedence when documents appear to conflict:
`AGENTS.md` → the general guideline docs.
A real conflict is a bug: fix the documents, starting from the top.
