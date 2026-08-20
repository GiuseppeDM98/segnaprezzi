# Spec 04 — Personal Inflation Engine

> **Status**: Approved · **Last updated**: 2026-08-20
> Implements section 7 of `docs/specs/00-overview.md`. This spec is the full
> algorithm, the exhaustive edge-case contract, and the acceptance fixtures.
> The worked example in §6 is normative: its numbers **are** the test fixtures.

---

## 1. Goal & methodology rationale

The engine answers one question: *given everything this user has ever paid,
what is their personal inflation?* It produces a chained monthly price index
(base 100), category sub-indices, headline percentages, coverage statistics,
and the top price movers — all from the user's own `price_entries`.

This section teaches the index-number concepts a contributor needs. Per
`docs/COMMENTS.md`, the same teacher-level explanations must appear as
comments in the code itself; this spec is their source of truth.

### 1.1 Why not just average prices?

You cannot average €2.28/kg pasta with €1.69/L diesel — the units differ and
the mean of raw prices is dominated by whichever product happens to be
expensive. Index theory solves this with **price relatives**: for each product,
divide this month's price by last month's price. A relative is dimensionless
(1.05 = "up 5%"), so relatives of pasta and diesel *can* be combined.

### 1.2 Why matched-model?

A relative only measures pure price change if it compares **the same product
with itself**. If we naively compared "the average price of everything bought
in April" with "the average price of everything bought in March", a user who
bought steak in April and lentils in March would register massive fake
inflation. So each month-over-month link uses only the products observed (or
imputed) in **both** months — the *matched set*. This is the matched-model
principle used by every statistical office.

### 1.3 Why a geometric mean (Jevons) within a category?

Inside a category we have no quantity data per product-month pair that we can
trust (a user may photograph a tag without buying three packs), so the
relatives are combined **unweighted** — exactly ISTAT's situation inside its
*elementary aggregates*, and ISTAT's answer is the same: the **Jevons index**,
the geometric mean of relatives.

The obvious alternative — the arithmetic mean of relatives (Carli index) —
has a systematic upward bias because it fails the *time-reversal test*:

```
Price doubles then halves: relatives 2.0, then 0.5.
Carli  : (2.0 + 0.5) / 2 = 1.25   → +25% though the price is back where it started
Jevons : √(2.0 × 0.5)    = 1.0    → 0%, correct
```

The geometric mean treats a +10% and a −10% move symmetrically and is
transitive under chaining. Carli's bias is why the EU banned it for HICP
elementary aggregates. We use Jevons.

### 1.4 Why expenditure weights across categories (Laspeyres-style)?

Across categories, quantities *do* matter: a 10% fuel rise hurts a commuter
far more than a 10% rise in shampoo. We weight each category's relative by the
user's **expenditure share** in that category — the sum of `total_price_cents`
over the trailing 12 months. Weighting current price change by (near-)past
expenditure shares is the **Laspeyres** idea; ISTAT does it with basket
weights updated once a year. A single person's basket is far noisier than a
nation's, so we use a rolling 12-month window instead of a fixed annual
basket: it smooths seasonal spending (December pandoro, August fuel) while
still being "the basket you actually buy".

### 1.5 Why chained?

A fixed-base index (compare every month directly to month 1) dies the moment
the basket changes — and a personal basket changes constantly: products get
discontinued, the user discovers new ones. **Chaining** multiplies
month-over-month links: `I(m) = I(m−1) × R(m)`. Each link uses whatever
matched set exists *for that pair of months*, so products can enter and leave
the basket freely without breaking the series. This mirrors ISTAT's annually
chained NIC, at monthly granularity.

### 1.6 Honesty as a design requirement

A national index averages millions of quotes; a personal one may hang on five
products. Every result therefore carries **coverage statistics** (products
compared, categories covered, imputed share, flags for months with no overlap
and clamped outliers) and the UI is contractually required to surface them.
A headline number computed from two products must *look* thin.

---

## 2. Module layout

```
src/lib/inflation/
├── types.ts        # All public and internal types (no logic)
├── bucketing.ts    # toRomeYearMonth, ym arithmetic, month grid, monthly means, imputation
├── relatives.ts    # Matched-model relatives with outlier clamp
├── weights.ts      # Trailing-12-month expenditure shares, renormalization
├── chain.ts        # Jevons aggregation, chaining, computePersonalCpi orchestrator
├── coverage.ts     # Coverage statistics
├── movers.ts       # Top movers
├── istat.ts        # rebaseIstat — pure helper for the official-series overlay
├── index.ts        # Barrel: re-exports the public API ONLY
└── *.test.ts       # Colocated unit tests (Vitest)
```

**PURITY RULE (non-negotiable, from Spec 00 §5):** every file in
`src/lib/inflation/` is pure domain code —

- zero I/O: no fetch, no filesystem, no database;
- no imports from `src/lib/db/`, `src/lib/ai/`, `src/lib/services/`, or any
  `next/*` / `react` module;
- inputs are plain typed arrays and objects; outputs are plain objects;
- **deterministic**: no `Date.now()`, no `Math.random()`, no locale-dependent
  behavior beyond the pinned `Intl.DateTimeFormat` below. The same input
  always produces the bit-identical output. Internally, products are iterated
  in sorted `productId` order before summing logarithms — the geometric mean
  is mathematically order-independent, but floating-point addition is not
  associative, and sorting keeps results bit-stable regardless of input order.

Consumers import from `src/lib/inflation` (the barrel). Importing a sibling
module directly from outside the folder is forbidden; `index.ts` re-exports
`computePersonalCpi`, `rebaseIstat`, `toRomeYearMonth`, and the public types
— nothing else.

---

## 3. Public API

```ts
// src/lib/inflation/types.ts

import type { CategoryId } from '@/lib/domain/categories';

/**
 * Minimal projection of a price entry needed by the engine.
 *
 * Deliberately NOT the Drizzle row type: the engine must not depend on the
 * persistence schema. `category` is denormalized from the product at
 * projection time (repository JOIN) so the engine never joins anything.
 *
 * This is the ONE definition of IndexEntry in the codebase. Spec 02's
 * `listEntriesForIndex` imports this type and returns exactly it — the
 * repository maps the DB `Date` to `recordedAt` epoch milliseconds.
 */
export interface IndexEntry {
  productId: string;
  category: CategoryId;
  recordedAt: number; // epoch milliseconds UTC
  totalPriceCents: number; // integer euro cents actually paid/displayed
  unitPriceMilli: number; // integer milli-euros per base unit (kg | L | piece)
  isPromo: boolean;
}

/** Minimal product projection — only what movers need for display. */
export interface IndexProduct {
  id: string;
  name: string;
  brand: string | null;
  category: CategoryId;
}

/** Mirrors the `user_settings` columns that affect the index. */
export interface IndexSettings {
  includePromosInIndex: boolean; // default true
  carryForwardMonths: number; // default 2; 0 disables imputation
}

/** One point of a chained series. All numbers are raw floats — round at display only. */
export interface MonthPoint {
  ym: string; // 'YYYY-MM' (Europe/Rome calendar month)
  index: number; // chained level, base month = 100
  momPct: number; // month-over-month %, 0 for the base month
  yoyPct: number | null; // year-over-year %; null until 13 months of series exist
}

export interface Headline {
  latestYm: string;
  momPct: number;
  yoyPct: number | null;
  sinceStartPct: number; // index(latest) − 100
}

export interface CategorySeries {
  category: CategoryId;
  /** Own chained index, base 100 at the category's first month with a price. */
  series: MonthPoint[];
}

export interface Coverage {
  /** Size of the matched set in the latest month-over-month link. */
  productsCompared: number;
  /** Distinct categories in that matched set. */
  categoriesCovered: number;
  /**
   * Share of the 2·n product-month prices entering the latest link that were
   * carry-forward imputations rather than observations. Range 0..1.
   */
  imputedShare: number;
  /** Total number of input entries the computation saw. */
  entryCount: number;
  /** Months where no product matched and the index was carried flat. */
  monthsWithoutOverlap: string[];
  /** Total count of relatives clamped by the outlier guard across the whole series. */
  outliersClamped: number;
}

export interface ProductMover {
  productId: string;
  name: string;
  category: CategoryId;
  fromYm: string;
  toYm: string;
  fromMilli: number; // observed monthly mean, float (means of integers)
  toMilli: number;
  pct: number; // (toMilli / fromMilli − 1) × 100
}

export interface PersonalCpiResult {
  series: MonthPoint[]; // [] when there are no entries
  headline: Headline | null; // null when series is empty
  categories: CategorySeries[];
  coverage: Coverage;
  movers: ProductMover[]; // risers then fallers, sorted by pct descending
}
```

```ts
// src/lib/inflation/chain.ts — the single entry point (re-exported by index.ts)

export function computePersonalCpi(input: {
  entries: IndexEntry[];
  products: IndexProduct[];
  settings: IndexSettings;
}): PersonalCpiResult;
```

Preconditions (enforced by callers via Zod at the boundary, per
`DEVELOPMENT_GUIDELINES.md` — the engine may assume them):

- every `entry.productId` exists in `products`;
- `unitPriceMilli > 0`, `totalPriceCents >= 0`, `recordedAt` is a valid epoch ms;
- `carryForwardMonths` is an integer `>= 0`.

With `entries: []` the engine returns
`{ series: [], headline: null, categories: [], movers: [], coverage: { …all zeros, monthsWithoutOverlap: [] } }`
— it never throws on empty input.

---

## 4. Algorithm

All arithmetic on relatives, means, weights, and index levels uses IEEE-754
floats — these are ratios, not money (Spec 00 §6). Nothing is rounded until
the display layer.

### 4.0 Notation

```
i          a product;  c  a category;  m  a calendar month (Europe/Rome)
p_i(m)     price of product i in month m (mean unitPriceMilli, possibly imputed)
r_i(m)     = p_i(m) / p_i(m−1)                          matched-model relative
r̂_i(m)    = min(5, max(0.2, r_i(m)))                    outlier-clamped relative
M(m)       matched set: products with p defined in both m−1 and m
M_c(m)     matched products of category c;  C(m) = { c : M_c(m) ≠ ∅ }

R_c(m)     = ( ∏_{i ∈ M_c(m)} r̂_i(m) ) ^ (1 / |M_c(m)|)          Jevons
E_c(m)     = Σ totalPriceCents of category-c entries in months m−11 … m
w_c(m)     = E_c(m) / Σ_{c' ∈ C(m)} E_{c'}(m)     renormalized over C(m)
R(m)       = Σ_{c ∈ C(m)} w_c(m) · R_c(m)         overall monthly relative

I(m₀)      = 100                                   m₀ = first month with data
I(m)       = I(m−1) · R(m)                         chained index
```

### 4.1 Step 1 — Bucket entries into Europe/Rome calendar months

Every timestamp is stored as epoch milliseconds UTC; the month it belongs to
is defined by the **Europe/Rome** wall clock (Spec 00 §6). A scan at 00:30 on
1 April in Milan is 22:30 on 31 March UTC — bucketing in UTC would file it
under the wrong month and shift a whole shopping trip across a MoM boundary.

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

Month arithmetic never touches `Date` again — `'YYYY-MM'` strings are handled
with pure integer math:

```ts
/** Shift a 'YYYY-MM' key by a (possibly negative) number of months. */
export function addMonthsToYm(ym: string, delta: number): string {
  const [year, month] = ym.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(totalMonths / 12);
  const shiftedMonth = (totalMonths % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

/** Signed number of months from `fromYm` to `toYm` ('2026-01' → '2026-04' = 3). */
export function countMonthsBetween(fromYm: string, toYm: string): number;
```

**Month grid.** The series spans every calendar month from the first to the
last month containing at least one entry — including empty months in between
(carry-forward may fill them; if not, the index carries flat, §5). The grid
never extends to "today": the engine is pure and must not consult the wall
clock, so the series ends at the last month with data. This also makes every
test deterministic.

**Per-product monthly mean.** For each product and grid month:

1. Collect the product's entries in that month.
2. If `settings.includePromosInIndex` is `false`, drop entries with
   `isPromo === true` — **but if that leaves the product-month empty while
   promo entries exist, fall back to the promo entries.**
   *Why:* a promo price is still a real price the user saw; treating a
   promo-only month as "no data" would silently shrink the matched set and
   bias the index toward products that never go on promotion. The setting
   means "prefer regular prices", not "pretend promos never happened".
3. The product's monthly price `p_i(m)` is the arithmetic mean of
   `unitPriceMilli` over the surviving entries (a plain float). Duplicate
   observations in a month — two stores, a re-scan, entries moved in by a
   product merge — simply average.

### 4.2 Step 2 — Carry-forward imputation

Sparse personal data means most products are not bought every month. For each
product and each grid month with no observed mean, if the product's most
recent **observed** monthly mean is at most `settings.carryForwardMonths`
calendar months old, impute that value, flagged `isImputed`. The window is
counted from the observation month, so with `carryForwardMonths = 2` an
observation in March can fill April and May but not June.
`carryForwardMonths = 0` disables imputation entirely. Imputation is only
ever forward in time — the engine never backcasts.

Imputed values participate fully in the matched set: if pasta is observed in
April and imputed in May, the May relative is `1.0` and a June observation
produces a June relative from the imputed May base. This is deliberate —
because the carried value equals the April observation, chaining across the
gap reproduces exactly the April→June change (`1.0 × p(Jun)/p(Apr)`), so no
price movement is lost, only delayed.

*Teacher note — known bias:* carry-forward relatives of `1.0` drag the Jevons
mean toward "no change", damping measured inflation while a product is
imputed. That is the standard, accepted cost of carry-forward imputation
(statistical offices pay it too); it is bounded by `carryForwardMonths` and
made visible through `coverage.imputedShare`.

### 4.3 Step 3 — Matched-model relatives with outlier clamp

For each consecutive month pair `(m−1, m)` and each product with a price
(observed or imputed) in both, compute `r_i(m) = p_i(m) / p_i(m−1)` and clamp
to `[0.2, 5]`:

- A genuine month-over-month grocery or fuel move virtually never exceeds
  ×5 or ÷5; moves that large are almost always data errors — a €/100 g tag
  normalized as €/kg (×10), a wrong pack size, a bad product match.
- Clamping (rather than dropping) keeps the matched set stable, preserves the
  direction of the move, and bounds the damage of one bad photo to at most a
  factor 5 on one product for one month.
- Real spikes survive: vegetables doubling after a frost (+100% → 2.0) or a
  fuel shock pass untouched.
- Every clamp increments `coverage.outliersClamped`, so the UI can nudge the
  user to review suspicious entries.

### 4.4 Step 4 — Jevons within each category

For each category with at least one matched product,
`R_c(m) = exp( (1/n) Σ ln r̂_i(m) )` over its matched products (computed in
log space in sorted `productId` order for float determinism). A category with
a single matched product has `R_c(m)` equal to that product's clamped
relative.

### 4.5 Step 5 — Expenditure weights across categories

For month `m`, sum `totalPriceCents` per category over the trailing 12
calendar months **up to and including `m`** (`m−11 … m`, truncated at the
start of the grid). Promo entries **always** count toward expenditure,
regardless of `includePromosInIndex` — expenditure is what was actually paid;
the promo setting only governs which *price observations* enter the means.

Renormalize over the categories present in this month's matched set `C(m)`,
so weights of unmatched categories are redistributed proportionally:

```
w_c(m) = E_c(m) / Σ_{c' ∈ C(m)} E_{c'}(m)
```

Defensive rule: if `Σ E_c(m)` over `C(m)` is `0` (only reachable with
`carryForwardMonths > 11` carrying matches beyond the expenditure window, or
zero-priced entries), fall back to equal weights `1/|C(m)|` rather than
dividing by zero.

### 4.6 Step 6 — Overall relative and chaining

`R(m) = Σ w_c(m) · R_c(m)` (arithmetic weighted mean of category relatives —
the Laspeyres-style aggregation of Spec 00 §7.4). Then chain:

- `I(m₀) = 100` at the first grid month; its `momPct` is `0` and `yoyPct` null.
- `I(m) = I(m−1) × R(m)`; `momPct(m) = (R(m) − 1) × 100`.
- If `M(m)` is empty (no product priced in both months), `R(m) = 1`: the
  index **carries flat** and `ym` is appended to
  `coverage.monthsWithoutOverlap`. A flat month is honest — with no matched
  product there is no evidence of price change either way.
- `yoyPct(m) = (I(m) / I(m−12) − 1) × 100` when the series contains `m−12`
  (i.e. from the 13th month), else `null`.

**Category series** are chained the same way per category: base 100 at the
category's first grid month with any priced product; months where the
category has no matched product carry flat. A category appearing mid-history
simply starts its series (and enters `C(m)` and the weights) at that point —
chaining is forward-only, so earlier index values never change retroactively.

### 4.7 Step 7 — Headline, coverage, movers

**Headline** (from the chained series; `null` if the series is empty):
`latestYm` = last grid month; `momPct` = that month's `momPct`; `yoyPct` =
that month's `yoyPct`; `sinceStartPct = I(latest) − 100` (the base is 100, so
this equals the total percentage change since the first month).

**Coverage** — see the `Coverage` type in §3. `productsCompared`,
`categoriesCovered`, and `imputedShare` describe the **latest** link
`(latest−1, latest)`; `imputedShare` is the imputed fraction of the `2·n`
product-month prices entering that link. `entryCount` is `entries.length`.
`monthsWithoutOverlap` and `outliersClamped` accumulate over the whole series.

**Movers** (`movers.ts`) — per product, using **observed** monthly means only
(imputed values would fabricate flat segments):

1. Skip products with fewer than 2 observed months.
2. `toYm` = the product's latest observed month; `toMilli` = its mean.
3. `fromYm` = the product's **earliest observed month within the window**
   `[toYm − 12 months, toYm)` — i.e. exactly 12 months back when that month
   is observed, otherwise the earliest available observation inside the
   window. `fromMilli` = its mean.
4. `pct = (toMilli / fromMilli − 1) × 100`. Products with `pct === 0` are
   excluded (nothing moved).
5. Rank: up to 5 risers (`pct > 0`, largest first) and up to 5 fallers
   (`pct < 0`, most negative first), returned as one array sorted by `pct`
   descending. `name`, `brand`-independent display fields come from
   `products`.

---

## 5. Edge cases — specified behavior

| # | Case | Behavior |
|---|---|---|
| 1 | Zero entries / zero products | `series: []`, `headline: null`, `categories: []`, `movers: []`, coverage all zeros. Never throws. |
| 2 | One product only | Index is that product's clamped relative chain; its category has weight 1 after renormalization. |
| 3 | Product with a single observation ever | Contributes to the month grid, to expenditure weights, and (via carry-forward) relatives of `1.0` for up to `carryForwardMonths`; never produces a non-unit relative. With `carryForwardMonths = 0` it never enters any matched set. |
| 4 | A month pair with no overlap at all | `R(m) = 1`, index carries flat, `ym` appended to `coverage.monthsWithoutOverlap`. |
| 5 | First month | `index = 100`, `momPct = 0`, `yoyPct = null`. It is the chain base (Spec 00 §2 "Base month"). |
| 6 | Promo-only product-month with `includePromosInIndex = false` | Falls back to promo entries instead of dropping the month (§4.1 why). Coverage is not affected — the price is observed, not imputed. |
| 7 | Product merged (Spec 00 §8) | Outside the engine's scope: the service re-points entries to the surviving `productId` **before** projection; the engine just sees one product whose same-month duplicates average (§4.1.3). Purity means merges need no engine changes. |
| 8 | Huge outlier (unit mix-up, wrong match) | Relative clamped to `[0.2, 5]`; `coverage.outliersClamped` incremented (§4.3 justification). |
| 9 | Category appears mid-history | Enters matched set, weights, and its own base-100 series from its first priced month; prior overall index values are untouched (forward-only chaining, §4.6). |
| 10 | `carryForwardMonths = 0` | No imputation. Gaps shrink matched sets; a fully missing month becomes case 4. |
| 11 | Empty month inside the grid | Kept in the grid. Carry-forward may populate it; otherwise case 4 applies for both adjacent links. |
| 12 | Entry at a UTC/Rome month boundary | Bucketed by Rome wall clock (§4.1 examples). |
| 13 | `carryForwardMonths > 11` (pathological settings) | Matched categories can have zero trailing expenditure → equal-weight fallback (§4.5). |

---

## 6. Worked example (normative fixture)

Three products, four months, default settings
(`includePromosInIndex: true`, `carryForwardMonths: 2`). Every intermediate
below is shown to 4 decimals; the acceptance test (§7, case 22) must
reproduce them to a `1e-4` absolute tolerance (`toBeCloseTo(x, 4)` on 4-decimal
values). All fixture timestamps are at 10:00 UTC, so Rome month = UTC month.

**Products**

| id | name | brand | category | unitKind |
|---|---|---|---|---|
| `pasta` | Spaghetti n.5 500g | Barilla | `food` | weight |
| `oil` | Olio extravergine 1L | — | `food` | volume |
| `diesel` | Diesel | — | `fuel` | volume |

**Entries** (13 total; prices are plausible Italian 2026 prices)

| product | recordedAt (Rome) | totalPriceCents | packageSize | unitPriceMilli | isPromo |
|---|---|---:|---:|---:|---|
| pasta | 2026-03-07 | 119 | 0.5 kg | 2380 | no |
| pasta | 2026-03-21 | 109 | 0.5 kg | 2180 | **yes** |
| pasta | 2026-04-11 | 125 | 0.5 kg | 2500 | no |
| pasta | 2026-06-05 | 129 | 0.5 kg | 2580 | no |
| oil | 2026-03-14 | 799 | 1.0 L | 7990 | no |
| oil | 2026-04-11 | 849 | 1.0 L | 8490 | no |
| oil | 2026-05-09 | 829 | 1.0 L | 8290 | no |
| oil | 2026-06-05 | 819 | 1.0 L | 8190 | no |
| diesel | 2026-03-02 | 5405 | 32.0 L | 1689 | no |
| diesel | 2026-03-19 | 5097 | 30.0 L | 1699 | no |
| diesel | 2026-04-16 | 5348 | 31.0 L | 1725 | no |
| diesel | 2026-05-14 | 5772 | 33.0 L | 1749 | no |
| diesel | 2026-06-11 | 5217 | 30.0 L | 1739 | no |

Note pasta has **no May entry** — carry-forward will fill it. The March promo
entry is included in the mean (`includePromosInIndex: true`).

### 6.1 Monthly means `p_i(m)` (unitPriceMilli)

| product | 2026-03 | 2026-04 | 2026-05 | 2026-06 |
|---|---:|---:|---:|---:|
| pasta | (2380+2180)/2 = **2280** | **2500** | **2500** *(imputed ← Apr)* | **2580** |
| oil | **7990** | **8490** | **8290** | **8190** |
| diesel | (1689+1699)/2 = **1694** | **1725** | **1749** | **1739** |

### 6.2 Product relatives `r_i(m)` (none hit the [0.2, 5] clamp)

| product | 2026-04 | 2026-05 | 2026-06 |
|---|---:|---:|---:|
| pasta | 2500/2280 = **1.0965** | 2500/2500 = **1.0000** *(imputed)* | 2580/2500 = **1.0320** |
| oil | 8490/7990 = **1.0626** | 8290/8490 = **0.9764** | 8190/8290 = **0.9879** |
| diesel | 1725/1694 = **1.0183** | 1749/1725 = **1.0139** | 1739/1749 = **0.9943** |

### 6.3 Jevons category relatives `R_c(m)`

| category | 2026-04 | 2026-05 | 2026-06 |
|---|---:|---:|---:|
| food | √(1.0965 × 1.0626) = **1.0794** | √(1.0000 × 0.9764) = **0.9882** | √(1.0320 × 0.9879) = **1.0097** |
| fuel | **1.0183** | **1.0139** | **0.9943** |

(Fuel has one matched product, so its Jevons mean equals its single relative.)

### 6.4 Expenditure and weights

Monthly expenditure by category (Σ `totalPriceCents`; pasta's imputed May has
no entry, hence no expenditure):

| category | 2026-03 | 2026-04 | 2026-05 | 2026-06 |
|---|---:|---:|---:|---:|
| food | 119+109+799 = 1027 | 125+849 = 974 | 829 | 129+819 = 948 |
| fuel | 5405+5097 = 10502 | 5348 | 5772 | 5217 |

Trailing sums `E_c(m)` (window truncated at 2026-03, the start of the grid)
and renormalized weights `w_c(m)` (both categories are always matched here,
so renormalization divides by the full total):

| month | E_food | E_fuel | total | w_food | w_fuel |
|---|---:|---:|---:|---:|---:|
| 2026-04 | 2001 | 15850 | 17851 | 2001/17851 = **0.1121** | **0.8879** |
| 2026-05 | 2830 | 21622 | 24452 | **0.1157** | **0.8843** |
| 2026-06 | 3778 | 26839 | 30617 | **0.1234** | **0.8766** |

### 6.5 Overall relatives and chained index

```
R(2026-04) = 0.1121 × 1.0794 + 0.8879 × 1.0183
           = 0.1210 + 0.9042 = 1.0251
R(2026-05) = 0.1157 × 0.9882 + 0.8843 × 1.0139
           = 0.1144 + 0.8966 = 1.0109
R(2026-06) = 0.1234 × 1.0097 + 0.8766 × 0.9943
           = 0.1246 + 0.8716 = 0.9962

I(2026-03) = 100                       (base month)
I(2026-04) = 100      × 1.0251 = 102.5149
I(2026-05) = 102.5149 × 1.0109 = 103.6355
I(2026-06) = 103.6355 × 0.9962 = 103.2405
```

(Chain products are computed at full float precision — 102.5149 is
100 × 1.02514905, not 100 × the rounded 1.0251.)

**Final series** (the fixture's expected `series`):

| ym | index | momPct | yoyPct |
|---|---:|---:|---|
| 2026-03 | 100.0000 | 0.0000 | null |
| 2026-04 | 102.5149 | +2.5149 | null |
| 2026-05 | 103.6355 | +1.0931 | null |
| 2026-06 | 103.2405 | −0.3812 | null |

**Headline**: `latestYm: '2026-06'`, `momPct: −0.3812`, `yoyPct: null`
(only 4 months), `sinceStartPct: +3.2405`.

**Category series**:

| ym | food | fuel |
|---|---:|---:|
| 2026-03 | 100.0000 | 100.0000 |
| 2026-04 | 107.9402 | 101.8300 |
| 2026-05 | 106.6612 | 103.2468 |
| 2026-06 | 107.6988 | 102.6564 |

**Coverage**: `productsCompared: 3`, `categoriesCovered: 2`,
`imputedShare: 0.1667` (pasta's imputed May is 1 of the 6 prices in the
May→June link), `entryCount: 13`, `monthsWithoutOverlap: []`,
`outliersClamped: 0`.

**Movers** (all three qualify — ≥2 observed months; window from each
product's latest observed month, June, back to March; sorted by pct desc):

| product | fromYm → toYm | fromMilli → toMilli | pct |
|---|---|---|---:|
| pasta | 2026-03 → 2026-06 | 2280 → 2580 | **+13.1579** |
| diesel | 2026-03 → 2026-06 | 1694 → 1739 | **+2.6564** |
| oil | 2026-03 → 2026-06 | 7990 → 8190 | **+2.5031** |

*Reading the example like a teacher:* the personal index rose only ~3.2%
while pasta rose ~13% — because this user's spending is ~88% fuel, and fuel
rose modestly then fell back. That asymmetry between "a price I noticed" and
"my actual inflation" is precisely what expenditure weighting exists to
capture, and precisely the app's point.

---

## 7. Test plan

All tests are colocated Vitest unit tests in `src/lib/inflation/*.test.ts`,
AAA-structured, behavioral names. Helper builders (`buildEntry`,
`buildProduct`, defaults + overrides) live in a colocated
`fixtures.ts` (not exported by the barrel).

| # | Test name | Input sketch | Expected |
|---|---|---|---|
| 1 | should return empty series and null headline when there are no entries | `entries: []` | `series: []`, `headline: null`, coverage zeros, no throw |
| 2 | should return a single base point at 100 for one month of data | 1 product, 2 entries in one month | `series: [{ index: 100, momPct: 0, yoyPct: null }]`, headline sinceStartPct 0 |
| 3 | should compute a single-product chain equal to the product's price relatives | 1 product, 3 months: 1000, 1100, 990 | index 100, 110, 99; momPct +10, −10 |
| 4 | should average multiple observations of a product within the same month | 2 entries 2380 & 2180 in March | March mean 2280 (assert via the resulting relative) |
| 5 | should bucket entries by the Europe/Rome calendar month, not UTC | entry at `2026-03-31T22:30:00Z` | lands in `2026-04` (assert via `toRomeYearMonth` and series) |
| 6 | should exclude promo entries from monthly means when includePromosInIndex is false | month with promo 1800 + regular 2000 | mean 2000 |
| 7 | should fall back to promo entries when a product-month has only promos | promo-only month, `includePromosInIndex: false` | month keeps the promo mean; not counted as imputed |
| 8 | should carry a price forward up to carryForwardMonths and flag it imputed | obs Mar, gap Apr–May, obs Jun, `carryForwardMonths: 2` | Apr & May imputed at Mar value; `imputedShare > 0` on the relevant link |
| 9 | should not impute beyond carryForwardMonths | obs Mar, next obs Jul, `carryForwardMonths: 2` | Jun has no price; Jun link has no match for that product |
| 10 | should not impute at all when carryForwardMonths is 0 | obs Mar, gap, obs May | Apr missing; both Apr links unmatched for the product |
| 11 | should keep the index flat and flag months with no product overlap | product A in Mar only, product B in Apr only, `carryForwardMonths: 0` | Apr index 100, `monthsWithoutOverlap: ['2026-04']` |
| 12 | should count a single-observation product in weights but not in price change | 1-obs product with huge totalPriceCents + a moving product in another category | index reflects mover damped by weights; no crash |
| 13 | should clamp a relative above 5 and count it in outliersClamped | 1000 → 60000 (×60, a €/100g mix-up) | relative treated as 5; `outliersClamped: 1` |
| 14 | should clamp a relative below 0.2 and count it in outliersClamped | 60000 → 1000 | relative treated as 0.2; `outliersClamped: 1` |
| 15 | should weight categories by trailing 12-month expenditure renormalized over matched categories | 3 categories, one unmatched in month m | unmatched category's weight redistributed; weights sum to 1 |
| 16 | should start a category series at 100 in the month the category first appears | `fuel` entries start in month 3 of 5 | fuel series starts at month 3 with index 100; overall series unchanged before month 3 |
| 17 | should compute the category relative as a geometric mean of product relatives | two food products +10% and −10% | food relative √(1.1 × 0.9) = 0.99499, not 1.0 |
| 18 | should report yoyPct only from the 13th month of the series | 13 months, +1% every month | months 1–12 `yoyPct: null`; month 13 `yoyPct ≈ 12.6825` (1.01¹² − 1) |
| 19 | should rank movers by percent change and cap at five risers and five fallers | 8 risers + 7 fallers | 10 movers: top-5 risers then top-5 fallers, sorted by pct desc |
| 20 | should exclude products with fewer than two observed months from movers | product with 1 observation + carry-forward | not in `movers` even though it has imputed months |
| 21 | should compare movers against the observation closest to twelve months back | 15 months of data for one product | `fromYm` is exactly `toYm − 12` when observed, else earliest inside the window |
| 22 | should reproduce every number of the Spec 04 §6 worked example | the §6 fixture verbatim | series, headline, categories, coverage, movers all match §6 to 4 decimals |
| 23 | property: constant prices always yield a flat series at 100 | randomized fixtures (seeded PRNG): N products, M months, random constant prices, random gaps within carry-forward reach | every `index === 100 ± 1e-9`, every `momPct === 0 ± 1e-9` |
| 24 | should return bit-identical results regardless of input entry order | §6 fixture shuffled (seeded) | deep-equal with the unshuffled result (`toStrictEqual`, not `toBeCloseTo`) |

Case 23 is the property-style test: generate ~50 seeded random fixtures in a
loop (no extra dependency needed; a tiny mulberry32 PRNG in `fixtures.ts`
keeps it deterministic). Case 22 is the acceptance fixture — if it fails,
either the code or this spec is wrong, and this spec wins until proven
otherwise with hand arithmetic.

Also cover the two pure helpers directly: `toRomeYearMonth` (DST boundary
examples from §4.1), `addMonthsToYm` (year rollover both directions,
`'2026-01' − 2 = '2025-11'`), and `rebaseIstat` (§8).

---

## 8. ISTAT comparison

The dashboard overlays the official ISTAT NIC (all-items) index on the
personal series. Official data is a static, committed file — no runtime
fetches, no API keys, works offline.

### 8.1 `data/istat-nic.json` (committed)

```json
{
  "source": "ISTAT SDMX REST (esploradati.istat.it)",
  "indexName": "NIC all items",
  "base": "2015=100",
  "updatedAt": "2026-08-20T06:00:00.000Z",
  "months": {
    "2025-05": 121.6,
    "2025-06": 121.8,
    "2025-07": 122.1
  }
}
```

- `months` keys are `'YYYY-MM'`, values are the official index levels in the
  base stated by `base` (whatever ISTAT publishes; `rebaseIstat` makes the
  base irrelevant to the UI).
- `updatedAt` is the fetch time (ISO string), set by the update script.

### 8.2 `scripts/update-istat.ts` contract

Run with `pnpm istat:update`. This spec adds the corresponding row to
`package.json` as a deliverable:
`"istat:update": "tsx scripts/update-istat.ts"`. This is a maintenance
script, not app code — it may do I/O freely, but must follow the
error-handling guidelines (fail fast, loud, diagnosable).

1. **Fetch** the monthly NIC all-items series from the ISTAT SDMX REST
   endpoint family:
   `https://esploradati.istat.it/SDMXWS/rest/data/{flowRef}/{key}?format=jsondata`
   with a flowRef from the consumer-prices NIC dataflow family (e.g.
   `IT1,167_744,1.0`) and a key selecting the all-items (`00`) monthly index.
   **This endpoint may need adjustment**: ISTAT periodically reorganizes
   dataflow IDs and hosts (the legacy host was `sdmx.istat.it`). The
   implementer must verify the current flowRef via
   `…/rest/dataflow/IT1?format=jsondata` or ISTAT's data browser, and record
   the final URL in a why-comment in the script.
2. **Validate hard, fail loudly.** Non-200 response, unparseable body,
   unexpected SDMX-JSON shape, empty series, or any `ym` not matching
   `/^\d{4}-(0[1-9]|1[0-2])$/` → log a diagnostic error (URL, status, first
   bytes of the body) and `process.exit(1)`. **Never write anything on
   failure.**
3. **Replace, don't merge**: rebuild `months` from the full fetched series
   each run — ISTAT revises provisional figures, and full replacement
   self-heals past revisions.
4. **Atomic write**: serialize the complete JSON (2-space indent, sorted
   month keys, trailing newline), write to `data/istat-nic.json.tmp`, then
   rename over `data/istat-nic.json`. A crash mid-write must never leave a
   truncated committed file.

### 8.3 `rebaseIstat` (pure, in `src/lib/inflation/istat.ts`)

```ts
/**
 * Rebase an official index series so that `baseYm` = 100, aligning it with
 * the personal index (whose base month is the user's first month of data).
 *
 * Returns null when `baseYm` is not present in the series (the user's
 * history may predate or outrun the committed ISTAT data) — the caller
 * hides the overlay instead of guessing.
 */
export function rebaseIstat(
  months: Record<string, number>,
  baseYm: string,
): Record<string, number> | null {
  const baseValue = months[baseYm];
  if (baseValue === undefined || baseValue === 0) return null;
  return Object.fromEntries(
    Object.entries(months).map(([ym, value]) => [ym, (value / baseValue) * 100]),
  );
}
```

The UI overlays `rebaseIstat(istat.months, personalSeries[0].ym)` on the
personal chart: both series read 100 at the user's base month, so the gap
between the curves *is* the "you vs Italy" story.

### 8.4 Optional monthly refresh workflow

`.github/workflows/update-istat.yml` — optional but recommended; opens a PR
so a human sees the diff before it lands:

```yaml
name: Update ISTAT NIC series
on:
  schedule:
    - cron: '0 6 20 * *' # monthly, after ISTAT's mid-month final release
  workflow_dispatch:
jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm istat:update
      - uses: peter-evans/create-pull-request@v7
        with:
          commit-message: 'chore: refresh ISTAT NIC series'
          title: 'chore: refresh ISTAT NIC series'
          branch: chore/update-istat-nic
```

---

## 9. Service integration

The service layer is deliberately thin — projection in, pure computation out.

Per Spec 02 §6.1, repositories take the database as their first parameter and
never import the db singleton themselves. The **service** is where injection
happens: it imports `db` from `@/lib/db/client` (allowed at this layer) and
passes it into every repository call.

```ts
// src/lib/services/inflation.ts
import { cache } from 'react';

import { db } from '@/lib/db/client';
import { listEntriesForIndex } from '@/lib/db/repositories/price-entries';
import { listProductsForIndex } from '@/lib/db/repositories/products';
import { getUserSettings } from '@/lib/db/repositories/settings';
import { computePersonalCpi, type PersonalCpiResult } from '@/lib/inflation';

/**
 * Compute the personal CPI for a user from their full entry history.
 *
 * Wrapped in React cache() for per-request memoization: the dashboard renders
 * the headline, the chart, and the category breakdown in separate server
 * components, and each may call this — cache() collapses them into one DB
 * read + one computation per request.
 *
 * Why no caching layer beyond that: personal data volumes are tiny (a heavy
 * user logs a few thousand entries per year) and the engine is
 * O(entries + products × months) — single-digit milliseconds. A persistent
 * cache would add invalidation complexity (every new entry, merge, or
 * settings change invalidates) for no measurable gain. Revisit only if
 * profiling ever says otherwise.
 */
export const getPersonalCpi = cache(
  async (userId: string): Promise<PersonalCpiResult> => {
    const [settings, entries, products] = await Promise.all([
      getUserSettings(db, userId),
      listEntriesForIndex(db, userId),
      listProductsForIndex(db, userId),
    ]);
    return computePersonalCpi({
      entries,
      products,
      settings: {
        includePromosInIndex: settings.includePromosInIndex,
        carryForwardMonths: settings.carryForwardMonths,
      },
    });
  },
);
```

Repository contracts (added in the Spec 02 repositories; queries only, no
business rules; per Spec 02 §6.1 every signature takes `db: Db` first):

```ts
// src/lib/db/repositories/price-entries.ts
/**
 * Minimal projection for the inflation engine, oldest first.
 * Joins products for the category; includes entries of archived products —
 * archiving hides a product from suggestions, never from history (Spec 00 §6).
 */
export function listEntriesForIndex(db: Db, userId: string): Promise<IndexEntry[]>;
// SELECT pe.product_id, p.category, pe.recorded_at, pe.total_price_cents,
//        pe.unit_price_milli, pe.is_promo
// FROM price_entries pe JOIN products p ON p.id = pe.product_id
// WHERE pe.user_id = ? ORDER BY pe.recorded_at ASC
// (served by the (user_id, product_id, recorded_at) composite index)

// src/lib/db/repositories/products.ts
/** id, name, brand, category for every product of the user (archived included). */
export function listProductsForIndex(db: Db, userId: string): Promise<IndexProduct[]>;
```

`IndexEntry` (with `recordedAt: number`, epoch milliseconds) is defined once,
in `src/lib/inflation/types.ts` (§3); `listEntriesForIndex` imports that type
and returns exactly it, mapping the DB `Date` to epoch ms in the projection.

The dashboard page (Spec 05) calls `getPersonalCpi(userId)` from a server
component and passes plain data down to client chart components. No route
handler is needed — the index is server-rendered.

---

## 10. Definition of Done

- [ ] `src/lib/inflation/` contains exactly the files of §2; `index.ts`
      re-exports only `computePersonalCpi`, `rebaseIstat`, `toRomeYearMonth`,
      and the public types.
- [ ] No file in `src/lib/inflation/` imports from `db/`, `ai/`, `services/`,
      `next/*`, or `react` (verified by inspection or a lint rule).
- [ ] `computePersonalCpi` implements §4 exactly: Rome bucketing, promo rule
      with promo-only fallback, carry-forward with observation-anchored
      window, `[0.2, 5]` clamp, Jevons in log space with sorted iteration,
      trailing-12-month renormalized weights (promos always in expenditure),
      flat-month handling, forward-only chaining.
- [ ] All §5 edge cases behave as specified.
- [ ] Test cases 1–24 of §7 implemented and green, including the §6
      acceptance fixture (every table value, 4-decimal tolerance) and the
      constant-price property test; engine line coverage ≈ 100%.
- [ ] `rebaseIstat` implemented and tested (base present, base missing,
      base value 0).
- [ ] `data/istat-nic.json` committed in the §8.1 format with real fetched
      data; `scripts/update-istat.ts` follows the §8.2 contract (fail loudly,
      replace-not-merge, atomic write).
- [ ] `package.json` gains the `istat:update` script row
      (`"istat:update": "tsx scripts/update-istat.ts"`), invoked as
      `pnpm istat:update`.
- [ ] Optional: `.github/workflows/update-istat.yml` added as in §8.4.
- [ ] `src/lib/services/inflation.ts` and the two repository projections
      exist as in §9.
- [ ] All comments follow `docs/COMMENTS.md` (the teacher comments of §1 and
      the why-comments of §4 appear in the code); naming follows
      `docs/DEVELOPMENT_GUIDELINES.md`.
- [ ] `pnpm biome check`, `pnpm tsc --noEmit`, and `pnpm vitest run` all pass.
- [ ] `CLAUDE.md` "Current status" updated; work committed with conventional
      commits.

---

## Implementation Prompt

```
You are implementing Spec 04 (Personal Inflation Engine) of the segnaprezzi
project, in this repository.

Before writing any code, read IN FULL, in this order:
1. AGENTS.md
2. CLAUDE.md
3. docs/specs/00-overview.md      (canonical contract — names, money rules)
4. docs/specs/04-inflation-engine.md   (the spec you are implementing)
5. docs/DEVELOPMENT_GUIDELINES.md (layers, naming, errors, testing)
6. docs/COMMENTS.md               (comment discipline — teacher/why comments
                                   from the spec must appear in the code)

Then implement Spec 04 fully:
- the pure engine in src/lib/inflation/ (types, bucketing, relatives,
  weights, chain, coverage, movers, istat, index barrel) — zero I/O,
  deterministic, no imports from db/ai/services/next/react;
- every unit test in the spec's §7 table, colocated *.test.ts, including the
  §6 worked-example acceptance fixture (reproduce every number to 4 decimals
  — if your output differs, your code is wrong, not the spec) and the
  constant-price property test;
- scripts/update-istat.ts per §8.2 plus the istat:update package.json script
  row ("tsx scripts/update-istat.ts", run as pnpm istat:update),
  data/istat-nic.json per §8.1 (fetch real data; if the ISTAT endpoint has
  moved, find the current SDMX flowRef and document it in a why-comment),
  and optionally the §8.4 workflow;
- the thin service src/lib/services/inflation.ts and the two repository
  projections per §9.

The engine's edge-case behavior is specified exhaustively in §5 — implement
exactly that, no improvisation. Where the spec decides something (clamp
bounds, promo fallback, imputation window anchoring), the decision is final.

When done: run pnpm biome check --write, pnpm tsc --noEmit, and
pnpm vitest run; fix everything until green. Commit with conventional
commits (feat/test/chore scopes, one logical change per commit). Finally,
update the "Current status" section of CLAUDE.md to record that Spec 04 is
implemented.
```

**Recommended model:** Claude Opus 5 (Fable 5 if available)
**Recommended effort:** xhigh

**Prerequisites:** Spec 01 (scaffold, tooling) and Spec 02 (database schema —
types and repositories; the engine itself consumes only the Spec 02 types).
