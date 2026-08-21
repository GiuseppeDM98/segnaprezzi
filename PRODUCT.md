# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the author, an Italian shopper, in a supermarket aisle — phone held
one-handed, cart in the other hand, fluorescent light, hurry, often no signal.
The same person later reads the dashboard at home, calmly, to see what their
own inflation is doing. Secondary: open-source self-hosters who install the
app for themselves (the project is MIT and public); the English locale exists
for them. No shared/household accounts in v1 (roadmap v1.2).

## Product Purpose

segnaprezzi computes **your personal inflation index** from the prices you
actually pay. You photograph shelf price tags (the *segnaprezzi*) while
shopping; Claude Haiku 4.5 extracts product, total price and unit price; the
app tracks the same products month over month and chains a personal CPI
(base month = 100) with month-over-month, year-over-year and since-start
headlines, per-category breakdown, top movers and a comparison against the
official ISTAT NIC index. Success: the user knows, honestly and at a glance,
"la mia inflazione è +4,2%", and keeps capturing tags because it costs
seconds.

## Positioning

Official inflation is computed on a national basket that is nobody's basket.
segnaprezzi's mechanism — which a generic expense tracker cannot truthfully
copy — is a real CPI methodology (matched-model relatives, Jevons within
category, expenditure-weighted across categories, carry-forward imputation,
coverage stats) applied to one person's own shelf observations, with the
ISTAT series rebased onto the user's own base month for a like-for-like
comparison. Private per user, offline-first, self-hostable.

## Operating Context

- Capture happens in the aisle: fast shutter, queue-and-forget, review later
  (even on the way home with no signal). Quick forms exist for fuel (at the
  pump, one-handed) and manual entries; receipt import (PDF/photo) is also
  supported.
- Reading happens at home: dashboard, product histories, timeline, stores.
- Mobile-first PWA at 390 × 844; tablet (≥ 768) and desktop rail (≥ 1024)
  are secondary. Both light and dark themes are first-class.
- Italian is the reference voice (informal "tu", supermarket words — prezzi,
  spesa, cartellino — never statistics jargon); English mirrors the tone.

## Capabilities and Constraints

- Money is integer only (`total_price_cents`, `unit_price_milli`); every
  displayed number goes through `src/lib/format.ts`; percentages are always
  signed with a true minus sign; tabular figures everywhere data appears.
- Every headline number ships with its coverage line ("Basato su N prodotti
  in M categorie · X% stimato") — the app never shows an index without
  saying how thin the data is. No fake charts: fewer than two monthly
  buckets means a thin-data state, not a line.
- Inflation semantics are inverted relative to finance apps: a rising price
  is unfavorable, a falling price favorable.
- Architecture and names are fixed by the existing schema/code; the visual
  language is decided by the impeccable pass and recorded in `DESIGN.md`.
- Stack: Next.js 16 App Router, React 19, Tailwind 4 (tokens in
  `src/app/globals.css` `@theme`), Motion springs (stiffness 400, damping 35),
  next-intl (it/en), lucide-react icons, hand-rolled SVG charts (no chart
  library).
- Non-goals v1: barcode scanning, shared prices, budgeting, multi-currency,
  native app stores, automatic receipt ingestion.

## Brand Commitments

The name **segnaprezzi** (lowercase) is fixed. Everything else is open for
this pass: the owner confirmed (2026-08-21) that the current logo
(`docs/assets/logo.svg`, a rotated price tag with a rising sparkline, fill
`#EA580C`) and the orange accent seed are **starting evidence, not
commitments** — the chosen visual world may refine or replace them, as long
as the result reads as a precise, warm, data-forward tool and never as a
cold fintech product or a gamified one. Voice: informal, warm, concise; no
exclamation marks except the very first success moment; buttons start with a
verb.

## Evidence on Hand

- Real demo data: `pnpm db:seed` — 13 products across 6 categories, 2 stores,
  fuel fill-ups, promos, across 14 months so the 12-month trend and the
  year-over-year headline render on real engine output.
- Real official series: `data/istat-nic.json` (ISTAT NIC, 1996-01 → 2026-07,
  base 2025 = 100).
- No testimonials, customer logos, press, or benchmarks exist — none may be
  invented.

## Product Principles

1. Numbers are the heroes; chrome recedes, data advances.
2. Honest about thin data — coverage is mandatory, never fake a chart.
3. Capture must cost seconds, one-handed, with no signal.
4. Precise where it counts (alignment, figures, rhythm), human where it talks.
5. Both themes, both locales, every state — none is an afterthought.

## Accessibility & Inclusion

WCAG 2.1 AA in both themes (4.5:1 text, 3:1 large text and meaningful
graphics); color never the only channel (sign + arrow on trends); touch
targets ≥ 44 px; visible focus rings; real labels; sr-only data tables behind
every chart; `prefers-reduced-motion` disables all non-essential motion.
Definition of done includes axe-clean routes and Lighthouse accessibility
≥ 95.
