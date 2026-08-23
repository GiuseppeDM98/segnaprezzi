# AGENTS.md — Operating Manual for Coding Agents

This file is the operating manual for AI coding agents (and humans) working in
the **segnaprezzi** repository. It distills the project's conventions and
hard-won lessons into rules you can apply without re-deriving them.

> **Current state**: segnaprezzi has a real DB, real auth, real repositories,
> two real Anthropic gateways (shelf tags and receipts), the pure
> personal-CPI engine with its service and the committed ISTAT series, every
> screen of the app in the "tabulato a modulo continuo" visual world recorded
> in **`DESIGN.md`** (mandatory reading before any UI work), a real service
> worker with the sync engine that drains the photo queue, and the receipt
> pipeline with its learned `product_aliases`. The current implementation
> state is tracked in **`CLAUDE.md` → "Current status"** — read it first,
> trust it over any assumption. Where this file's guidance and the
> actually-implemented code differ, this file describes what was actually
> verified to work — a handful of snippets below didn't survive contact with
> the real dependency versions, the Next.js runtime, the live ISTAT service,
> the accessibility gates, Turbopack, Serwist's precache manifest, SQLite's
> NULL semantics and Better Auth's production rate limiter (see §4.15–§4.53).

**Reading order for any session**:
`CLAUDE.md` (state) → `WORKFLOW.md` (session/collaboration rules — branch,
commit, and guided-collaudo discipline) → this file (conventions) →
`docs/DEVELOPMENT_GUIDELINES.md` and `docs/COMMENTS.md` (general discipline)
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
  `src/lib/domain/money.ts` — pure, integer in/out, string-free.
- **All** string rendering of money (and every other `Intl.NumberFormat` /
  `Intl.DateTimeFormat` display helper) lives exclusively in
  `src/lib/format.ts`, which divides at the last moment
  (`cents / 100`, `milli / 1000`) — components never divide by 100
  themselves. Input parsing (`parseDecimalInput`, comma or dot, `null` when
  not a number) lives there too; `money.ts` stays string-free.
- The **only** place floats are legitimate: index math in `src/lib/inflation/`
  (price relatives and means are ratios, not money) and `package_size`
  (a physical quantity, stored as `real`). Inside the engine, sums of
  integer money are still exact (integer addition never rounds in a double),
  which is what lets the monthly means and expenditure totals be bit-identical
  for any input order; only the logs and weighted sums are genuine floats, and
  those iterate in sorted order for the same reason.
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
counter-example: petrol, diesel and LPG are dispensed per litre, but Italian
CNG (metano) is dispensed and priced **per kilogram**. Each entry in
`FUEL_QUICK_PICKS` therefore carries its own `unitKind`, and
`createFuelEntry` reads it from the pick rather than hardcoding `'volume'`.
Storing kilograms in a column that declares litres is an error in the data,
which no later screen can repair.

### 1.4 Time and month bucketing (Europe/Rome)

- Storage is epoch **ms UTC**, everywhere, no exceptions (see §1.1).
- The inflation engine buckets entries into **calendar months in the
  Europe/Rome timezone** — a purchase at 00:30 on May 1st Rome time belongs to
  May even though it is still April in UTC.
- Month keys are `"YYYY-MM"` strings, derived with `Intl.DateTimeFormat` (no
  date library dependency):

```ts
// src/lib/inflation/bucketing.ts

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
| `src/app/**` (pages, actions, route handlers) | services, domain, inflation, `lib/i18n`, `lib/auth` helpers, `lib/errors`, components, **the `db` singleton from `lib/db/client`** (to pass into a service — see below) | repositories directly, `lib/ai`, `lib/blob`, `lib/db/schema` |
| `src/lib/services/**` | repositories, gateways (`ai`, `blob`), domain, inflation, `lib/errors` | `next/*`, `react`, `src/app`, `src/components` |
| `src/lib/db/repositories/**` | `lib/db` client + schema, domain (types/enums), `lib/errors` | services, gateways, `next/*`, `react` |
| `src/lib/ai/**`, `src/lib/blob/**` (gateways) | domain, `lib/errors`, `lib/env` | `lib/db`, services, `next/*`, `react` |
| `src/lib/inflation/**` | `src/lib/domain` only | everything else (db, ai, blob, services, next, react) |
| `src/lib/domain/**` | nothing (TS/JS stdlib only) | every other project module |
| `src/lib/offline/**` (client) | domain, `dexie`, `dexie-react-hooks` | `lib/db`, services, gateways, server-only modules, `next/*` (the sync engine also runs inside `src/app/sw.ts`) |
| `src/components/**` | domain, `lib/i18n` navigation, `motion`, other components | `lib/db`, repositories, services, gateways, `lib/env` |
| `src/lib/auth/**` | `lib/db` (adapter needs it), `lib/env` | services, components |

The `db`-singleton carve-out (established by the `/api/export` route,
followed by every capture page and action and by
`getPersonalCpi(db, userId)`): services take the Drizzle handle as
their first parameter, exactly like repositories, so that the confirm flow can
pass a transaction and the tests can pass a throwaway database. Something has
to hand them the real one, and the app layer is the only caller. It passes the
handle straight through — reading or writing through it in a page or an action
is still forbidden.

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

Expected errors are `DomainError` subclasses in `src/lib/errors.ts`.
The `code` is a stable `DomainErrorCode` —
a SCREAMING_SNAKE string union — that doubles as the i18n key under the
`errors` namespace (`errors.NOT_FOUND`). Classes carry **no** HTTP status;
route handlers own the code→status mapping:

```ts
// src/lib/errors.ts

// WARNING: adding a code here requires updating:
// - the `errors` namespace in messages/it.json and messages/en.json
// - the code→HTTP-status mapping in route handlers
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'EXTRACTION_FAILED'
  | 'INTERNAL';
// The union was later extended with INVALID_INPUT, INVALID_DATE,
// INVALID_PRICE, INVALID_SIZE, INVALID_STORE_KIND,
// INCONSISTENT_FUEL_PRICES, SESSION_NOT_FOUND, STORE_NOT_FOUND,
// PRODUCT_NOT_FOUND, SESSION_CLOSED, PHOTO_TOO_LARGE,
// UNSUPPORTED_PHOTO_TYPE and EXTRACTION_UNAVAILABLE for capture, and
// RECEIPT_TOO_LARGE, UNSUPPORTED_RECEIPT_TYPE, RECEIPT_TOO_LONG,
// RECEIPT_ALREADY_IMPORTED, RECEIPT_NOT_FOUND and RECEIPT_NO_LINES for
// receipt import — both via the checklist above.
// The code→HTTP mapping is duplicated in BOTH route handlers
// (src/app/api/extract/route.ts and src/app/api/extract-receipt/route.ts) as
// an exhaustive Record<DomainErrorCode, number> — which is what makes the
// compiler, not a reviewer, catch a code added without a status.

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
`ExtractionError`) and the `toActionError()` mapper live alongside them in
`src/lib/errors.ts`. The HTTP mapping is `NOT_FOUND` → 404,
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
- The Claude extraction response — the model's output is untrusted
  input; parse it against the extraction schema before showing it to the user.
- Environment variables — `src/lib/env.ts` validates every required variable
  with Zod at boot and **fails fast** with a readable message.
- IndexedDB queue items on sync replay (data may come from an old app
  version).

Schemas live next to the boundary that uses them; shared field shapes (money,
nanoid ids, month keys) are composed from small reusable schemas. Inside the
service/domain layers, inputs are already typed — do not re-validate.

```ts
// Reusable field schemas — src/lib/domain/schemas.ts
export const nanoidSchema = z.string().length(21);
export const priceCentsSchema = z.number().int().positive();
export const unitPriceMilliSchema = z.number().int().positive();
export const epochMsSchema = z.number().int().positive();
```

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
The complete list:

| Handler | Why it cannot be an action |
|---|---|
| `/api/auth/[...all]` | Better Auth owns this surface |
| `/api/extract` | Called by the offline sync manager / service worker with a binary photo body |
| `/api/extract-receipt` | Multipart upload of a PDF/image the user picked from disk |
| `/api/export` | Streams a downloadable JSON file |

Adding a fifth route handler requires a justification of this kind in the PR
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
| `receipt` | Receipt upload, line review, per-line statuses |

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

### 1.13 Comments discipline (digest of docs/COMMENTS.md)

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

The repo layout, with what belongs in each directory — and what must
never appear there:

```
segnaprezzi/
├── docs/
│   ├── assets/                 # Logo, favicon source SVG (build inputs, not served).
│   ├── COMMENTS.md
│   └── DEVELOPMENT_GUIDELINES.md
├── data/
│   └── istat-nic.json          # Committed ISTAT NIC monthly series. Only scripts/update-istat.ts writes it.
├── drizzle/                    # Generated SQL migrations + meta. Never hand-edited; always committed.
├── scripts/                    # tsx entry points: seed.ts, update-istat.ts, generate-icons.ts,
│                               #   plus their pure helpers (seed-ids.ts, seed-users.ts, istat-nic.ts).
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
│   │   ├── ui/                 # Primitives (button, sheet, field, input, chip, toast, tab-bar, fab…).
│   │   ├── pwa/               # sw-provider, sw-registration, sw-update-toast, install-sheet,
│   │   │                       #   ios-install-sheet, install-row. Client-only.
│   │   ├── charts/             # Hand-rolled SVG: area-chart, category-bars, sparkline, trend-badge,
│   │   │                       #   number-ticker + scale.ts (pure, tested).
│   │   ├── capture/            # camera-view, photo-tray, extraction-card, match-picker, store-picker-sheet.
│   │   ├── receipt/            # receipt-dropzone, receipt-line-card, receipt-summary-bar.
│   │   ├── entries/            # entry-sheet (view/edit/delete one observation; detail + timeline).
│   │   ├── auth/               # auth-form (progressive-reveal login/signup form).
│   │   └── layout/             # app-shell, nav-rail, screen-header, offline-banner.
│   │                           #   components/ NEVER imports db/, services/, ai/, blob/, env,
│   │                           #   nor Server Actions — screens pass actions down as callbacks.
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
│   │   ├── ai/                 # Anthropic gateways: tag + receipt calls, prompts, response schemas.
│   │   │                       #   One AiGatewayError mapping, shared by both.
│   │   ├── blob/               # Vercel Blob gateway: upload/delete photo.
│   │   ├── offline/            # CLIENT-side: Dexie schema, photo queue, sync manager.
│   │   │                       #   Never imported by server code.
│   │   ├── auth/               # auth.ts (Better Auth config), client.ts, session.ts (requireUser).
│   │   ├── i18n/               # routing.ts, navigation.ts (wrapped Link/router), request config.
│   │   ├── env.ts              # Zod-validated env access. The ONLY file reading process.env.
│   │   ├── format.ts           # ALL Intl display formatting (money, dates, units) + input parsing.
│   │   ├── motion.ts           # houseSpring, quickFade, useAppMotion() — the only motion constants.
│   │   ├── cx.ts               # Class-name joiner (no clsx dependency).
│   │   ├── use-media-query.ts  # tablet:/rail: queries for components that branch on width.
│   │   ├── use-container-width.ts # ResizeObserver width for the SVG charts.
│   │   └── errors.ts           # DomainError + DomainErrorCode + ActionResult (§1.7).
│   └── middleware.ts           # next-intl locale routing + auth guard.
├── tests/
│   └── e2e/                    # Playwright specs (*.spec.ts). Critical paths only.
├── AGENTS.md · CLAUDE.md · DESIGN.md · PRODUCT.md · README.md · CONTRIBUTING.md
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
- The inflation engine carries an exhaustive numeric test plan — those tests
  are the correctness contract of the whole app; never weaken one to make an
  implementation pass.

### 2.3 Fan-out checklists (update these together)

Some changes are multi-file by design. The source file carries a checklist
comment; this section is the registry.

**Adding/renaming a category** (`src/lib/domain/categories.ts`):

```ts
// WARNING: when you add a category here, also update:
// - messages/it.json and messages/en.json ("categories" namespace)
// - the AI extraction prompt in src/lib/ai/ — the model must know the new id
// - AGENTS.md §1.11 namespace notes if semantics change
// The DB stores the raw id string: renaming an id requires a data migration.
export const categories = [ /* ... the category taxonomy ... */ ] as const;
```

**Adding a `DomainErrorCode`** (`src/lib/errors.ts`): extend the union, add
the matching `errors.<CODE>` message to **both** `messages/it.json` and
`messages/en.json`, and update the code→HTTP-status mapping in route handlers.

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

**Regenerating `src/lib/db/schema/auth.ts`** (`pnpm auth:generate`): re-add
the hand-patched `issuer` column on `accounts` (§4.16) — the CLI output
doesn't include it, and signup breaks at runtime without it.

---

## 3. Common Commands

### 3.1 Canonical package.json scripts

This exact list is the project contract; do not invent different names for
these scripts.

| Script | Command | When to use |
|---|---|---|
| `dev` | `next dev` | Daily development. Serwist is disabled here (§4.3). |
| `build` | `next build --webpack` | Production build; also the only way to build the service worker. **The `--webpack` flag is load-bearing** — see §4.39. |
| `start` | `next start` | Serve the production build locally (PWA testing). |
| `lint` | `biome check .` | CI + pre-commit check. Formatting AND lint in one pass. |
| `lint:fix` | `biome check --write .` | Auto-fix before committing. Run it, don't hand-format. |
| `typecheck` | `tsc --noEmit` | Always run before declaring a task done; `next build` alone is not the type gate. |
| `test` | `vitest run` | Full unit/integration suite, single pass (CI mode). |
| `test:watch` | `vitest` | TDD loop while implementing (essential for the inflation engine). |
| `test:e2e` | `playwright test` | Critical-path E2E + axe. Four projects (`mobile`, `desktop`, `offline-queue`, `pwa`); runs `pnpm build && pnpm start` itself (§4.41). `PORT=3100 pnpm test:e2e` when :3000 is taken (§4.32). |
| `db:generate` | `drizzle-kit generate` | After every schema change: emits SQL migration into `drizzle/`. |
| `db:migrate` | `drizzle-kit migrate` | Apply pending migrations to the DB in `TURSO_DATABASE_URL`. |
| `db:studio` | `drizzle-kit studio` | Browse/edit data in a local GUI while debugging. |
| `db:seed` | `tsx --env-file-if-exists=.env.local scripts/seed.ts` | Populate the local DB with demo data (products, entries across months). Not `--env-file` — see §4.21. |
| `auth:generate` | `pnpm dlx @better-auth/cli@1.4.22 generate --yes --config src/lib/auth/auth.ts --output src/lib/db/schema/auth.ts` | Regenerate `src/lib/db/schema/auth.ts` after a Better Auth config change; always follow with `pnpm db:generate` (§3.5, §4.2, §4.16). |
| `icons` | `tsx scripts/generate-icons.ts` | Regenerate PWA icon set from `docs/assets/logo.svg` into `public/`. |
| `receipt:fixture` | `tsx scripts/make-receipt-fixture.ts` | Regenerate the synthetic receipt PDF the E2E suite uploads. Changing it changes its SHA-256, which the idempotency test derives at runtime — no constant to update. |
| `istat:update` | `tsx scripts/update-istat.ts` | Refresh `data/istat-nic.json` from ISTAT; commit the diff. |
| `photos:prune` | `tsx --env-file-if-exists=.env.local scripts/prune-photos.ts` | Report (or `--delete`) entry photos in Blob that no entry references. Dry run by default; run it with the target deployment's env — see §4.61. |

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

## 4. Gotchas and Non-Obvious Setup

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

**4.3 Serwist is disabled in dev — and needs `--webpack` in prod (§4.39).**
The Serwist plugin sets `disable: process.env.NODE_ENV === "development"`.
`pnpm dev` serves no service worker — offline behavior, caching, and the install prompt can only be
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
extraction prompt, and the checklist registry in §2.3 of this file.
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
Fix: `playwright.config.ts` → `projects[].use.locale = 'it-IT'`. Every
project needs it; the three phone-shaped ones (`mobile`, `offline-queue`,
`pwa`) share one `mobileDevice` literal that pins it once. A WebKit project
for iOS PWA checks was considered and deliberately left out — Playwright's
WebKit is not Safari, so it cannot answer the questions that matter there
(`beforeinstallprompt` absence, the 7-day storage eviction, the real share
sheet); those stay owner checks on a real device.

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

**4.19 Better Auth enforces an Origin check that raw HTTP clients don't
satisfy by default.** From Playwright's `page.request`, sign-in and sign-up
work without extra headers (open, unauthenticated entry points) but
`POST /api/auth/sign-out` 403s with `MISSING_OR_NULL_ORIGIN` unless the
request carries an `Origin` header matching a trusted origin. **Refinement
(2026-08-21, found during a capture-flow collaudo):** that carve-out is specific
to `page.request`, which inherits the browser context's origin. A bare Node
`fetch()` sends no `Origin` at all, so it is rejected on **every** Better Auth
route including sign-in — any script that authenticates outside a browser must
set `Origin` explicitly — `page.request.post()` is a raw API call,
not a real in-page `fetch()`, so it never sends one on its own (verified via
curl too). Pass `headers: { Origin: new URL(page.url()).origin }` explicitly
on any E2E call to a Better Auth route that acts on an authenticated
session, not just anonymous sign-in/sign-up.

**4.20 Next.js dev (Turbopack) can return a truncated response when several
Playwright workers race to be the first request to compile a route.**
Reproduced twice on different routes ("Unexpected end of JSON input"
server-side). Largely historical now that the E2E suite runs against a
production build where nothing compiles on demand (§4.41). The serial
warm-up pass in `tests/e2e/global-setup.ts` was kept — it still warms the
server's module graph and the DB connection — but it is no longer load
bearing, and a new route does not have to be added to it. The hazard itself
remains for anything else that drives `next dev` from parallel clients.

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

**4.22 A `"use server"` module may only export async functions — Zod schemas
cannot live in `actions.ts`.** Next.js rejects an exported `const` from a
`"use server"` file at build time, so an `export const
confirmShoppingSessionSchema` in `scan/review/actions.ts` does
not compile. Either keep the schema as a module-local (non-exported) constant,
or — when the tests or another module need it, as the confirm schema's own
unit tests do — put it in a sibling plain module (
`scan/review/schema.ts`) that the action imports. Type-only exports are fine
either way: they are erased before the check runs. Field schemas shared across
several boundaries belong in `src/lib/domain/schemas.ts` (§1.8).

**4.23 Seed ids are padded to 21 characters — never add a short readable id.**
`scripts/seed-ids.ts` → `seedId('seed-prod-latte')` produces a contract-shaped
`nanoid(21)`-length id while staying readable and reproducible. Every id is a
nanoid(21) and the confirm boundary validates that
length, so a 15-character seed id makes the review screen reject any suggestion
pointing at a seeded product (`INVALID_INPUT` on confirm) — a failure that only
shows up in a real capture flow against a seeded database, never in the seed
script itself.

**4.24 Playwright must wait for hydration before `setInputFiles` on `/scan`.**
`page.goto()` resolves on the server HTML, where the camera panel is still in
its `idle` branch and no React change handler is attached yet; setting the file
then silently does nothing. Assert the fallback panel
(`data-testid="camera-fallback"`, rendered only after the client camera hook
has run and failed to find a camera) is visible first. The race only appears
under parallel load — it passed for two runs before the quick-entry spec
started competing for the same dev server.

**4.25 `getByRole('alert')` is never unique in this app.** Next.js renders its
own route announcer as `<div role="alert" id="__next-route-announcer__">`, so
any `getByRole('alert')` locator hits at least two elements and fails Playwright's
strict mode. Target the specific `data-testid` instead.

**4.26 `vitest.config.ts` pins the environment variables the unit suite runs
with.** Some modules under test import `src/lib/env.ts`, which
fails fast on a missing variable — so the suite would depend on a developer's
`.env.local` (and break in CI, which has none) without the `test.env` block.
The values there are placeholders on purpose: a real `ANTHROPIC_API_KEY` must
never be reachable from a test run. Every network call in the suite is mocked.

**4.27 ISTAT's SDMX service needs three things that were not obvious going
in.** (1) The NIC was rebased to 2025=100 in January 2026: dataflow
`IT1,167_744,1.0` (base 2015) is frozen at 2025-12, and `IT1,167_745,1.0`
("Nic - monthly data from 2026 onwards (base 2025)") is the live one — it also
serves the 1995/2010/2015 bases under distinct `DATA_TYPE` codes, so key
`M.IT..4.00` returns the whole history back to 1996 and
`scripts/update-istat.ts` chain-links the bases onto 2025=100 (reference-year
averages, ISTAT's own "coefficiente di raccordo" method; the pure half lives in
`scripts/istat-nic.ts`, tested offline). (2) `?format=jsondata` (SDMX-JSON 2.0)
returns every observation as `null` on this NSI version; negotiate SDMX-JSON
1.0 with `Accept: application/json`. (3) Node's `fetch` sends
`accept-language: *` by default and the service answers HTTP 500
`languageTag1` — send `Accept-Language: en`. Also: the host is slow and
flaky; the full dataflow catalogue (`/dataflow/IT1?detail=allstubs`) is ~2 MB
and can take over a minute, and `/data/<flow>/all` times out — always query a
narrow key. The dashboard loads `data/istat-nic.json` as a static import and
calls `rebaseIstat(months, series[0].ym)`; it never fetches ISTAT at runtime.

**4.29 Test the engine's dead branches by removing them, not by faking
inputs.** The target is ≈100% line coverage of `src/lib/inflation/`; the
last few uncovered lines were defensive guards that TypeScript narrowing
needed but no input could reach (a product in the price table with no
category, a category series with no first priced month, a mover tie-breaker
between two identical ids). Each was removed by restructuring — derive the
category's first month from the entries, rely on `Array.prototype.sort` being
stable over candidates already iterated in sorted id order — rather than by
writing a test that manufactures an impossible state. Coverage was measured
with `@vitest/coverage-v8` installed transiently (`pnpm add -D`, measure,
`git checkout package.json pnpm-lock.yaml && pnpm install --frozen-lockfile`);
it is deliberately not a project dependency.

**4.31 Python one-liners on Windows write CRLF unless told otherwise.**
`open(path, 'w')` in text mode converts `\n` to `\r\n`, and Biome's formatter
then fails every touched file ("Formatter would have printed…") while the diff
looks unchanged. Either open with `newline=''`, write bytes, or run a
CRLF→LF normalization over `git status` files before `pnpm lint` — the UI
build session lost two lint rounds to this before the pattern was clear.

**4.32 Playwright's `baseURL` must follow the dev server's port, and Better
Auth must agree.** `next dev` silently moves to :3001 when :3000 is taken by
another project, while `playwright.config.ts` kept pointing at :3000 —
`reuseExistingServer` then runs the suite against the *other* app. The config
now reads `PORT` (`PORT=3001 pnpm test:e2e`) and starts its
own server and passes `BETTER_AUTH_URL` to it, so the origin can no longer
drift from the port. Outside Playwright the rule still stands: on a
non-default port start the server with `BETTER_AUTH_URL` set to that origin,
or sign-out (which enforces trusted origins) 403s and the failure looks like
an auth bug that isn't one.

**4.33 axe measures contrast on rendered pixels — let the 150 ms route
cross-fade finish first.** The a11y suite reported `color-contrast` failures
on pages that pass when inspected by hand: `AppShell` fades `<main>` in over
150 ms, and a half-transparent page fails every text node against its blend.
`tests/e2e/a11y.spec.ts` waits for `main` to reach opacity 1 before
`AxeBuilder` runs. Also: the highlighter accent (`--color-accent`, 3.3:1 on
paper) is fine for fills and icons (≥ 3:1) but not for words — hence
`--color-accent-ink` (§1.12).

**4.34 A `<fieldset>` with `display: grid` reserves a row for its legend
even when the legend is `sr-only`.** The `Segmented` control rendered its
radios in the top half of the box. Keep the fieldset unstyled
(`m-0 border-0 p-0`) and put the grid on an inner `<div>`.

**4.35 Motion's `whileTap` on a non-button element adds `tabindex="0"` on
the client only.** A `motion.span` with `whileTap` inside a `<Link>` produced
a hydration mismatch on every page (the FAB). Use a real `<button>`, or move
the press feedback to CSS (`group-active:scale-95`) when the element is not
the interactive one.

**4.36 `seedId()` pads with zeros, so readable seed labels that differ only
by a trailing digit collide.** `seed-session-m1` and `seed-session-m10` both
pad to `seed-session-m1000000`. Use fixed-width suffixes (`m01`, `m10`).

**4.37 Input file elements hidden with `sr-only` still need an accessible
name.** axe's `label` rule flags a label-less `<input type="file">` even when
a visible button triggers it; give it `aria-label`.

**4.38 The impeccable decision page needs an unsandboxed shell.**
`serve-question.mjs --start` binds a local port and daemonizes; under the
sandboxed Bash tool it cannot, so run it (and the `--wait`) with the sandbox
disabled, then open the printed URL with `Start-Process` from PowerShell.

**4.30 The Bash tool on this Windows machine truncates long commands (~8 KB).**
A heredoc that writes a whole TypeScript module, or a Python edit script with
several large `old`/`new` blocks, fails with `unexpected EOF while looking for
matching `''` — the command was cut, not mis-quoted. Write new source files
with the Write tool, make edits with short Python one-liners, and split
multi-file documentation edits into several calls. Cost the inflation-engine
session two false starts before the pattern was clear.

**4.39 `next build` emits no service worker under Turbopack, and does not
fail.** Next.js 16 builds with Turbopack by default; `@serwist/next` is a
webpack plugin, so it never runs, `public/sw.js` is never written, and the
build reports success — the only sign is one warning on stderr among Next's
own output. `package.json`'s `build` script is therefore
`next build --webpack`. `pnpm dev` is unaffected: Serwist disables itself in
development, and the warning only fires when it is enabled. When Next drops
webpack support, migrate to `@serwist/turbopack` or Serwist's configurator
mode (`@serwist/next/config` + `@serwist/cli`), not back to a silent no-op.

**4.40 `@serwist/next`'s precache manifest contains no HTML of ours.** It
globs the build output, which for the App Router is `/_next/static/**` — every
page is server-rendered. The `fallbacks.entries` config therefore pointed at
`/offline` and `/en/offline` URLs that were never precached, and an offline
navigation failed with `ERR_FAILED` instead of rendering the fallback (the
`PrecacheFallbackPlugin` is attached correctly; `matchPrecache` simply found
nothing). Fix: `additionalPrecacheEntries` in `next.config.ts`, one entry per
locale, with a `randomUUID()` revision minted per build so an updated worker
re-fetches them. Adding a locale means adding an entry there *and* in
`src/app/sw.ts`'s `fallbacks` list.

**4.41 The whole E2E suite runs against a production build, and a dev server
must not run beside it.** The service worker exists only in a production
build, so `playwright.config.ts`'s single `webServer` is
`pnpm build && pnpm start`. Two Next processes sharing one `.next` directory
corrupt each other's generated types — a dev server running during a build
produced a `.next/dev/types/root-params.d.ts` with a stray brace and the build
then failed to type-check. The pre-existing `mobile` and `desktop` projects
set `serviceWorkers: 'block'` so a real worker never changes what they
measure.

**4.42 Better Auth's rate limiter is on whenever `NODE_ENV === 'production'`,
and `/sign-in*` + `/sign-up*` allow 3 requests per 10 s per IP.** Every
Playwright worker is the same IP, so moving the suite onto a production server
made `global-setup`'s two logins plus a signup, and then the signup tests,
trip it. Do **not** disable the limiter for tests — it is the app's only
brute-force defence. `tests/e2e/helpers/auth.ts` waits out a 429 using its
`Retry-After` header (the limiter does not extend the window on a rejected
request, so one wait is enough).

**4.43 In Vitest, fake `Date` only — never the timers — around Dexie.**
fake-indexeddb drives itself on real macrotasks, so `vi.useFakeTimers()` with
its default `toFake` list deadlocks Dexie mid-transaction.
`vi.useFakeTimers({ toFake: ['Date'] })` freezes the clock instead, which is
what makes `nextAttemptAt` assertions exact; advance it with
`vi.setSystemTime()` and drain again rather than waiting on the engine's own
timer. Corollary: do not use `vi.waitFor()` in such a test — with fake timers
installed it advances them, and the frozen clock drifts by its 50 ms polling
interval (this cost one confusing "expected …408000, got …408050").

**4.44 happy-dom's `FormData` rejects a Blob that has been through
IndexedDB.** happy-dom installs its own `Blob`/`FormData` classes, but a Blob
stored in fake-indexeddb comes back as Node's (structuredClone knows nothing
about happy-dom), and `FormData.append` then throws "parameter 2 is not of
type Blob". `src/lib/offline/sync.test.ts` runs in the `node` environment with
three hand-made globals — an EventTarget `window`, an EventTarget `document`
with a `visibilityState`, and a `navigator` whose `onLine` the test controls.

**4.45 `serwist` already declares the Background Sync `SyncEvent`.** Adding a
local `interface BackgroundSyncEvent` to `ServiceWorkerGlobalScopeEventMap`
is a TS2717 "subsequent property declarations must have the same type" error.
Write `self.addEventListener('sync', (event) => …)` and read `event.tag`.

**4.46 A Serwist fallback matcher receives the failed request, not a parsed
URL.** Its parameter is `HandlerDidErrorCallbackParam` (`request`, `error`,
`event`) — no `url`, unlike a `runtimeCaching` matcher. Parse it yourself:
`const { pathname } = new URL(request.url)`.

**4.47 Lighthouse 12 has removed the PWA category and the
`installable-manifest` audit.** `--only-audits=installable-manifest` returns
an empty `audits` object rather than an error. Installability is asserted in
`tests/e2e/pwa.spec.ts` instead (manifest contract, every icon served,
`/sw.js` served, an offline navigation answered by the fallback).

**4.48 `src/app/favicon.ico` and `public/favicon.ico` cannot coexist.** Both
claim `/favicon.ico` and Next fails the build with a conflicting-public-file
error. The icon pipeline writes the `public/` one, so the App Router
convention file was deleted; `generateMetadata` declares `/favicon.ico`
explicitly.

**4.49 SQLite treats NULLs as DISTINCT inside a UNIQUE index, so
`ON CONFLICT` never fires for a nullable key column.** `product_aliases` is
unique on `(user_id, alias, store_chain)` and `store_chain` is NULL for an
alias learned from a receipt with no known chain — two such rows do NOT
collide, and an `onConflictDoUpdate` upsert silently inserts a duplicate
instead of incrementing `hit_count`.
`src/lib/db/repositories/product-aliases.ts` therefore reads the row before
it writes (with `isNull()`, not `eq(col, null)`, which is never true in SQL).
Both callers run inside a transaction, so the read-then-write is atomic. The
corollary is that `moveProductAliases`'s "sum hit_count on conflict" branch
is only reachable for chain-less aliases brought in by a restored backup —
its test seeds that state directly, because the repository's own upsert
cannot produce it.

**4.50 A `biome-ignore` suppression must be ONE comment node.** Four
consecutive `//` lines are four comments, and Biome only reads the first as
the suppression — it then reports both `suppressions/unused` on the comment
*and* the original rule on the node below. Use a `/* … */` block for any
justification that needs more than one line (`{/* … */}` inside JSX
children), and keep it directly above the node.

**4.51 Don't reach for `client.withOptions()` when a gateway needs different
SDK options — give it its own `Anthropic` instance.** `src/lib/ai/`'s test
seam is an injected client shaped `{ messages: { parse } }`;
a `withOptions({ timeout })` call inside the gateway means every mock must
also implement `withOptions`, which is a lot of ceremony to express "receipts
get 45 s instead of 30". `extract-receipt.ts` constructs its own client and
re-uses `extract-price-tag.ts`'s exported `toAiGatewayError` for the failure
mapping, so the classification still lives in exactly one place.

**4.52 `test.beforeEach` in a `describe.configure({ mode: 'serial' })` group
wipes the state the next test depends on.** The receipt E2E suite's second
test asserts that re-uploading an already-confirmed receipt is refused — which
only means anything if the first test's confirm is still there. Use
`beforeAll` for the reset in a serial group: Playwright re-runs it on a retry
of the group, so the idempotency of the fixture is preserved either way.

**4.53 An all-ASCII binary fixture needs a `.gitattributes` entry, or
`core.autocrlf` silently corrupts it.** The E2E receipt fixture is a
hand-written PDF (`scripts/make-receipt-fixture.ts`) with no compressed
streams, so git's content heuristic classifies it as *text* and rewrites its
line endings on checkout under Windows' `core.autocrlf=true`. Every byte
offset in the PDF's xref table then points one byte early per preceding line,
and the file stops being a document any reader can open — while still
*passing* the idempotency test, which derives the SHA-256 at runtime from
whatever is on disk. `.gitattributes` declares `*.pdf` (and the image
formats) `binary`; verify with
`git cat-file -p :<path> | sha256sum` against the file on disk. This is the
failure mode that looks like "the model can't read our fixture" three weeks
later, on somebody else's clone.

**4.54 A synthetic receipt fixture cannot exercise every real layout — a
discount line that repeats the receipt's own VAT% column needs its own
worked example, or the model treats it as a product.** The fixture and the
first worked example in `RECEIPT_SYSTEM_PROMPT` only cover a discount printed
as a single bare amount (`SCONTO SOCI   -0,40`). A real Coop receipt instead
prints `SCONTO % CLIE 40.00%    4,00%    -1,92` — the VAT% column repeats on
the discount line itself, plus the discount's own percentage sits in the
description text. The model read that as a new, separate, zero-price
"product" instead of folding it into the line above, exactly the kind of
line the resolver then offers to add to the catalog as junk. Fixed with a
second worked example in the prompt matching that shape — pure prompt text,
no schema or resolver change, and **not** something a unit test can catch:
prompt changes can only be verified against a real document. The same
receipt also had the model expand "F/F" (Coop's "Fior Fiore" private-label
marker) into "farina di frumento" — the existing "don't guess ambiguous
abbreviations" rule was true in principle but too weak in practice to
override a plausible-looking wrong guess; it now carries "F/F" as a named
counter-example. Lesson: when a real-world document surfaces a prompt gap,
add a worked example matching its *exact* shape, not a generic rule
addition — the model follows concrete examples far more reliably than an
abstract instruction it can still rationalize past.

**4.55 A `<table class="sr-only">` is not hidden from layout, and can widen
the whole document.** `sr-only` sets `width: 1px` with `overflow: hidden`, but
a `<table>` is sized by its own content and simply ignores that width — and
`sr-only` also sets `white-space: nowrap`, so the accessible caption becomes
one unbreakable line. The chart data tables therefore stretched
`/products/[id]` to 507 px inside a 390 px viewport: the page scrolled
sideways, and every `fixed inset-x-0` element (tab bar, toast outlet) stretched
with it. Fix: wrap the table in a `<div class="sr-only">` and leave the table
itself unstyled — a div is a block box that honours the width and clips. The
dashboard did not show it only because its caption is shorter, which means the
bug was present and merely under threshold. Measure this, don't eyeball it:
`document.documentElement.scrollWidth > clientWidth` on every route finds it
in one pass.

**4.56 A portal that renders on the client's first pass is a hydration
mismatch, and `typeof document === 'undefined'` does not prevent it.** The
server renders nothing, but the client's hydration render already has a
document — so `Sheet`, opened at mount (the resume-session prompt on `/scan`),
produced a whole portal with no server counterpart and logged a mismatch on
every visit. The guard has to be a mounted flag set in an effect, not a
document check; the sheet then opens one tick later, which is invisible next to
its own spring.

**4.57 A sticky action bar and the toast outlet are anchored to the same
bottom edge, and the toast wins.** The toast sits at `4.5rem + safe-area` and a
sticky footer at `3.5rem + safe-area` plus its own height, so the toast landed
on the confirm button — and because the toast card is `pointer-events-auto`, it
also ate the tap. CSS custom properties only inherit downwards and the toast is
a sibling of the whole app, so the bar publishes its measured height onto
`document.documentElement` as `--sticky-action-bar-height` and the outlet adds
it to its own offset. Use `StickyActionBar` (or `STICKY_ACTION_BAR_CLASSES` +
`useStickyActionBarHeight()` when the bar must be a `motion.div`) — never a
sixth hand-copy of the class string.

**4.58 A message that is true in two places at once breaks a `getByText`
locator.** Naming the blocking reason on the review card meant "1 da
completare" appeared both in the card's banner and in the confirm bar, and the
existing E2E assertion failed Playwright's strict mode. The fix was editorial
rather than technical — the count belongs to the bar, the card only states its
own status ("Da completare") — but the class of failure is the same one as
§4.25: prefer a `data-testid` over user-visible text whenever the string is not
structurally unique.

**4.59 Blobs do not participate in the database's cascades, and nothing will
remind you.** `price_entries` cascades from `users`, so deleting an account
emptied every table — while the shelf photos sat in Vercel Blob forever, which
is a privacy failure rather than a storage bill. Deleting a single observation
had the same hole. Any new path that destroys entries owes the store an
explicit cleanup: `deleteOwnedPhotos(userId, urls)` for a known set (it filters
to the user's own prefix and swallows its failures) or `deleteAllUserPhotos`
for a whole account, wired to Better Auth's `deleteUser.afterDelete(user,
request)` hook. Order matters: drop the row first and the blob after, because
an orphan blob is recoverable and a row whose photo is gone is not.
`pnpm photos:prune` reports what has already leaked.

**4.60 Spy words must be disjoint across E2E suites that share a seed user.**
The receipt suite fuzzy-matches its lines against the *whole* catalog of the
second seed user, so a product named "Fenicottero in scatola E2E", created by
another spec running in parallel, captured a receipt line that was supposed to
find nothing — and that suite's assertion failed in a file nobody had touched.
Invented names keep fixtures away from real data (`WORKFLOW.md` obligation 1);
they also have to keep fixtures away from *each other*. The delete suite
therefore owns "vombato" and "axolotl", disjoint from the receipt suite's
"fenicottero"/"ornitorinco"/"quokka". **The same applies inside one file**:
a later receipt test's "Pesto narvalo 190g" was captured by an earlier test's
"Pesto capibara 190g" — disjoint spy words are not enough when the rest of
the name matches, so vary the noun too ("Crema narvalo 250g"). The symptom is
a card stuck on `needs-product`, which reads like a bug in the matcher.

**4.61 A prune tool that compares one database against one blob store must
refuse a mismatched pair.** `scripts/prune-photos.ts` calls a blob an orphan
when no `price_entries.photo_url` references it — so pointing it at
`file:local.db` while `BLOB_READ_WRITE_TOKEN` still names production makes
every real photo look unreferenced, and `--delete` would take all of them. It
prints the database it is comparing, and refuses to delete when the database
references no photo at all (`--force` overrides). Any future operator script
that diffs two systems needs the same shape of guard: name both sides, and
treat "one side is suspiciously empty" as an error, not as a big cleanup.

**4.62 Two naming facts that cost a grep each.** The source-icon chip key on
history and product detail is `productDetail.source.*` — not the `history.*`
namespace its position on screen suggests. And the two operations people look
for under "products" are split: merging duplicates lives in
`db/repositories/products.ts`, exporting a user's full data in
`services/export.ts`.

**4.63 The unit-price invariant's tolerance must SCALE with the package
size, or the app refuses its own arithmetic.** `unit_price_milli` is an
integer, so rounding it costs up to half a milli-euro per base unit: half a
cent on a 1 kg pack, but **13,5 cents on a 270-piece box of tissues**
("FAZZ.COOP 9X30PZ", 3,09 € → 0,01144 € each → storable only as 11 milli,
which multiplies back to 2,97 €). Against a fixed one-cent slack that is a
violation, so `confirmReceipt` threw `INVALID_PRICE` — for the whole receipt,
over a number the app itself had derived and nobody had touched. This is the
real cause of the "Il prezzo non è valido" report; the discount case in §4.64
is a second, independent way to produce the same rejection.
`isUnitPriceConsistent` therefore allows `max(10, packageSize / 2)` milli.
Any real disagreement is worth far more than that. The lesson generalizes:
when a stored value is quantized, a tolerance on a quantity DERIVED from it
has to carry the quantization, not a constant somebody once found reasonable.

**4.64 A printed €/kg is the price BEFORE that line's discount, and the
entry contract cannot hold both.** `deriveUnitPriceMilli` preferred the
weighed line's printed unit price over the derived one — right in general (a
50 g item rounded to the cent is 2 % off, so re-deriving invents a price) but
wrong for a weighed product on offer: the scale prints "2,00 €/kg" next to a
total that worked out to 1,60 €/kg, and `confirmReceipt` then refused the
WHOLE receipt with `INVALID_PRICE`. The user saw "Il prezzo non è valido"
under a bar that said "5 pronte · 0 da sistemare", with nothing naming the
line. Two fixes, both of which the next comparable case wants: the printed
value is now only *preferred* — it is used when it multiplies out to the
paid total, and the derived one otherwise, because rounding to the cent
never breaks the invariant and a discount always does — and the invariant
itself moved into `domain/money.ts` (`isUnitPriceConsistent`,
`UNIT_PRICE_TOLERANCE_MILLI`) so the derivation, the review screen and the
confirm service all ask exactly one question. Rule of thumb: a server-side
assertion the client cannot evaluate is a rejection nobody can act on —
either share the predicate or do not assert it.

**4.65 Σ printed lines never equals the receipt total, and that is the
import working correctly — except when it is an invented purchase.** The extraction deliberately skips everything
that is not a product (the bag levy, deposits, "vuoto a rendere", coupons
and trip-level discounts printed after the subtotal), so the header's
"Totale righe" is *supposed* to sit above or below the printed total — the
5-cent `RECEIPT_TOTAL_TOLERANCE_CENTS` (in `domain/receipts.ts`, because the
review screen re-asks the same question live) only decides when to say so. Reading
the difference as "the model misread a line" costs a session; the review
header therefore shows the signed gap next to the two totals, and the
mismatch copy names the usual culprits. The two totals on the review screen
answer different questions and must not be merged: the header's is the
*transcription* (Σ of what was printed, static, comparable with the paper),
the confirm bar's is *what will be saved* (price × quantity over the
included lines, live under every edit and exclusion) — and the header's
reconciliation now uses the LIVE number, because a difference that cannot
move tells the user nothing they can act on.

**4.66 Haiku miscounts a long run of identical receipt lines, and no
per-line check can see it.** A real Coop self-scan receipt printed six
"M-T PESTO GEN.COOP 1,64" lines (each followed by an indented "X prezzo
tutelato" annotation); the model returned **seven** — 1,64 € of shopping
that never happened. Every line is individually plausible, the confidences
were 0.9, and the fold into one card with `quantity` hides the miscount
behind a stepper. Two prompt attempts did NOT fix it (a counting rule, an
annotation rule, and a worked example in the exact shape — all three kept,
they are true and cheap, but verified insufficient on this document). What
does work is deterministic: the printed total. `suggestExtraPackages`
(pure, in `domain/receipt-lines.ts`) reports when the gap is an exact
multiple of one line's package price and no second line explains it, and the
review names that line — one tap on its stepper closes the gap. Two rules
worth carrying: a self-check bullet telling the model "Σ must not exceed the
total" is **dangerous** without the trip-level-discount carve-out (a receipt
with a spesa-level discount legitimately has Σ > total, and the instruction
would make the model delete a real line); and when the model cannot be made
reliable, look for an invariant in the document itself rather than adding a
fourth paragraph to the prompt.

---

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
| `docs/DEVELOPMENT_GUIDELINES.md` | Layers, naming, errors, testing, security, performance | Once fully; re-check when unsure |
| `docs/COMMENTS.md` | Comment types and discipline | Before writing any code with comments |
| `DESIGN.md` | Tokens, typography, layout vocabulary, animation, anti-patterns — generated by the impeccable documenter from the shipped UI build | **Mandatory before any UI work** |
| `PRODUCT.md` | Product truth for the impeccable skill (users, positioning, constraints, brand commitments) | Before any impeccable command or a new surface |
| `CLAUDE.md` | Current implementation status + working notes | First thing, every session |
| `CONTRIBUTING.md` | External-contributor workflow (PRs, issues) | When touching contribution flow |

Precedence when documents appear to conflict:
`AGENTS.md` → the general guideline docs.
A real conflict is a bug: fix the documents, starting from the top.
