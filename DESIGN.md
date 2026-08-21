---
name: segnaprezzi
description: Your personal inflation index, printed as a continuous-form statement.
colors:
  paper: "oklch(97.2% 0.014 88)"
  sheet: "oklch(99.2% 0.006 88)"
  sheet-raised: "oklch(99.6% 0.004 88)"
  green-bar: "oklch(94.4% 0.034 140)"
  ink: "oklch(23% 0.018 300)"
  ink-muted: "oklch(46% 0.02 300)"
  highlighter: "oklch(64% 0.17 48)"
  highlighter-contrast: "oklch(23% 0.018 300)"
  highlighter-ink: "oklch(52% 0.15 45)"
  highlighter-wash: "oklch(94% 0.05 75)"
  ribbon-green: "oklch(47% 0.13 150)"
  ribbon-green-wash: "oklch(93% 0.05 150)"
  ribbon-red: "oklch(50% 0.19 28)"
  ribbon-red-wash: "oklch(93.5% 0.033 28)"
  amber-stamp: "oklch(52% 0.12 70)"
  amber-stamp-wash: "oklch(95% 0.05 85)"
  pink-marker: "oklch(55% 0.2 350)"
  hairline: "oklch(84% 0.02 88)"
  scrim: "oklch(23% 0.018 300 / 0.55)"
  chart-compare: "oklch(58% 0.012 300)"
  chart-grid: "oklch(88% 0.018 88)"
  stamp-blue-focus: "oklch(50% 0.15 255)"
  camera-black: "oklch(8% 0 0)"
  camera-white: "oklch(100% 0 0)"
typography:
  display:
    fontFamily: "Martian Mono, ui-monospace, Cascadia Mono, Menlo, monospace"
    fontSize: "clamp(4.25rem, 21vw, 6rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "tabular-nums slashed-zero"
  titleLarge:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.25
  heading:
    fontFamily: "Martian Mono, ui-monospace, Cascadia Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
    fontFeature: "tabular-nums slashed-zero"
  body:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Martian Mono, ui-monospace, Cascadia Mono, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.375
    fontFeature: "tabular-nums slashed-zero"
  dataDense:
    fontFamily: "Martian Mono, ui-monospace, Cascadia Mono, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.375
    fontFeature: "tabular-nums slashed-zero"
  caption:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.375
  captionSans:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.375
  label:
    fontFamily: "Martian Mono, ui-monospace, Cascadia Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.025em"
    fontFeature: "tabular-nums slashed-zero"
rounded:
  control: "0.375rem"
  sheet: "0.75rem"
  pill: "9999px"
spacing:
  row: "48px"
  row-tall: "56px"
  control: "44px"
  gutter: "16px"
  gutter-tablet: "32px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.highlighter}"
    textColor: "{colors.highlighter-contrast}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  button-secondary-hover:
    backgroundColor: "{colors.green-bar}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.ribbon-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "44px"
  fab-scan:
    backgroundColor: "{colors.highlighter}"
    textColor: "{colors.highlighter-contrast}"
    rounded: "{rounded.pill}"
    size: "64px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 12px"
  input-derived:
    backgroundColor: "{colors.highlighter-wash}"
  card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "16px"
  chip-filter:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 14px"
  chip-filter-selected:
    backgroundColor: "{colors.highlighter-wash}"
    textColor: "{colors.ink}"
  chip-status:
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "24px"
    padding: "0 8px"
  trend-up:
    backgroundColor: "{colors.ribbon-red-wash}"
    textColor: "{colors.ribbon-red}"
    rounded: "{rounded.pill}"
    height: "28px"
  trend-down:
    backgroundColor: "{colors.ribbon-green-wash}"
    textColor: "{colors.ribbon-green}"
    rounded: "{rounded.pill}"
    height: "28px"
  tab-bar:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-muted}"
    height: "56px"
  tab-bar-active:
    textColor: "{colors.highlighter-ink}"
  sheet:
    backgroundColor: "{colors.sheet-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "0 20px 20px"
---

# Design System: segnaprezzi

Recorded from the shipped Spec 05 build (impeccable seed 12e30ec0, locked 2026-08-21). Ground truth is `src/app/globals.css`, `src/app/[locale]/layout.tsx`, `src/lib/motion.ts`, `src/lib/format.ts` and `src/components/**`. Token names in the frontmatter are descriptive; the code names they map to are given in parentheses and are the only ones components may use (`bg-surface`, `text-text-muted`, ...). Frozen names per `docs/specs/05-ui-design.md` §2.1.

## Overview

**Creative North Star: "Tabulato a modulo continuo"**

The personal index is a statement printed on continuous-form paper: rows you can scan, numbers you can trust, a sheet you could tear off. Everything the machine printed (every number, every product row, every column header) is set in a monospace with tabular figures; everything pre-printed on the form (labels, prose, controls) is a quiet grotesk. The page is cream stock with ribbon ink; dark mode is the print negative of the same sheet (ink field, paper-colored type), never a phosphor screen.

Density is printout density. Lists are 48 px green-bar zebra rows with no cards around them, separated by hairline and dashed rules rather than whitespace. Hierarchy is carried by ink weight (400/500/600) and by the two voices as much as by size; the only large thing on any screen is the headline percentage. This build refuses the fintech KPI-card dashboard: no tiles, no gradients, no glassmorphism, no drop shadows on resting surfaces.

Color has a grammar, not a palette. One highlighter-orange accent marks the single live thing; ribbon red and ribbon green mean price direction and nothing else on data surfaces; amber means "needs a human look"; pink marker means "promotional price". That grammar, more than any single token, is the system.

**Key Characteristics:**
- Cream paper and ribbon ink; dark is the negative of the same print
- Two voices: Martian Mono (width axis) for what the machine printed, Barlow 400/500/600 for the form
- Green-bar zebra rows on a 48 px rhythm behind every list
- A punched sprocket margin on the desktop rail; dashed tear-off perforation on the tab bar
- Uppercase mono column headers over a double rule ARE the headings
- One meaning per color; accent is the only brand color in the chrome
- Flat at rest; only sheets, toasts and the Scan disc lift off the page
- One spring, one fade, one reduced-motion switch

## Colors

A cream-and-ink paper register with five semantic inks, each owning exactly one meaning; dark mode flips every token on `.dark` to the print negative (all dark values live in `globals.css`, not here).

### Primary
- **Highlighter** (`accent`, `oklch(64% 0.17 48)`): the one live/active thing. The Scan disc, primary buttons, the toggle track when on, the input caret, selected segmented option, and the wash behind selected filter chips. Text on it is ink (`accent-contrast`), never white. As a graphic (disc, fill) it meets >=3:1 against paper.
- **Highlighter Ink** (`accent-ink`, `oklch(52% 0.15 45)`): the accent used *as words*. Active tab labels, the FAB caption, toast actions, the required-field mark. Exists because the highlighter itself is too light for text; this twin meets >=4.5:1 on paper, band and surface. In dark mode both tokens converge on the same value.
- **Highlighter Wash** (`accent-soft`, `oklch(94% 0.05 75)`): the pale stroke of the same marker. Text selection, selected chips, the derived-value flash on computed inputs, and the hover tint on zebra rows.

### Secondary (price direction and status inks)
- **Ribbon Red** (`negative` / `negative-soft`): a price that went **up**. Also destructive actions (`danger` button) and failures (field errors, error toast dot), per Spec 05 §2.1.
- **Ribbon Green** (`positive` / `positive-soft`): a price that went **down**. Also confirmations (checkmark, success toast dot).
- **Amber Stamp** (`warning` / `warning-soft`): needs a human look; thin data, low-confidence extraction, needs-review chips.
- **Pink Marker** (`promo`): a promotional price. Text and border only; no soft twin exists.

### Neutral
- **Paper** (`background`, `oklch(97.2% 0.014 88)`): the page. Body background, the ring around the Scan disc, text on the danger button.
- **Sheet** (`surface`, `oklch(99.2% 0.006 88)`): the printed form laid on the page: cards, inputs, tab bar, sprocket strip, sticky footers (at 95% with backdrop blur).
- **Sheet Raised** (`surface-raised`): only what lifts off: bottom sheets and toasts.
- **Green Bar** (`band`, `oklch(94.4% 0.034 140)`): the tinted alternate row of green-bar paper; also every neutral hover (`hover:bg-band`), the flat trend pill, the toggle track when off.
- **Ink** (`text`) and **Ink Muted** (`text-muted`): the two text weights. Muted carries labels, captions, column headers and inactive tabs.
- **Hairline** (`border`): every rule, double and dashed included, the sprocket holes, the sheet drag handle, the scrollbar thumb.
- **Chart Compare** / **Chart Grid**: the ISTAT overlay line (a neutral grey, deliberately not a brand color) and the chart gridlines.
- **Scrim** (`overlay`), **Stamp Blue** (`focus`): the sheet backdrop and the focus ring. Blue appears nowhere else, so focus is unmistakable.
- **Camera Black / White**: the viewfinder ignores the theme; camera chrome is always white on black.

### Named Rules
**The One Meaning Rule.** Each semantic ink has exactly one meaning on data surfaces: accent = live, red = price up, green = price down, amber = needs review, pink = promo. Never borrow a status color for decoration or emphasis.

**The Ink-on-Highlighter Rule.** Text on the accent is always `accent-contrast` (ink). Accent as text is always `accent-ink`. White never touches the highlighter.

**The Rising-Is-Red Rule.** This is an inflation tracker: `priceDirectionOf()` maps a positive ratio to the `negative` family and a negative ratio to `positive`; exactly zero (|ratio| <= 0.00005) is neutral band. Every direction is also carried by sign, arrow and an sr-only word; color is never the only channel.

**The Two-Places Rule.** A literal color appears only in `globals.css` and `docs/assets/logo.svg`. Components use semantic utilities only; Tailwind palette colors (`gray-500`, `orange-*`) do not exist in this project.

## Typography

**Display / Data Font:** Martian Mono (`--font-print`, next/font, `wdth` axis), falling back to ui-monospace, Cascadia Mono, Menlo
**Body / Form Font:** Barlow 400/500/600 (`--font-form`, next/font), falling back to Segoe UI, system-ui
**Label/Mono Font:** same Martian Mono; anything matching `font-mono` gets `tabular-nums slashed-zero` globally

**Character:** two voices of one document. The mono is what the line printer struck; the grotesk is what was pre-printed on the form. A reader can tell machine data from human labels at a glance without reading a word.

### Hierarchy
Sizes are the steps actually used in the build (24/17/15/14/13/12/11 px plus the hero clamp). `text-sm`/`text-base`/`text-lg` appear in a few sheets and empty states as 14/16/18 px equivalents; prefer the pixel steps below.

- **Display** (mono 600, `clamp(4.25rem, 21vw, 6rem)`, line-height 1, tracking -0.04em): the signed headline percentage only, about four rows tall, digits rolling into cells on mount via `NumberTicker`.
- **Title large** (grotesk 600, 24 px, leading-tight, `text-2xl`): the one headline a screen may raise above the heading rule — the welcome (first-run) title, the thin-data title, the login/signup title.
- **Title** (grotesk 600, 17 px, leading-tight): screen titles in `ScreenHeader`, the large value in the thin-data fact rows.
- **Heading** (mono 600, 12 px, uppercase, tracking 0.12em, muted ink, over a 3 px double rule): `SectionHeading`. Also the sticky list headers and day/month group headers in History.
- **Body** (grotesk 400, 15 px): prose, field labels (500), button labels (600), row primary text in grotesk lists.
- **Data** (mono 400/600, 14 px): product names and values in rows; 600 for the value column, 400 for names.
- **Data dense** (mono 400, 13 px): history lines, chart readouts and axis captions, the small trend badge; its grotesk twin (13 px, 400) carries header captions, small-chip labels and the sheet's secondary text.
- **Caption** (grotesk 400, 12 px, muted): secondary row text (store, package size), coverage notes.
- **Label** (mono 400, 11 px, uppercase, tracking-wide, muted): the HH:MM time column, status chips, group-header meta, tab labels (grotesk 500, 11 px).

### Named Rules
**The Machine-Printed Rule.** Every number the app computed or extracted (prices, percentages, index values, counts, dates in rows, times) is mono with tabular figures and a true minus (U+2212). Labels describing them are grotesk. Mixed-voice rows are the signature, not a mistake.

**The Heading-Is-The-Heading Rule.** The uppercase mono line over the double rule *is* the `<h1>/<h2>`. It is never a kicker or eyebrow above a larger title; nothing sits between it and its content except its trailing control.

**The Weight-Before-Size Rule.** Within a row, hierarchy comes from weight (600 value vs 400 name) and voice before it comes from size; size steps move at most one notch (15 -> 14 -> 13 -> 12 -> 11).

**The Format Boundary Rule.** `src/lib/format.ts` is the only caller of `Intl`. Money: `2,49 €` (it) / `€2.49` (en). Unit price: 2 decimals, 3 when not a whole cent (`1,799 €/L`); units /kg, /L, /pz (it) or /pc (en). Percentages always signed except exactly zero, 1 decimal. Index values 1 decimal. Dates in Europe/Rome.

## Layout

Mobile-first, measured at 390 px. Three named breakpoints replace Tailwind's defaults (`sm/md/lg` are reset and never appear in components): **tablet** 48rem (two-column dashboard `2fr 1fr`, gutters 16 -> 32 px, sheets become centered dialogs), **rail** 64rem (the tab bar hides, a left navigation rail appears with the sprocket margin, the Scan FAB becomes a labelled rail button), **desktop** 90rem (reserved, currently unused beyond rail). Content is capped at `max-w-5xl` on the dashboard and `max-w-md` for focused forms and welcome.

The vertical rhythm is the **48 px row** (`h-12` / `min-h-12`): zebra rows, skeleton rows, thin-data facts. The sprocket margin punches one hole per 48 px to stay in register with the rows. Taller rows (56 px, `min-h-14`) carry two-line product names with a trend pill; the dashboard summary uses 40 px rows inside its definition list. Lists bleed to the gutter edge (`-mx-1`/`-mx-2`) so the band runs full width; row padding is 12 px. Sections are stacked with 32 px gaps (`gap-8`), inner blocks 12-16 px.

Rigid margin columns are a kept raise: the desktop rail's 20 px sprocket strip, and the 44 px HH:MM time column with a dashed right rule in History rows.

Sticky bars: list headers stick to the top on `bg-background/95` with backdrop blur and a dashed bottom rule. Bulk-action footers stick above the tab bar (`bottom: calc(3.5rem + safe-area)`) with `pb-11` on mobile so the raised Scan disc never covers them, and drop to `bottom-0 pb-3` at `rail`. The shell pads content by `3.5rem + safe-area + 1rem` under the tab bar; toasts sit at `4.5rem + safe-area` (1.5rem at rail). Safe areas use the `pt-safe` / `pb-safe` utilities; `viewport-fit: cover`.

All tap targets are 44 px (`h-11`, `size-11`, `min-w-11`); 28 px small chips keep a 44 px hit area through a transparent halo.

## Elevation & Depth

Print has no elevation. Surfaces are flat at rest and depth is conveyed tonally (paper -> sheet -> sheet-raised) and by rules: hairline borders, 3 px double rules for headers, 1 px dashed rules for perforations and secondary separators. Hover is a tint change (`band` on controls, `accent-soft` on data rows), never a lift.

### Shadow Vocabulary
- **Sheet** (`shadow-sheet`, `0 -8px 32px -8px var(--shadow-ink)`): the bottom sheet rising from the bottom edge (upward shadow).
- **Raised** (`shadow-raised`, `0 6px 20px -6px var(--shadow-ink), 0 1px 2px var(--shadow-ink)`): toasts, and the sheet once it becomes a centered dialog at tablet.
- **FAB** (`shadow-fab`, `0 8px 20px -6px var(--shadow-ink), 0 2px 4px var(--shadow-ink)`): the Scan disc and rail Scan button.

`--shadow-ink` is ink at 14% alpha on paper, 50% in the negative.

### Named Rules
**The Off-The-Sheet Rule.** A shadow means the element is physically off the paper: sheets, toasts, the Scan disc. Cards, rows, inputs, headers and the tab bar never cast one.

## Shapes

Stamped controls, not pebbles. Two radii: **control** (6 px) for buttons, inputs, cards, toasts, segmented wrappers, dashed empty frames; **sheet** (12 px) for the bottom sheet (top corners only on mobile, all four at tablet). Pills (9999 px) are reserved for chips, trend badges, the toggle, the drag handle and the Scan disc. Borders are 1 px hairlines; secondary buttons use `text/70` for a firmer frame; focused inputs switch the frame to ink. Perforations are 1 px dashed hairlines (tab bar top, sticky header bottom, sprocket margin right edge, time column). The double rule (3 px double) is the header signature. The Scan disc is cut through the tab bar's perforation with a 4 px paper ring (`ring-background`).

## Components

### Buttons
- **Shape:** stamped control (6 px), 44 px tall (`md`, 15 px) or 52 px (`lg`, 16 px), min-width 44 px, grotesk 600, leading-none, icon gap 8 px.
- **Primary:** highlighter fill with ink text, `px-4`.
- **Secondary:** sheet fill, 1 px `text/70` frame, ink text.
- **Ghost:** transparent, ink text underlined with a hairline decoration at 4 px offset.
- **Danger:** ribbon-red fill with paper text.
- **Hover / Press / Focus:** hover `brightness-95` (filled) or `bg-band` (framed/ghost); pressed `scale: 0.97` via Motion `whileTap` (off under reduced motion); focus is the global 2 px stamp-blue outline at 2 px offset.
- **Pending:** the app's only spinner, a quarter arc in `currentColor` inside the button, with `aria-busy`; content areas use skeleton zebra rows, never spinners.
- **Icon buttons:** 44/52 px squares in `plain`, `outlined`, `filled` variants with the same states.

### Chips
- **Filter:** pill, 44 px tall (`sm`: 28 px with a 44 px halo), grotesk 500 14 px, sheet fill and hairline; selected = highlighter wash with an accent border; `aria-pressed`. Removable chips split into a pill pair.
- **Status:** 24 px pill, mono 11 px uppercase, tinted by tone (`neutral`, `accent`, `positive`, `negative`, `warning`, `promo`): soft background with the ink of the same family at 30-40% border. Always carries text.

### Trend Badge
Mono 600 pill (28 px / 24 px small) with arrow + signed percentage; `negative-soft/negative` for up, `positive-soft/positive` for down, `band/text-muted` flat; sr-only direction word.

### Cards / Containers
- **Corner Style:** 6 px.
- **Background:** sheet, 1 px hairline frame, padding 16 px (`compact` 12 px, `none`).
- **Shadow Strategy:** none; interactive cards tint to band on hover/active.
- **Rule:** a card is a ruled block on the sheet. Never nest a card inside a card. Lists are zebra rows directly on the page; the one framed list is the History session card, whose hairline frame groups a shopping trip's rows under its total.

### Inputs / Fields
- **Style:** 44 px (`lg` 56 px) sheet frame, 6 px radius, hairline border, 12 px side padding; prefix/suffix (€, /kg) in mono muted 14 px inside the frame.
- **Money mode:** right-aligned mono, `inputmode="decimal"`, 16 px (`lg` 24 px); comma and dot both accepted.
- **Focus:** frame turns ink; the global outline handles focus-visible; caret is highlighter.
- **Derived:** frame flashes highlighter wash when a value was computed from another field.
- **Error / Disabled:** ribbon-red frame with a 14 px red 500 message under the field; disabled at 50% opacity.
- **Field:** grotesk 500 15 px label, required mark in `accent-ink`, hint in 14 px muted.
- **Toggle:** 48 x 28 px pill track (`band` off / `accent` on) with a 20 px knob that springs across (`layout` + houseSpring).
- **Segmented:** options in a hairline wrapper; the selected option is a highlighter-wash plate with an accent/50 border animated with the shared spring.

### Navigation
- **Tab bar (mobile, < rail):** fixed, 56 px + safe area, sheet background, dashed top perforation, five cells; icons 22 px with labels (grotesk 500, 11 px). Inactive: muted ink, stroke 1.75; active: `accent-ink`, stroke 2.25, `aria-current="page"`. Hides on scroll in lists by translating `110%` with the house spring, driven by the shell.
- **Scan FAB:** 64 px highlighter disc, ink camera glyph, `shadow-fab`, 4 px paper ring, raised 28 px through the perforation, caption in `accent-ink`. Shares `layoutId="scan-morph"` with the viewfinder so it morphs into the camera; pressed `scale-95`.
- **Rail (>= rail):** vertical navigation with a 20 px `sprocket-margin` strip on its left edge; the FAB becomes a 48 px labelled highlighter button.
- **Screen header:** 56 px row, grotesk 600 17 px title with an optional 13 px muted caption.

### Sheet
Bottom sheet on `surface-raised`, 12 px top radius, `shadow-sheet`, 40 x 4 px hairline drag handle, title grotesk 600 18 px, scrim `overlay`. Springs up and supports drag-to-dismiss (elastic 0.6 downward); at tablet it is a centered `max-w-md` dialog with `shadow-raised` and no drag.

### Toast
`surface-raised` card with `shadow-raised`, 8 px status dot (positive / negative / muted), grotesk 15 px message, `accent-ink` action. Slides and fades in; sits above the tab bar.

### Zebra List (signature)
`<ul class="zebra">`: odd children take the green-bar tint; rows are 48 px (or `min-h-12` / `min-h-14`) with 12 px side padding, hover `accent-soft`. Left: mono name (14 px) over grotesk caption (12 px). Right: mono 600 value (14 px) over mono 11 px meta. History rows lead with a 44 px mono HH:MM column closed by a dashed rule. Skeletons are zebra rows too.

### Section Heading (signature)
Mono 600 12 px uppercase, 0.12em tracking, muted ink, 6 px above a 3 px double rule; optional trailing control on the rule (the ISTAT toggle chip lives here). Used as `h1` on the dashboard and `h2` elsewhere.

### Charts
Area chart with the personal series in the highlighter `accent` (line + soft gradient area), promo observations as `promo` dots, the ISTAT overlay in `chart-compare` (neutral grey), gridlines in `chart-grid`; category bars and sparklines use the same inks; axis labels mono 12-13 px. The series draws in on mount only; the overlay toggles with the 150 ms fade.

### Motion
From `src/lib/motion.ts` only: `houseSpring` (`spring`, stiffness 400, damping 35) for all movement, `quickFade` (150 ms ease-out) for opacity, `CARD_STAGGER_SECONDS` 0.03 for review cards. `useAppMotion()` is the single reduced-motion switch: springs become instant cuts, fades up to 150 ms stay; a global CSS override collapses every transition under `prefers-reduced-motion`. Inventory: hero digit roll, FAB -> viewfinder morph, review card stagger, 150 ms route cross-fade, confirm checkmark draw + pop, chart draw-in, sheet slide/drag, tab bar hide/show, toast slide + fade, pressed 0.97, derived-value highlight.

## Do's and Don'ts

### Do:
- **Do** set every computed or extracted number in `font-mono` and pass it through `src/lib/format.ts`; tabular figures, slashed zero and the U+2212 minus come for free.
- **Do** build lists as `zebra` rows on a 48 px rhythm, bleeding to the gutter, with hover `accent-soft`; paginate with a dashed rule, not with cards.
- **Do** head sections with `SectionHeading` (uppercase mono over the double rule) and put the section's one control on the rule.
- **Do** use `accent-ink` whenever the accent is text, and `accent-contrast` (ink) for text on an accent fill.
- **Do** render price direction through `TrendBadge` / `priceDirectionOf` so rising = red, falling = green, with sign, arrow and sr-only word.
- **Do** use the named breakpoints `tablet:` (48rem), `rail:` (64rem), `desktop:` (90rem) and the `pt-safe` / `pb-safe` utilities.
- **Do** give sticky footers `pb-11` on mobile (and `rail:pb-3`) so the Scan disc never covers their controls.
- **Do** animate only with `useAppMotion().spring` / `.fade`; stagger review cards at 30 ms; keep route changes to the 150 ms cross-fade.
- **Do** use 44 px tap targets and the global stamp-blue focus ring; never suppress `:focus-visible`.

### Don't:
- **Don't** use Tailwind palette colors or literal hex/oklch in components; only the semantic tokens from `globals.css`.
- **Don't** put white text on the accent, or use raw `accent` as body/link text.
- **Don't** give a status color a second meaning: no red for "important", no green for "brand", no amber decoration.
- **Don't** add kicker or eyebrow labels above a title; the mono heading is the heading.
- **Don't** nest cards in cards or put a resting surface in a shadow; the only shadows belong to sheets, toasts and the Scan disc.
- **Don't** show spinners for loading content; use zebra skeleton rows. The button's pending arc is the one spinner.
- **Don't** declare ad-hoc springs, durations or `whileTap` values, or read `useReducedMotion` outside `src/lib/motion.ts`.
- **Don't** use raw `sm:` / `md:` / `lg:` breakpoints; they are reset to nothing.
- **Don't** invent new type sizes between the steps 24/17/15/14/13/12/11 px, or a second display size beside the hero clamp.
- **Don't** call `Intl.NumberFormat` / `Intl.DateTimeFormat` outside `src/lib/format.ts`.
