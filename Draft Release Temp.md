## ✨ New Features

- Added the app in Italian and English end to end (`/` and `/en`)
- Added light and dark themes — follow your device or pick one in Settings — with no flash of the wrong color on load
- Added user accounts — sign up with email and password, and stay signed in for up to 30 days
- Added a way to export your complete price history and account data as a JSON file
- Self-hosters can now close new signups on their own instance while keeping it usable for existing users
- Added price tag scanning — photograph a shelf tag and Claude Haiku 4.5 reads the product, brand, category, price and price per kg/L for you
- Added a review step before anything is saved: every extracted field is editable, and prices that don't add up or that the AI wasn't sure about are flagged for you to check
- Added offline capture — photos are compressed and queued on your phone straight away, so a supermarket with no signal never costs you a price tag
- Added a manual entry form for items without a tag, with the price per kg/L worked out as you type and grams or millilitres accepted directly
- Added a fuel quick entry form: pick benzina, diesel, GPL or metano, type any two of price per unit, quantity and total, and the third fills itself in
- Added promotion tracking — mark a price as a discount, loyalty-card price, coupon or multi-buy, so you can later decide whether promos count toward your index

- Added the dashboard: your personal inflation as one big number (year over year once you have a year of data, "since you started" before that), with month-over-month, the index value, and an honesty line that says how many products and categories it rests on
- Added the 12-month trend chart of your index with a one-tap comparison against the official ISTAT index, rebased to your own starting month so the two lines are directly comparable
- Added the category breakdown (which parts of your shopping went up or down) and the top movers — the five products that changed the most, each with a tiny price line
- Added a product catalog with search and category filters, an archive, and a merge tool to fold duplicate products together without losing any history
- Added product pages: monthly price chart with promo markers, min/max/average/latest, where it's cheapest across your stores, and every observation — editable or deletable from a sheet
- Added the history: every price you recorded, day by day, with shopping trips grouped under their total, and filters by category, store, promo and source
- Added store management (supermarkets, fuel stations, other) and inline "create a store" from every picker
- Added settings: include or exclude promotions from the index, how many months a missing price is carried forward, language, light/dark/system theme, data export, backup import, and account deletion
- Redesigned the whole app as a printed statement — cream paper, green-bar rows, typewriter numbers that line up in columns — with a dark "print negative" theme, Italian and English, on phone, tablet and desktop
- Redesigned the camera screen as a full-screen viewfinder with a store chip, torch toggle, photo tray with status chips, and a "Review (N)" button; the Scan button morphs into the camera
- Redesigned the review screen: one card per photo, flagged cards say why, a product picker with suggestions and catalog search, and a confirm bar that shows the running total and what is still missing
- Added an offline pill that tells you how many photos are waiting on your phone, and a success toast when they are synced
- Login and signup now reveal one field at a time, show inline errors, and let you peek at the password

## 🔧 Improvements

- Fuel entries now keep the three decimals petrol pumps actually display (€1.799/L), instead of rounding them away
- Methane is measured in kilograms, the way Italian pumps sell it, rather than being forced into litres

- Every number in the app is formatted in one place, so money, percentages and dates look the same everywhere (true minus signs, three decimals for fuel, Italian or English separators)
- Prices, percentages and dates use tabular figures, so columns never wobble as values change
- All motion uses one spring and respects "reduce motion" in your system settings
- The demo data now spans fourteen months and two supermarkets, so a fresh install shows a real year-over-year number

## 🔒 Security

- Your data is now private to your account — every store, product, and price you add is visible only to you, never to other users on the same instance
- Pages that show your data now require you to be signed in

- Importing a backup can only ever touch your own rows: ids that belong to someone else are skipped, never overwritten
- Deleting your account asks for your password and wipes everything in one go

## 📚 Documentation

- Added `DESIGN.md`, the recorded design system (tokens, type, layout, motion, do's and don'ts) that every UI change must follow, and `PRODUCT.md` with the product truth behind it
- README now describes the design, the accessibility bar and how to run the end-to-end suite on a custom port

## 🏗️ Technical

- Added the personal inflation engine: your entries are bucketed into calendar months (Italian time), each product is compared with itself month over month, products within a category are combined with a geometric mean, and categories are weighted by what you actually spent over the last twelve months — giving a chained index (first month = 100) with month-over-month, year-over-year and since-start figures, per-category series, and your top risers and fallers
- Added honesty stats next to every index number — how many products were compared, how many categories, how much was carried forward from earlier months, which months had nothing to compare, and how many suspicious jumps were capped — so a thin history never looks more solid than it is
- Added carry-forward and outlier guards: a missing month is filled from the last known price for up to two months (configurable; 0 turns it off), a promo-only month still counts when promos are excluded from the index, and one implausible jump (a €/100 g tag read as €/kg) can move the index by at most a factor of five for one month
- Added the official ISTAT NIC index as bundled data (all items, monthly since 1996, in the current 2025 = 100 base) so the "you vs Italy" comparison works offline, plus a maintenance command and a monthly GitHub workflow that refresh it from ISTAT's data service and open a pull request with the diff
- Set up the Next.js 16 project foundation (build tooling, linting, type checking, and automated tests) that the rest of the app will be built on
- Retrying a photo upload after a dropped connection now overwrites the same stored photo instead of leaving a duplicate behind, and confirming a shopping trip twice can never create the same entry twice
- Every screen passes automated accessibility checks (axe) in both themes on phone and desktop, and scores 100 on Lighthouse accessibility
- Charts are hand-drawn SVG with a hidden data table for screen readers — no charting library
- Added an accessibility end-to-end suite and a desktop Playwright project alongside the mobile one
