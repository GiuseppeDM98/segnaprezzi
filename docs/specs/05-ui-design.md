# Spec 05 — UI & Design System

> **Status**: Approved · **Last updated**: 2026-08-20
> **Depends on**: Specs 01–04 (scaffold, DB + auth, capture + extraction, inflation engine)
> **Contract**: `docs/specs/00-overview.md` is authoritative for all names and data shapes.
>
> **Division of authority.** This spec pins everything an implementer needs to build
> *correct and complete* screens: information architecture, layout blocks, exact data
> fields, all four states per screen (data / empty / loading / error), component
> contracts, motion inventory, accessibility bar, and copy rules. The **final visual
> language** — exact colors, type sizes, spacing values, radii, shadows, font choices —
> is decided at implementation time with the **impeccable** skill, which afterwards
> generates `DESIGN.md` (the authoritative design doc referenced by
> `docs/DEVELOPMENT_GUIDELINES.md`). On conflict: `DESIGN.md` wins on visual values;
> this spec wins on structure, states, and behavior.

---

## 1. Goal & Design Personality

**Goal**: people who open segnaprezzi should say **wow** — and the wow must come from
craft (hierarchy, typography, motion, polish), never from noise. No gradients-for-the-
sake-of-gradients, no decoration that competes with the data.

**Personality brief — "a precision instrument with Italian warmth."**

- The trustworthy clarity of a fintech app crossed with the warmth of a neighborhood
  market. Precise where it counts (numbers, alignment, spacing rhythm), human where it
  talks (copy, empty states, micro-delight).
- **Data-forward: numbers are the heroes.** The inflation percentage on the dashboard
  is the single most important element in the app. Charts and tables are content, not
  decoration. Chrome recedes; data advances.
- **Both light and dark themes are first-class.** Neither is a filter applied to the
  other; both must pass WCAG AA and both must be reviewed during the impeccable pass.
- Density: generous around the hero, compact in lists and tables. A price-tracking app
  lives on scannable rows.

**Brand seed** (impeccable may refine, keeping recognizability):

- Logo: `docs/assets/logo.svg` — a price tag rotated 45° with a punched hole and a
  rising white sparkline, fill `#EA580C`. Used on Login/Signup, PWA icons
  (`scripts/generate-icons.ts`), and the README. Not repeated inside app chrome.
- Accent seed: `#EA580C` (warm orange — market awnings, not alarm red). impeccable owns
  the final OKLCH value and the full palette derived from it.

---

## 2. Design Tokens Contract

### 2.1 Semantic color tokens — the only colors components may use

Spec 01 §8 creates `src/app/globals.css` with a Tailwind 4 `@theme` block defining
the **eleven frozen token names** below — that list is the canonical contract. Spec
01 ships them with reasonable placeholder values; this spec (via the impeccable
pass) replaces *values only* and may **add** tokens — it never renames or removes
the frozen eleven, so no component churn.

**Hardcoded hex/rgb/oklch values in components are forbidden.** The only files allowed
to contain literal color values are `src/app/globals.css` (the `@theme` block and its
`.dark` overrides) and `docs/assets/logo.svg`. Everything else uses the semantic
utilities Tailwind generates from these tokens (`bg-surface`, `text-accent`, …) or
`var(--color-*)` inside inline SVG.

**Frozen tokens** (Spec 01 §8 — names never change):

| Token | Role |
|---|---|
| `--color-background` | App/page background |
| `--color-surface` | Cards, sheets, tab bar |
| `--color-surface-raised` | Elevated surfaces (toasts, popped elements) |
| `--color-text` | Primary text |
| `--color-text-muted` | Secondary text (labels, dates, captions, hints) |
| `--color-accent` | Brand actions: FAB, primary buttons, active tab, chart hero series |
| `--color-accent-contrast` | Text/icons on accent |
| `--color-positive` | Favorable status: confirmations, sync complete, favorable price direction |
| `--color-negative` | Unfavorable status: destructive actions, failures, unfavorable price direction |
| `--color-warning` | needsReview flags, thin-data notices |
| `--color-border` | Hairline separators, card and input borders |

**Tokens this spec adds** (additions are allowed; renames are not):

| Token | Role |
|---|---|
| `--color-accent-soft` | Accent-tinted backgrounds (active chips, derived-value pulse) |
| `--color-positive-soft` / `--color-negative-soft` / `--color-warning-soft` | Soft-tinted backgrounds for the matching status (chips, highlights, the offline pill) |
| `--color-overlay` | Scrim behind sheets/dialogs |
| `--color-promo` | Promo markers (chart dots, promo chips) |
| `--color-chart-compare` | ISTAT overlay series (neutral, recedes behind accent) |
| `--color-chart-grid` | Chart gridlines and axes |
| `--color-focus` | Focus-visible ring |

> **Price direction reuses `positive` / `negative`**: this is an inflation tracker —
> the domain semantics are *inverted* relative to finance apps: a rising price is
> unfavorable for the user, a falling price is favorable. The tokens stay
> `positive`/`negative`; the impeccable pass decides the exact rendering mapping
> (e.g. whether a rising price renders in the `negative` family) and records it in
> `DESIGN.md`. `TrendBadge`, `CategoryBars`, and top-movers rows express price
> direction through these two tokens only.

Theming follows Spec 01's mechanism exactly: light values live on `:root`; dark
overrides live under a `.dark` class on `<html>`, driven by a `theme` cookie
(values `dark` | `light`; cookie absent = follow the OS, applied by Spec 01's
pre-paint inline script in the root layout, so there is no flash). There are **no
`data-theme` attributes and no `prefers-color-scheme` CSS block**. The Settings
theme control offers **System / Light / Dark** (System clears the cookie).

### 2.2 Number display rules

1. **`tabular-nums` everywhere data appears** — every element rendering money,
   percentages, index values, or quantities carries the Tailwind `tabular-nums`
   utility (hero, badges, table cells, chart labels, tickers). Whatever typeface
   impeccable picks for data **must support tabular figures**. Digits in columns and
   tickers never shift horizontally.
2. **Money never leaves integer space until formatting.** UI code receives
   `total_price_cents` (integer cents) and `unit_price_milli` (integer milli-euros)
   and passes them to `src/lib/format.ts`. No component does money arithmetic in
   floats, ever.
3. **Locale formatting is centralized.** `format.ts` is the only module that calls
   `Intl.NumberFormat` for money, percentages, and index values. App locales map to
   Intl locales: `it` → `it-IT`, `en` → `en-US`.
4. **Currency is always €** (v1 is EUR-only per Spec 00).
5. **Percentages are always signed**: `+4,2%` / `−1,3%` (it), `+4.2%` / `−1.3%` (en).
   Negative numbers use the true minus sign U+2212, not a hyphen.

### 2.3 `src/lib/format.ts` — API

Pure module, colocated unit tests (`format.test.ts`). Integer money helpers
(`calculateUnitPriceMilli`, `toCents`, `toMilli`, `centsToMilli`) live in
`src/lib/domain/money.ts`, created by Spec 02 §4.1; `format.ts` imports the
conversions and owns only string rendering and input parsing — it is the app's
**only** `Intl.NumberFormat` call site.

```ts
// Design: this module is the single boundary between integer money
// (total_price_cents, unit_price_milli) and human-readable strings.
// No other module may call Intl.NumberFormat for money, percentages,
// or index values — one place to fix locale bugs, one place to test them.

import type { UnitKind } from '@/lib/domain/units'

export type AppLocale = 'it' | 'en'

/** Format euro cents as currency: 249 → "2,49 €" (it) / "€2.49" (en). */
export function formatMoney(cents: number, locale: AppLocale): string

/**
 * Format a unit price in milli-euros per base unit: 2340 → "2,34 €/kg".
 * Renders 2 decimals, or 3 when the value is not a whole number of cents
 * (fuel: 1799 → "1,799 €/L"). Unit symbols: /kg, /L, /pz (it) · /pc (en).
 */
export function formatUnitPrice(
  milli: number,
  unitKind: UnitKind,
  locale: AppLocale,
): string

/**
 * Format a ratio as a signed percentage: 0.042 → "+4,2%" (it) / "+4.2%" (en).
 * Always signed; negatives use U+2212; exactly zero renders unsigned ("0,0%").
 * `decimals` defaults to 1.
 */
export function formatPct(
  ratio: number,
  locale: AppLocale,
  options?: { decimals?: number },
): string

/** Format a chained index value: 104.23 → "104,2" (it) / "104.2" (en). */
export function formatIndexValue(value: number, locale: AppLocale): string

/**
 * Format a package size in base units, choosing the friendliest sub-unit:
 * weight 0.5 → "500 g", 1.5 → "1,5 kg" · volume 0.33 → "330 mL", 38.2 → "38,2 L"
 * · count 6 → "6 pz" (it) / "6 pc" (en).
 */
export function formatPackageSize(
  size: number,
  unitKind: UnitKind,
  locale: AppLocale,
): string

/**
 * Parse a user-typed decimal ("2,49", "2.49", "2,49 €") into a number.
 * Accepts both comma and dot regardless of locale — Italian users on English
 * keyboards type dots. Returns null when the input is not a number.
 */
export function parseDecimalInput(raw: string): number | null
```

`NumberTicker` (and every other display component) receives **pre-formatted strings**
from these functions — animation components never format numbers themselves.

---

## 3. Typography & Layout Direction

impeccable owns exact sizes, faces, and weights (recorded in `DESIGN.md`). This spec
pins the *roles* and the *shape* of the scale:

| Role | Used for | Direction |
|---|---|---|
| **Display** | The hero inflation number on the Dashboard | Very large, confident — the largest text in the app by a wide margin; tabular figures |
| **Title** | Screen titles, card headings | Clear step down from Display |
| **Body** | Copy, form labels, list primary text | Comfortable at data density |
| **Caption** | Dates, hints, coverage line, axis labels | Small but AA-legible, `--color-text-muted` |
| **Data** | Prices, percentages, table cells | `tabular-nums`; may be a distinct face (mono or tabular sans — impeccable decides) |

The contrast between the huge hero number and compact data-dense rows *is* the visual
signature. Everything between those two extremes should be quiet.

**Layout rules**

- **Mobile-first at 390 px**, single column. Every screen must be complete and
  beautiful at 390 × 844 before any wider layout is considered.
- **≥ 768 px (`tablet:`)**: the Dashboard becomes two-column (hero + trend chart in
  the wide column, category breakdown + top movers in the narrow one, in the spirit of
  `grid-cols-[2fr_1fr]`); other screens center at a comfortable max width.
- **≥ 1024 px (`rail:`)**: navigation switches from bottom tab bar to a left rail
  (§4). `DESIGN.md` may add a wider `desktop:` variant (e.g. 1440 px) for large-screen
  refinements.
- Breakpoints are exposed as **named variants** in the `@theme` block (`tablet:`,
  `rail:`, `desktop:`); raw `md:`/`lg:` are not used for layout decisions — named
  variants keep intent readable (per `DEVELOPMENT_GUIDELINES.md` design section).
- **Safe-area insets** (PWA standalone): the app shell applies
  `env(safe-area-inset-*)` — tab bar height includes the bottom inset, headers respect
  the top inset, and the camera view extends full-bleed *behind* the insets while its
  controls stay inside them.
- Wide content (tables, charts) scrolls inside its own container; the page never
  scrolls horizontally.

---

## 4. Navigation Shell

**Mobile (< 1024 px): bottom tab bar**, component `ui/TabBar` + `ui/Fab`, rendered by
`layout/AppShell` for every route in the `(app)` group (never on `/login`, `/signup`,
and hidden on `/scan`, which is immersive full-screen).

| Slot | Route | Icon (lucide) | Label (it / en) |
|---|---|---|---|
| 1 | `/` | `house` | Home / Home |
| 2 | `/products` | `tag` | Prodotti / Products |
| 3 (center, raised) | `/scan` | `camera` | Scansiona / Scan |
| 4 | `/history` | `history` | Cronologia / History |
| 5 | `/settings` | `settings-2` | Impostazioni / Settings |

- Icons + labels always (no icon-only tabs). Icon set: **lucide-react** — a
  dependency **this spec introduces** (listed in Spec 00 §4); impeccable may adjust
  stroke width/size but not swap the library.
- **Active state**: accent-colored icon + label; inactive tabs use
  `--color-text-muted`.
- **Hide on scroll**: in long scrollable lists (Products, History, Product detail
  entries) the bar translates down on scroll-down and returns on scroll-up (house
  spring, §7). It never hides on Dashboard or Settings.
- **The Scan FAB is the signature element**: a raised circular accent button breaking
  the bar's top edge, larger than the tabs. Tapping it **morphs into the camera view**
  (shared-element transition, §7). It is the one persistent piece of brand color in
  the chrome.

**Desktop (≥ 1024 px): left rail** — same five destinations, vertical, logo mark at
top, Scan rendered as a prominent accent button in the rail. Content area centers
with a max width. The rail never hides.

`/add/manual`, `/add/fuel`, `/scan/review`, `/products/[id]`, and `/stores` are
sub-screens: they keep the shell (except `/scan`) and get a `layout/ScreenHeader` with
a back button. `/stores` is reached from Settings and from store pickers.

---

## 5. Screens

Every screen must implement **all four states**: data, empty, loading, error.

- **Loading**: `ui/Skeleton` blocks mirroring the final layout — **never spinners for
  content**. The only spinner allowed in the app is the small inline pending indicator
  inside a `Button`/`IconButton`.
- **Error**: `ui/EmptyState` with `tone="error"` — plain-language message + a retry
  action (§9 copy rules).
- **i18n**: every string comes from `messages/it.json` / `messages/en.json` via
  next-intl; the namespace per screen is listed below. Shared strings live in
  `common` (actions: save, cancel, confirm, retry, delete…), `nav` (tab labels),
  `categories` (taxonomy labels), `units`, `errors`, `offline`.

### 5.1 `/` — Dashboard

**Purpose**: answer "what is *my* inflation?" in one glance, honestly, and invite the
next capture.

**Layout blocks (in order)**

1. **Hero**: label ("La tua inflazione" / "Your inflation") · the headline percentage
   as a huge `NumberTicker` (Display role) · `TrendBadge`-style coloring on the number
   itself (`positive`/`negative` per the §2.1 price-direction mapping, neutral at
   zero).
   - Headline metric: **YoY %** when ≥ 13 months of data exist; otherwise
     **since-start %** with the label "Da quando registri" / "Since you started".
   - Secondary stat chips under the hero: MoM %, since-start % (or YoY when it is the
     hero's fallback partner), and the index value (`formatIndexValue`, caption "Indice ·
     base 100 = {baseMonth}").
2. **Coverage honesty line** (Caption, `--color-text-muted`): "Basato su N prodotti in M
   categorie" / "Based on N products in M categories"; when the engine's coverage
   stats report `imputedShare > 0`, append "· X% stimato" / "· X% estimated".
   This line is **mandatory** — the app never shows a headline number without its
   coverage.
3. **Trend chart**: `charts/AreaChart` of the last 12 months of the chained personal
   index (`{ month, value }`), with an **ISTAT overlay toggle** (a `Chip` labeled
   "ISTAT"). The overlay plots `data/istat-nic.json` **rebased to the user's base
   month = 100** so the two lines are comparable; it renders in
   `--color-chart-compare`, visually behind the accent series. Toggle state persists
   per device (localStorage).
4. **Category breakdown**: `charts/CategoryBars` — one row per category with data:
   i18n label · signed % (`formatPct`, same horizon as the hero) · horizontal bar
   proportional to |%|, colored `positive`/`negative` per the §2.1 price-direction
   mapping. Sorted by % descending.
5. **Top movers**: the 5 products with the largest |unit-price % change| over the
   trailing 12 months (≥ 2 observed months required). Row: product name (+ brand,
   muted) · `charts/Sparkline` of monthly unit prices · `TrendBadge`. Tap →
   `/products/[id]`.
6. **Quick actions**: two `Button`s — "Aggiungi a mano" → `/add/manual`,
   "Carburante" → `/add/fuel`. (Scan is the FAB.)

**Data displayed**: headline ratios + index series + coverage stats + per-category
relatives + top movers, all produced by the inflation engine (Spec 04); every number
rendered through `format.ts`.

**Interactions**: ISTAT toggle · tap mover → product detail · quick actions ·
pull-to-refresh recomputes (PWA standalone).

**Empty state (first run — the app's front door)**: friendly, explains the
personal-CPI concept in two sentences ("L'inflazione ufficiale è calcolata su un
carrello medio che non è il tuo. Fotografa i segnaprezzi mentre fai la spesa e
segnaprezzi calcola la *tua* inflazione."), shows the logo mark, and a **big primary
CTA "Fotografa il primo segnaprezzi"** → `/scan`, secondary ghost "Oppure inserisci a
mano" → `/add/manual`.

**Thin-data state** (entries exist but < 2 monthly buckets, so no index yet): show
what *is* known — entry count, product count, total spent — plus "Il tuo indice
arriva con il secondo mese di rilevazioni" and the chart area replaced by an
explanatory placeholder. Never fake a chart.

**Loading**: skeletons for hero number, chart block, 4 bar rows, 3 mover rows.
**Error**: EmptyState tone error, "Non riesco a calcolare l'indice" + retry.
**i18n**: `dashboard`.

### 5.2 `/scan` — Capture

**Purpose**: photograph price tags fast, with zero friction, online or offline.
Immersive full-screen (no tab bar, no header chrome).

**Layout blocks**

1. **Viewfinder**: full-bleed `capture/CameraView` (rear camera). Overlay: a rounded-
   rect **framing guide** with corner marks sized for a shelf tag + hint caption
   "Inquadra il cartellino" (fades out after the first capture of the session).
2. **Top overlay row** (inside safe area): close (X, exits to `/`, session stays
   `active`) · store chip (current session's store name, or "Scegli negozio" — opens
   a store-picker `Sheet` with search + inline create; skippable, `store_id` NULL) ·
   torch toggle when the device supports it.
3. **Shutter**: large circular button, bottom center, above the tray. Capture feedback:
   screen-edge flash + thumbnail flies into the tray.
4. **Photo tray**: `capture/PhotoTray`, horizontal strip of the session's captures,
   each with a **queue status chip** mapping exactly the four queue statuses:
   In coda / Caricamento / Pronto / Errore (queued · uploading · extracted ·
   failed) — there is no separate 'extracting' state. Failed chips expose retry
   on tap.
5. **Review CTA**: "Controlla (N)" button, enabled when N ≥ 1 → `/scan/review`
   (session → `reviewing`).

**Data**: active `shopping_sessions` row (status, store), queued photos with per-photo
pipeline status (from `src/lib/offline/photo-queue.ts` — Spec 03 owns the queue,
Spec 06 the sync engine; this screen renders its states).

**Interactions**: shutter · pick store · retry failed · tap thumbnail → preview sheet
with "Elimina foto" · review CTA · close.

**Empty state**: the viewfinder itself (guide + hint). **Camera permission denied**:
explanatory EmptyState ("Serve la fotocamera per leggere i cartellini…") with a hint
to enable it in browser settings and a fallback "Carica una foto" file input
(`capture` attribute) so the flow still works.
**Loading**: skeleton only while the camera stream initializes (dark placeholder,
no spinner). **Error** (camera hardware failure): same fallback as permission denied.
**Offline**: capture works fully; chips stay "In coda"; the global offline pill (§5.13)
explains — never a blocking modal.
**i18n**: `scan`.

### 5.3 `/scan/review` — Review & Confirm

**Purpose**: turn AI extractions into confirmed `price_entries` — fast to skim,
honest about uncertainty. Nothing touches the DB until batch confirm (Spec 00 §8).

**Layout blocks**

1. `ScreenHeader`: "Controlla la spesa" + store name/date caption · filter chip
   "Da controllare (N)" when N > 0.
2. **Extraction cards** (`capture/ExtractionCard`), one per photo, capture order,
   stagger-in on mount (§7). Each card:
   - photo thumbnail (tap → full-size preview sheet);
   - **editable fields**: `productName` (text) · `brand` (text) · `category`
     (select, taxonomy) · `unitKind` (segmented weight/volume/count) ·
     `totalPriceCents` (money input) · `packageSize` (decimal + unit suffix) ·
     `unitPriceMilli` (money input, 3 decimals allowed) · `isPromo` (toggle) →
     `promoKind` chips (discount / loyalty / coupon / bundle);
   - **match row**: opens `capture/MatchPicker` (bottom sheet) with the top-3 catalog
     suggestions from Spec 03 matching + search + "Crea nuovo prodotto" (prefilled
     from extraction). Card shows the chosen product or "Nuovo: {name}".
   - **needsReview highlight**: warning-soft left border + "Da controllare" chip when
     `ai_confidence < 0.7` or any required field is missing/invalid. (If Spec 03 pins
     a different threshold, that value wins.)
   - overflow action: "Scarta" (discard card, with undo toast).
3. **Batch confirm bar**: sticky above the safe-area bottom: "Conferma N rilevazioni"
   + running total (`formatMoney` of the sum). Disabled while any non-discarded card
   is invalid (the bar says why: "2 da completare"). Confirm → success checkmark draw
   (§7) → session `completed` → navigate to `/` with toast "Spesa salvata".

**Data**: per-card extraction payload (Spec 00 §8 fields) + match suggestions +
`ai_confidence`. Raw confidence numbers are not displayed — the flag chip is the UX;
`ai_raw_json` stays debug-only.

**Empty state**: no photos in session → EmptyState "Nessuna foto da controllare" +
CTA back to `/scan`. **Loading**: skeleton cards while extractions are pending
(thumbnail + shimmering field rows); cards resolve individually as results arrive.
**Error** (per-card extraction failure): the card keeps the photo, fields empty and
editable, chip "Lettura fallita" + retry — manual completion always possible.
**i18n**: `review`.

### 5.4 `/add/manual` — Manual Entry

**Purpose**: record any price without a photo, in under 30 seconds.

**Layout blocks**

1. `ScreenHeader` "Aggiungi prezzo".
2. **Product picker**: search field over the user's catalog (name + brand,
   `is_archived = 0`); no match → inline "Crea {query}" expanding name / brand /
   category / unitKind fields.
3. **Price group**: `totalPriceCents` money input (autofocus after product chosen) ·
   `packageSize` with unit suffix from the product's `unit_kind` ·
   `unitPriceMilli` **auto-computed live** from total ÷ size, shown with a
   "calcolato" caption; editable — the shelf tag sometimes disagrees with the math,
   and the tag wins, so an edited value sticks and drops the caption.
4. **Details group**: `isPromo` toggle → `promoKind` chips · store select (optional,
   + inline create) · date-time picker defaulting to now (Europe/Rome).
5. **Save bar**: primary "Salva" (pending state on the button) · "Fatto" back action.

On save (`source: 'manual'`): success toast "Aggiunto ✓", form resets keeping store +
date — optimized for entering several prices in a row.

**Data**: products (search), stores, form draft. **Empty state**: none (the form is
the state); the product search's "no results" row is the create affordance.
**Loading**: skeleton for the product search results only. **Error**: inline field
errors (Zod, §8); save failure → toast tone error "Non salvato. Riprova." (input
preserved). **i18n**: `addManual`.

### 5.5 `/add/fuel` — Fuel Quick Form

**Purpose**: log a fill-up at the pump in seconds, one-handed.

**Layout blocks**

1. `ScreenHeader` "Carburante".
2. **Fuel product chips**: Benzina 95 / Diesel / GPL — exactly three, no free-name
   chip in v1. Chips create the product on first use (`category: 'fuel'`,
   `unit_kind: 'volume'`) with the **canonical stored names** 'Benzina 95',
   'Diesel', 'GPL' — the identity keys for get-or-create. Chip labels may localize
   via `addFuel.products.*` keys, but the stored product name is always canonical.
3. **Station select**: stores with `kind = 'fuel_station'` (+ inline create).
4. **Big numeric inputs** — the heart of the screen, keypad-friendly
   (`inputmode="decimal"`, Data role type, large targets):
   - "€/L" → `unit_price_milli` (3 decimals, e.g. 1,799)
   - "Totale €" → `total_price_cents`
   - "Litri" → `package_size`
   **Two-of-three live computation**: the two most recently edited fields are the
   inputs; the third derives live, marked with a "calcolato" caption and a subtle
   value-change highlight. Editing the derived field promotes it to input and demotes
   the oldest.
5. **Details**: date picker (default now), de-emphasized. No promo toggle in v1.
6. **Save bar**: "Salva" → toast → back to `/`.

Saved entry: `source: 'fuel'`, volume in liters, never a promo (v1).
**Empty/loading/error**: as §5.4. **i18n**: `addFuel`.

### 5.6 `/products` — Catalog

**Purpose**: browse, search, and curate the personal product catalog; merge
duplicates.

**Layout blocks**

1. Search field (debounced, matches `name` + `brand`).
2. **Category filter chips**: horizontal scroll, all taxonomy categories with data +
   "Tutti"; single-select. Trailing "Archiviati" chip toggles archived visibility.
3. **Product list** (compact `divide-y` rows, tab bar hides on scroll): name (+
   brand, muted) · category chip · right column: last `formatUnitPrice` + relative
   date (Caption) + `TrendBadge` vs the previous entry. Tap → `/products/[id]`.
4. **Merge mode**: a "Seleziona" header action enters selection mode (checkboxes).
   With ≥ 2 selected, a bottom bar shows "Unisci (N)". Flow: `Sheet` listing the
   selected products with a radio for the **surviving** product → explanatory copy
   "Le rilevazioni degli altri prodotti passeranno a {survivor}. L'indice verrà
   ricalcolato." → confirm (danger-styled, it is irreversible) → toast "Prodotti
   uniti". Merge is first-class (Spec 00 §8): entries move, index recomputes.

**Data**: products (name, brand, category, unit_kind, is_archived) + last entry per
product (unit_price_milli, recorded_at) + previous for the badge.
**Empty state**: "Nessun prodotto ancora. I prodotti nascono dalle tue foto." + CTA
to `/scan`; searching with no hits → "Niente per '{query}'".
**Loading**: 8 skeleton rows. **Error**: EmptyState + retry. **i18n**: `products`.

### 5.7 `/products/[id]` — Product Detail

**Purpose**: the price story of one product.

**Layout blocks**

1. `ScreenHeader`: product name · brand + category chip + unit kind (Caption).
   Overflow menu: "Modifica" (rename / brand / category via Sheet) · "Archivia" /
   "Ripristina".
2. **Price history chart**: `charts/AreaChart` (line + soft area) of monthly mean
   `unit_price_milli` over time; **promo entries render as dots** in `--color-promo`
   on the line; y-axis via `formatUnitPrice`. Range toggle chips: "12 mesi" (default)
   / "Tutto".
3. **Stats row** (4 tiles, Data role, computed over all entries):
   Min · Max · Media · Ultimo — each `formatUnitPrice` + date caption for min/max/last.
4. **Per-store comparison** (when ≥ 2 stores have entries): row per store: name ·
   latest `formatUnitPrice` · date. Sorted cheapest first; the cheapest row gets a
   "Migliore" chip in `positive-soft` (a falling price is favorable, §2.1).
5. **Entries list**: newest first: date · store (muted) · `formatMoney` total ·
   `formatPackageSize` · `formatUnitPrice` · promo chip when `is_promo` · source icon
   (camera / pencil / fuel-pump for photo / manual / fuel). Tap → entry sheet with
   full fields + "Modifica" / "Elimina" (confirm; index recomputes).

**Empty state**: product with zero entries → stats/charts replaced by "Nessuna
rilevazione ancora" + CTA `/scan`. **Loading**: skeleton chart + 4 stat tiles + rows.
**Error**: EmptyState + retry. **i18n**: `productDetail`.

### 5.8 `/history` — Timeline

**Purpose**: everything recorded, newest first, scannable and filterable.

**Layout blocks**

1. **Filter row**: chips for category · store · "Solo promo" · source; the first two
   open picker Sheets. Active filters render as removable chips.
2. **Timeline** grouped by **day** (Europe/Rome; headers "Oggi", "Ieri", then full
   date). Inside a day, entries from the same shopping session group under a
   **session card**: store name + time + **session total** (`formatMoney` sum of the
   session's `total_price_cents`). Standalone entries render as plain rows.
3. **Rows**: product name · `formatMoney` total · `formatUnitPrice` (muted) · promo
   chip · source icon. Tap → entry sheet (view / edit / delete, as §5.7).
4. Cursor pagination on `(user_id, recorded_at)`; infinite scroll with a skeleton
   sentinel row. Tab bar hides on scroll.

**Empty state**: "La tua cronologia è vuota" + CTA `/scan`; filtered-empty says which
filter to loosen. **Loading**: 2 day-groups of skeleton rows. **Error**: EmptyState +
retry. **i18n**: `history`.

### 5.9 `/stores` — Stores

**Purpose**: manage the places prices come from. Reached from Settings and from
store pickers ("Gestisci negozi").

**Layout blocks**

1. `ScreenHeader` "Negozi" + add action (Sheet form: name · chain · city · kind
   segmented Supermercato / Distributore / Altro).
2. **List rows**: kind icon (`shopping-cart` / `fuel` / `store`) · name · chain +
   city (muted) · entry count. Tap → edit Sheet; delete inside it with confirm copy
   "Le rilevazioni restano, ma senza negozio" (entries' `store_id` becomes NULL).

**Empty state**: "Nessun negozio. I negozi rendono confrontabili i prezzi tra
supermercati." + add CTA. **Loading**: 4 skeleton rows. **Error**: EmptyState +
retry. **i18n**: `stores`.

### 5.10 `/settings` — Settings

**Purpose**: account, preferences, data — with plain-language explanations for every
index option. Grouped sections in cards:

1. **Account**: email (read-only) · "Esci" · "Elimina account" (danger, double-confirm
   Sheet spelling out that all data is deleted).
2. **Indice** (writes `user_settings`, both changes trigger recompute — caption
   "L'indice verrà ricalcolato"):
   - `include_promos_in_index` Toggle — label "Includi le promozioni", explanation:
     "Se un prodotto era in offerta, nel tuo indice entra il prezzo scontato: è quello
     che hai pagato davvero." (default on)
   - `carry_forward_months` stepper 0–6, default 2 — label "Riporto prezzi",
     explanation: "Se in un mese non compri un prodotto, uso l'ultimo prezzo noto per
     al massimo N mesi. 0 per disattivare." Value renders "2 mesi" / "Disattivato".
3. **Preferenze**: Language segmented IT / EN (switches the `[locale]` segment) ·
   Theme segmented Sistema / Chiaro / Scuro (§2.1).
4. **Dati**:
   - "Esporta i tuoi dati" → downloads the JSON from `/api/export` (button pending
     state while preparing).
   - "Importa un backup" → file picker accepting a previous segnaprezzi export →
     server action validates with Zod and upserts by id (merge, not wipe) → progress
     state on the row → toast with imported counts. Malformed file → error toast
     "File non valido. Serve un export di segnaprezzi."
5. **Info**: app version · "Open source, licenza MIT" → GitHub repo link · credits
   line.

**Data**: `users.email`, `user_settings` fields, app version. **Empty**: n/a.
**Loading**: skeleton rows per section. **Error**: per-row toast on failed save;
optimistic toggles roll back. **i18n**: `settings`.

### 5.11 `/login` · `/signup` — Auth

**Purpose**: minimal, calm entry. No app shell; centered column; logo mark on top.

- **One-field-at-a-time feel** via progressive disclosure in a single form: `/login`
  shows email; the password field slides in (house spring) once the email is valid,
  focus advances automatically. `/signup`: name → email → password with the same
  rhythm. Standard autofill/password managers must keep working (it is one real form,
  fields are revealed, never separate steps).
- Password field has a show/hide `IconButton`. Submit button carries the pending
  state.
- Errors inline under the field ("Password errata. Riprova o controlla l'email.") —
  never a generic banner.
- Cross-links: "Non hai un account? Registrati" / "Hai già un account? Accedi".
  When `SIGNUP_ENABLED=false` (server-checked): `/signup` shows "Le registrazioni
  sono chiuse su questa istanza." and the login page hides the signup link.

**Loading**: none (static form). **Error**: inline + toast for network failures.
**i18n**: `auth`.

### 5.12 Not-found & route errors

Locale-aware `not-found.tsx` and `error.tsx` in the `(app)` group reuse
`EmptyState`: friendly copy, CTA to `/`. No bespoke illustration work beyond the
logo mark. **i18n**: `errors`.

### 5.13 Global offline pattern

Offline is a first-class state, never an error (Spec 00: supermarkets have terrible
connectivity).

- `layout/OfflineBanner`: a slim pill sliding from under the top safe-area when
  connectivity drops: "Sei offline — le foto restano sul telefono" (+ queued count
  when > 0). Persistent while offline, `warning-soft` background, never blocks
  interaction.
- On reconnect: pill switches to "Sincronizzo… N in coda", then a success toast
  "Tutto sincronizzato" and the pill slides away.
- Capture (§5.2) works fully offline. Actions that *require* network (extraction
  retry, export, import, auth) disable with a caption "Serve la connessione" — they
  never fail silently.
- Queue mechanics belong to Spec 06; this spec owns the presentation contract above.
- Spec 06's sync engine drives **this exact component** (`layout/OfflineBanner`) and
  **this exact key set** (`offline.*`) — no separate connectivity chip, no duplicate
  key set.

**i18n**: `offline`.

---

## 6. Component Inventory (`src/components/`)

### 6.1 `ui/` — primitives

| Component | Contract | Key props |
|---|---|---|
| `Button` | The only action trigger; owns the app's sole spinner (inline pending) | `variant: 'primary'\|'secondary'\|'ghost'\|'danger'` · `size: 'md'\|'lg'` · `isPending` · `icon?` |
| `IconButton` | Icon-only action; accessible name is mandatory | `icon` · `label` (aria-label, required) · `variant` · `size` |
| `Card` | Surface container; no card-within-card nesting | `isInteractive?` · `padding: 'none'\|'compact'\|'default'` |
| `Sheet` | Bottom sheet (drag handle, scrim, drag-to-dismiss); renders as a centered dialog ≥ 768 px; traps focus, Esc closes | `isOpen` · `onClose` · `title?` · `children` |
| `Field` | Label + control + hint + error wrapper; wires `aria-describedby` | `label` · `hint?` · `error?` · `isRequired?` |
| `Input` | Text/decimal input; money mode right-aligns, sets `inputmode="decimal"`, `tabular-nums` | `prefix?`/`suffix?` (€, /kg) · `inputMode?` · standard input props |
| `Select` | Styled native `<select>` (best mobile ergonomics) | `options: { value; label }[]` · `value` · `onChange` |
| `Toggle` | Switch for booleans | `isChecked` · `onChange` · `label` |
| `Chip` | Compact filter/status pill | `variant: 'filter'\|'status'` · `isSelected?` · `icon?` · `onRemove?` |
| `Toast` | Provider + `useToast()`; stacks above the tab bar; auto-dismiss 4 s; optional action (Undo) | `toast({ kind: 'success'\|'error'\|'info', message, action? })` |
| `Skeleton` | Loading placeholder; must match final layout dimensions (no shift) | `shape: 'text'\|'block'\|'circle'` · `width?` · `height?` |
| `EmptyState` | Empty/error surface: icon or logo mark, title, body, CTA | `title` · `body?` · `action?` · `secondaryAction?` · `tone: 'default'\|'error'` |
| `TabBar` | Bottom navigation (§4); hide-on-scroll via shell-provided scroll context | `items` (fixed five) · active derived from route |
| `Fab` | Raised central Scan button; carries the shared `layoutId` for the camera morph | `onPress` · `label` |

### 6.2 `charts/` — hand-rolled SVG

```
Design: charts are hand-rolled SVG — no chart library. Two reasons:
(1) bundle size: the app is a mobile PWA and every charting dependency
costs hundreds of KB for features we don't use; (2) full visual control:
the impeccable pass tunes every pixel, which wrapper libraries fight.
Tradeoff accepted: we implement scales, paths, and animation ourselves,
so chart components get their own unit tests for path/scale math.
```

Shared rules: colors only via `var(--color-*)` (`accent` for the personal series,
`chart-compare` for ISTAT, `chart-grid` for grid, `promo` for dots); `tabular-nums`
labels via `format.ts`; responsive via `viewBox` + container width.

**Accessibility**: every chart renders `role="img"` with a generated `aria-label`
summary sentence ("Indice personale, ultimi 12 mesi: da 100 a 104,2, +4,2%") **and**
a visually hidden (`sr-only`) `<table>` of the underlying values as fallback.
Exception: `Sparkline` inside list rows is `aria-hidden` — the adjacent
`TrendBadge` text already carries the information.

| Component | Contract | Key props |
|---|---|---|
| `Sparkline` | Tiny inline trend line, no axes | `points: number[]` · `trend?: 'up'\|'down'\|'flat'` (stroke color) · `width?`/`height?` |
| `AreaChart` | Monthly line + soft gradient area; optional comparison series; draw-in on mount only (§7); month x-labels, sparse y-ticks | `series: { month: string; value: number }[]` · `compareSeries?` · `formatValue: (v: number) => string` · `ariaSummary` |
| `CategoryBars` | Horizontal signed bars from a zero baseline, label + pct per row | `items: { category: Category; ratio: number }[]` · `formatValue` |
| `TrendBadge` | Signed % pill with direction arrow; `positive`/`negative` per the §2.1 price-direction mapping, neutral at zero | `ratio: number` · `size: 'sm'\|'md'` |
| `NumberTicker` | Animated rolling number; receives a **pre-formatted string**, animates digit slots, non-digits static; width-stable via `tabular-nums` | `value: string` · `ariaLive?: 'polite'` |

### 6.3 `capture/` — camera & review

| Component | Contract | Key props |
|---|---|---|
| `CameraView` | Full-bleed `getUserMedia` viewfinder (rear camera); framing guide overlay; owns permission/failure states and the file-input fallback | `onCapture(blob: Blob)` · `onClose` · `isTorchAvailable`/`onToggleTorch` |
| `PhotoTray` | Horizontal capture strip with per-photo status chips (§5.2 statuses) | `photos: { id; thumbUrl; status }[]` · `onSelect(id)` · `onRetry(id)` |
| `ExtractionCard` | One editable review card (§5.3): thumbnail, fields, match row, needsReview flag | `draft` (extraction fields) · `match` · `isFlagged` · `onChange` · `onOpenMatch` · `onDiscard` |
| `MatchPicker` | Sheet: top-3 suggestions + catalog search + "create new" prefilled | `suggestions: { product; score }[]` · `onPick(productId \| 'new')` |

### 6.4 `layout/` — shell

| Component | Contract |
|---|---|
| `AppShell` | Safe-area padding, TabBar/rail slot, OfflineBanner, Toast outlet, scroll-direction context for hide-on-scroll |
| `ScreenHeader` | Back button + title + optional actions for sub-screens |
| `OfflineBanner` | Connectivity pill (§5.13) |

---

## 7. Motion System

Library: **Motion** (`motion` package). **House physics** (per
`DEVELOPMENT_GUIDELINES.md` design section): spring, **stiffness 400, damping 35** —
exported once from `src/lib/motion.ts` as `houseSpring`, alongside
`quickFade` (opacity tween, 150 ms). Components import these; ad-hoc spring values
are forbidden. Motion is polish, not spectacle: nothing loops, nothing autoplays
after load, nothing animates on scroll except the tab bar.

### Motion inventory

| Animation | Trigger | Behavior | Reduced-motion behavior |
|---|---|---|---|
| NumberTicker digit roll | Dashboard load / headline value change | Digits roll vertically into place with `houseSpring`, slight per-digit stagger | Final value renders instantly |
| **FAB → camera morph** (signature) | Tap Scan FAB | Shared-element morph (`layoutId`): the accent circle expands into the full-screen viewfinder; controls fade in after | 150 ms cross-fade, no morph |
| Extraction cards stagger-in | `/scan/review` mount | Cards enter with y-offset + opacity, `houseSpring`, **30 ms stagger** | Opacity-only, no stagger |
| Tab cross-fade | Tab switch | **150 ms** opacity cross-fade between screens (no slide) | Kept (≤ 150 ms opacity is non-vestibular) |
| Confirm success checkmark | Batch confirm succeeds | SVG stroke draw (~400 ms) + `houseSpring` pop, then navigate | Static checkmark, brief pause, navigate |
| Chart draw-in | `AreaChart` **mount only** | Line draws left→right, area fades up; ISTAT overlay toggle fades the overlay only — never re-draws the chart | Chart renders complete |
| Sheet open/close | Any Sheet | Slide up with `houseSpring`, scrim fade; drag-to-dismiss follows the finger | Opacity fade only |
| Tab bar hide/show | Scroll direction in lists | Translate with `houseSpring` | Instant show/hide |
| Toast in/out | `useToast` | Slide + fade above tab bar | Fade only |
| Pressed state | Any Button/Fab/interactive Card | Scale 0.97 via `whileTap` | None |
| Derived-value highlight | Two-of-three fuel computation, unit-price auto-compute | Brief `accent-soft` background pulse on the recomputed field | Kept (color-only, no movement) |

### `prefers-reduced-motion`

A single `useAppMotion()` hook (in `src/lib/motion.ts`, wrapping the library's
`useReducedMotion`) is the one place components ask. When reduced motion is on,
**all non-essential motion is disabled**. What remains:

- opacity fades ≤ 150 ms (tab cross-fade, sheet scrim, toasts);
- color-only feedback (derived-value pulse, active states);
- focus-visible transitions;
- everything else renders in its final state instantly.

---

## 8. Accessibility & Quality Bar

Non-negotiable; verified in the Definition of Done (§10).

- **Contrast**: WCAG 2.1 AA in **both themes** — 4.5:1 for normal text, 3:1 for
  large text and meaningful UI graphics (chart lines, icons, borders that carry
  state). The impeccable token pass validates every token pair actually used.
- **Color is never the only channel**: trends pair color with sign + arrow
  (`TrendBadge`), promo dots pair with the promo chip in lists, status chips carry
  text.
- **Touch targets ≥ 44 × 44 px** (tab items, chips, shutter, list rows, steppers).
- **Focus**: visible `focus-visible` ring using `--color-focus` (2 px, offset) on
  every interactive element; never `outline: none` without a replacement.
- **Icon buttons**: every `IconButton` has a required localized `label`
  (aria-label). Decorative icons are `aria-hidden`.
- **Forms**: real `<label>`s always visible (placeholders are never labels); errors
  bound via `aria-describedby` + `aria-invalid`; Zod validation errors at the
  boundary map to localized field messages.
- **Keyboard (desktop)**: full tab-order navigation; Sheets trap focus and close on
  Esc; merge selection mode operable with keyboard; charts expose their data via the
  sr-only tables (§6.2).
- **Screen readers**: the dashboard hero has `aria-live="polite"` on first
  computation; queue status chips announce changes; page `<title>` per route,
  localized.
- **Language**: `<html lang>` follows the active locale.

---

## 9. UX Copy Guidelines

All copy lives in `messages/it.json` / `messages/en.json` (next-intl). **Zero
hardcoded strings in components** — including aria-labels and chart summaries.

**Voice**

- Italian is the reference voice: **informal "tu"**, concise, warm, zero jargon.
  English mirrors the tone (plain, friendly, direct — not a literal translation).
- The domain word is the price, not the methodology: **"La tua inflazione"**, never
  "Indice CPI personale". "Prezzi", "spesa", "cartellino" — words from the
  supermarket, not from statistics. The one statistical concession is the coverage
  line, kept human: "Basato su 23 prodotti in 6 categorie".
- Numbers are the heroes; copy frames them and gets out of the way. No exclamation
  marks except (optionally) one in the very first success moment.
- Buttons start with a verb: "Scatta", "Conferma", "Salva", "Unisci" / "Scan",
  "Confirm", "Save", "Merge".

**Error messages say what to do next** — pattern: *what happened* + *next step*:

| Situation | it | en |
|---|---|---|
| Extraction failed | "Non sono riuscito a leggere il cartellino. Riprova con più luce o inserisci i dati a mano." | "Couldn't read the price tag. Try again with more light, or enter it manually." |
| Offline action needs network | "Serve la connessione. Riprova quando sei online." | "This needs a connection. Try again when you're online." |
| Save failed | "Non salvato. Controlla la connessione e riprova." | "Not saved. Check your connection and try again." |
| Import file invalid | "File non valido. Serve un export di segnaprezzi." | "Invalid file. It must be a segnaprezzi export." |

**Namespace map** — the canonical set of top-level keys in both message files:

`common` · `nav` · `dashboard` · `scan` · `review` · `addManual` · `addFuel` ·
`products` · `productDetail` · `history` · `stores` · `settings` · `auth` ·
`errors` · `offline` · `categories` · `units` · `pwa`

Keys are **camelCase**, with one exception: keys under `errors.*` use
`DomainErrorCode` names verbatim (e.g. `errors.NOT_FOUND`). Spec 01 seeds the
skeleton of both message files with this namespace set (including the "Cronologia" /
"History" tab label this spec uses in §4); this spec fills in the screens' copy.

Both files must stay key-complete; a Vitest check compares the key trees so a
missing translation fails CI.

---

## 10. Definition of Done

Spec 05 is done when **all** of the following hold:

- [ ] Every route in the Spec 00 route map is implemented with **all four states**
      (data, empty, loading, error) as specified in §5 — including the first-run
      dashboard empty state, the thin-data state, and the global offline pattern.
- [ ] Both themes (light/dark + system) render correctly on every screen; no
      hardcoded color values outside `globals.css`.
- [ ] Both locales complete and key-complete; language switch works on every screen;
      all numbers flow through `src/lib/format.ts` (unit-tested).
- [ ] Full motion inventory (§7) implemented with `houseSpring`, including the FAB →
      camera morph, and `prefers-reduced-motion` honored per the table.
- [ ] Charts render live on seed data: `pnpm db:seed` (`scripts/seed.ts`, the
      canonical dataset from Spec 02 §8) makes the dashboard, product detail, and
      history visually complete during iteration and demos. If design iteration
      needs richer data, **extend `scripts/seed.ts`** (updating Spec 02 §8 in the
      same change) — never a separate dev-seed script or a `pnpm seed` alias.
- [ ] **axe clean**: automated axe checks (Playwright + axe-core) report zero
      violations on every route, both themes.
- [ ] **Lighthouse accessibility ≥ 95** (mobile emulation) on Dashboard, Scan,
      Review, and Settings.
- [ ] Touch targets, focus rings, aria-labels, and chart fallback tables verified
      per §8.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all pass.
- [ ] The impeccable build is approved, `DESIGN.md` is generated by the impeccable
      documenter, and `AGENTS.md` references it as required reading for UI work.

---

## Implementation Prompt

```text
You are implementing Spec 05 — UI & Design System for segnaprezzi.

Before writing any code, read IN FULL, in this order:
1. AGENTS.md
2. CLAUDE.md
3. WORKFLOW.md                 (session/collaboration rules — branch, commit,
                                guided-collaudo discipline)
4. docs/specs/00-overview.md   (canonical contract — exact names, money rules)
5. docs/specs/05-ui-design.md  (the spec you are implementing)
6. docs/DEVELOPMENT_GUIDELINES.md
7. docs/COMMENTS.md

Prerequisites: Specs 01–04 must already be implemented (scaffold + tokens file,
DB + auth, capture + AI extraction, inflation engine). Verify their status in
CLAUDE.md "Current status" before starting; stop and report if any is missing.

Design-first flow (mandatory):
- Invoke the impeccable skill to establish the final visual language (token
  values, type scale, spacing, exact pixel values) from the direction in Spec 05
  §1–§3 BEFORE building screens. impeccable owns final visual values; Spec 05
  owns structure, data fields, states, and behavior — implement both faithfully.
- Load seed data first (pnpm db:seed — the canonical dataset from Spec 02 §8).
  If design iteration needs richer data, EXTEND scripts/seed.ts and update
  Spec 02 §8 in the same change — do not create a separate seed script.
- Iterate live at a 390px mobile viewport until each screen is right; only then
  widen to tablet (768px) and the desktop rail (1024px).

Build requirements:
- Implement every screen in Spec 05 §5 with all four states (data, empty,
  loading, error), both themes, both locales, and the motion inventory in §7
  (house spring: stiffness 400, damping 35; prefers-reduced-motion honored).
- Semantic tokens only — no hardcoded colors in components. All numbers through
  src/lib/format.ts. Charts are hand-rolled SVG with the §6.2 accessibility
  fallbacks.
- Follow the layered architecture, naming, and comment rules from
  docs/DEVELOPMENT_GUIDELINES.md and docs/COMMENTS.md.

Verification:
- Meet the full Definition of Done in Spec 05 §10: axe clean on every route,
  Lighthouse accessibility ≥ 95, AA contrast in both themes.
- Run pnpm lint, pnpm typecheck, pnpm test, pnpm test:e2e — everything green.

Delivery:
- Commit in small logical steps with conventional commits.
- When the build is approved, run the impeccable documenter to generate
  DESIGN.md, then add DESIGN.md to AGENTS.md as required reading for UI work.
- Update the "Current status" section of CLAUDE.md.
```

**Recommended model:** Claude Fable 5 + impeccable skill
**Recommended effort:** xhigh

**Prerequisites:** Specs 01–04 implemented (01 Foundation & Scaffold, 02 Database &
Auth, 03 Capture & AI Extraction, 04 Inflation Engine).
