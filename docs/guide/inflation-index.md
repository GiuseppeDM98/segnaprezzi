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

## 4.72 The index compares each store with itself, and only carrying each store's price forward keeps that honest.

One product is logged across stores
(the same GPL at two stations, the same bananas at two supermarkets), so a mean
across stores reads a change of store as inflation. Comparing only the stores
seen in both months is the obvious fix and it is wrong: with both stores in
March, the dear one alone in April and the cheap one alone in May, the index
loses the step down and never gets it back. Each store therefore keeps its own
carried price, and a product's relative is the Jevons of the stores priced in
both months. A price seen only at a new store compares with nothing and reads
0%, the owner's call of 2026-11-03; the accepted cost is that moving for good
to a dearer or cheaper store does not move the index (README, "What the index
measures"). With `carryForwardMonths = 0` the cross-store ratio is the fallback.
One store returns its ratio untouched, so a single-store history stays
bit-identical. Fixed in `relatives.test.ts`, "store-by-store comparison".

## 4.73 "This month's price is real" and "a new price was compared" are two different facts, and neither is a share of prices.

`isPriceCompared` is not
`!isToImputed`: a price seen only at a new store is observed and still compares
with nothing, so its category reads "not measured" (2026-11-03,
`dashboard.test.ts`). A carried-forward share counted over the 2·n prices of a
link cannot pass 50% in a young series, because every price of the month before
is real: the line that showed it looked like "about half" while nearly every
product had no price this month. Count products (`coverage.ts`).
