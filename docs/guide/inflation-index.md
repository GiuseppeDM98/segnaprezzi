# Personal inflation index and ISTAT series

Read this guide before touching `src/lib/inflation/`, the dashboard service's
coverage and category figures, `data/istat-nic.json`,
`scripts/update-istat.ts`, or the `update-istat.yml` workflow. The short
version is the stub in AGENTS.md § Domain guides.

## 4.27 ISTAT's SDMX service needs three things that were not obvious going in.

(1) The NIC was rebased to 2025=100 in January 2026: dataflow
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

## 4.29 Test the engine's dead branches by removing them, not by faking inputs.

The target is ≈100% line coverage of `src/lib/inflation/`; the
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

## 4.71 A GitHub Actions workflow that opens a pull request needs a repository setting, not a token.

`update-istat.yml` ran green through
the refresh and the branch push, then failed in `peter-evans/create-pull-request`
with "GitHub Actions is not permitted to create or approve pull requests" —
twice, a month apart, while every other step was fine. The switch is
`Settings → Actions → General → Allow GitHub Actions to create and approve
pull requests` (`gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow
-F can_approve_pull_request_reviews=true`), off by default on every repo.
After enabling it the same workflow opened PR #15 unchanged. The CI workflow
(`ci.yml`) was removed on the same day: it had been red since 2026-10-23 over
two unformatted files and a deprecated `biome.json` key that `pnpm lint`
reproduces locally, and the gate is the local one (AGENTS.md §3.1).

## 4.72 A product has one price a month, wherever it was bought: the index no longer knows stores.

From 2026-11-03 to 2026-11-12 the index compared each store with itself: every
store kept its own carried price, a product's relative was the Jevons of the
stores priced in both months, and a price seen only at a new store read 0%. The
owner reversed it on 2026-11-12: «a me a lungo termine mi interessa la mia
inflazione», and shopping at several stores is part of how one buys, so the
index must follow what is paid for a product wherever it is bought. Two things
the store-by-store index did on real use weighed in: a move to a dearer store
never reached the index, and a product alternated among three stores was seldom
compared at all, because each store needed its own second price within
`carryForwardMonths`.

A product's monthly price is now the mean of every observation of the month
(`computeObservedMeans`) and its relative is this month's price over last
month's (`relatives.ts`). The accepted cost is noise: a month bought at the
dearer store reads as a rise and the next one as a fall. It is not drift, as
long as the product keeps a price every month: its links multiply to latest
price over first price whatever happened in between, so the level only knows
those two. Fixed in `relatives.test.ts`, "one price per product". The movers
use the same means, so a product bought dearer elsewhere is a mover.

The removal went all the way down: no `stores` table, no `store_id` (migration
0003), no store picker, filter, page or comparison, no `IndexEntry.storeId`.
The worked example in `chain.test.ts` did not move: it never had stores.

## 4.73 "This month's price is real" is what makes a category measured, and coverage counts products, never a share of prices.

A category reads "not measured" in a month where none of its products has a
new price: a carried-forward price is compared with itself and says nothing
(`recordComparedCategories` in `chain.ts`, `dashboard.test.ts`). While
stores were compared one by one (§4.72) a real price could also compare with
nothing, and the relative carried a separate `isPriceCompared` flag; with one
price per product that flag was exactly `!isToImputed` and is gone. A
carried-forward share counted over the 2·n prices of a link cannot pass 50% in
a young series, because every price of the month before is real: the line that
showed it looked like "about half" while nearly every product had no price this
month. Count products (`coverage.ts`).

## 4.75 Every compared product is one vote: the overall relative is the Jevons of the matched set, and nothing in the engine reads what a package cost.

Until 2026-11-06 the categories were combined with expenditure weights, the
trailing twelve months of `totalPriceCents × quantity` per category, ISTAT's
Laspeyres idea on one person's basket. On this app's data that measured the
wrong thing twice: an observation is a shelf tag, not a purchase, so the
"expenditure" was the sum of the tags one happens to photograph; and a fuel
fill-up is logged at the price of the whole tank, sixty euros against two for a
packet of pasta, so the fuel category decided the headline alone. The owner's
goal is to follow the prices of the things they keep buying, not what they
spend, so the owner chose on 2026-11-06 that every compared product counts the
same. The overall month-over-month relative is now the Jevons of every
relative in the link, the same unweighted geometric mean the categories use
inside (`relatives.ts`), so a category weighs as many products as it brings.
The category series, the coverage figures and the movers are untouched; the
worked example in `chain.test.ts` moved from 103.24 to 105.99 at its last
month, with the food and fuel series bit-identical. `weights.ts` is gone and
`IndexEntry` no longer carries `totalPriceCents` or `quantity`: the engine
reads unit prices only. The DB column `quantity` stays (every write records
1) because dropping it is a migration for nothing and the export still
carries it. Accepted cost: a 10% rise in fuel moves the index exactly as much
as a 10% rise in shampoo. The same decision removed the two figures that
spoke of spending, «Spesa registrata» on the thin dashboard and «Totale
spesa» on the history card.
