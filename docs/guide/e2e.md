# End-to-end suite (Playwright)

Read this guide before writing or changing a spec in `tests/e2e/`, touching
`playwright.config.ts` or `tests/e2e/global-setup.ts`, or chasing an E2E
failure that looks like an application bug. The short version is the stub in
AGENTS.md § Domain guides; where the tests live is AGENTS.md §2.2, and the unit
suite's environment is AGENTS.md §4.26.

## 4.14 Pin the Playwright browser locale, or the root-path smoke test is flaky.

next-intl negotiates from `Accept-Language` when no `theme`/locale cookie
is set, and a host's `en-US` outranks the Italian default at `/`, failing
`tests/e2e/smoke.spec.ts`. `playwright.config.ts` → `projects[].use.locale = 'it-IT'`
on every project; `mobile`, `offline-queue` and `pwa` share one `mobileDevice`
literal. WebKit was deliberately left out: it is not Safari, so
`beforeinstallprompt` absence, the 7-day storage eviction and the real share sheet
stay owner checks on a real device.

## 4.20 Next.js dev (Turbopack) can return a truncated response when several Playwright workers race to be the first request to compile a route.

The symptom
is "Unexpected end of JSON input" server-side. Largely historical since §4.41. The
warm-up in `tests/e2e/global-setup.ts` stays but is no longer load bearing; a new
route need not join it. The hazard remains for anything driving `next dev` from
parallel clients.

## 4.24 Playwright must wait for hydration before `setInputFiles` on `/scan`.

`page.goto()` resolves on server HTML, with the camera panel in its `idle` branch
and no change handler attached, and setting the file silently does nothing. Assert `data-testid="camera-fallback"` is visible
first. The race appears only under parallel load.

## 4.25 `getByRole('alert')` is never unique in this app.

Next.js renders
`<div role="alert" id="__next-route-announcer__">`, which breaks strict mode.
Target the specific `data-testid`.

## 4.32 Playwright's `baseURL` must follow the dev server's port, and Better Auth must agree.

`next dev` silently moves to :3001, and `reuseExistingServer`
would then test the *other* app. `playwright.config.ts` reads `PORT`
(`PORT=3001 pnpm test:e2e`), starts its own server and passes `BETTER_AUTH_URL`.
Outside Playwright, on a non-default port, set `BETTER_AUTH_URL` to that origin or
sign-out 403s and looks like an auth bug.

## 4.33 axe measures contrast on rendered pixels — let the 150 ms route cross-fade finish first.

`AppShell` fades `<main>` in, and a half-transparent
page fails `color-contrast` on every text node. `tests/e2e/a11y.spec.ts` waits for `main` to reach
opacity 1 before `AxeBuilder` runs. The accent (`--color-accent`, 3.3:1) is for
fills and icons, not words: hence `--color-accent-ink` (AGENTS.md §1.12).

## 4.41 The whole E2E suite runs against a production build, and a dev server must not run beside it.

The service worker exists only there, so the single
`webServer` is `pnpm build && pnpm start`. Two Next processes sharing one `.next`
corrupt each other's generated types (`.next/dev/types/root-params.d.ts`), and the
build then fails to type-check. `mobile` and `desktop` set
`serviceWorkers: 'block'`.

## 4.52 `test.beforeEach` in a `describe.configure({ mode: 'serial' })` group wipes the state the next test depends on.

A serial group whose second test reads
what the first wrote needs `beforeAll` for its reset; Playwright re-runs it on a
retry of the group, so the fixture stays idempotent.

## 4.58 A message that is true in two places at once breaks a `getByText` locator.

"1 da completare" appeared on the review card and in the confirm bar,
failing strict mode. Fixed editorially: the count belongs to the bar, the card says
"Da completare". Same class as §4.25: prefer a `data-testid` unless the string is
structurally unique.

## 4.60 Spy words must be disjoint across E2E suites that share a seed user.

The
scan review's suggestions fuzzy-match the seed user's whole catalog, so a product
from a parallel spec can capture an assertion ("Fenicottero in scatola E2E" once
did). Invented names keep fixtures away from real data (`WORKFLOW.md` obligation
1) and must keep them away from each other: the delete suite owns "vombato" and
"axolotl". **The same applies inside one file**: "Pesto narvalo 190g" and "Pesto
capibara 190g" still match, so vary the noun too. The symptom is a card stuck on
`needs-product`, which reads like a matcher bug.

## 4.67 Every E2E suite that writes as the second seed user leaves the account as it found it, because the thin dashboard is a state, not a page.

`a11y.spec.ts`
expects `dashboard-thin` for `dev2`, which `getDashboardData` shows only below two
months of series; a fixture from another month flipped it under `fullyParallel`
(seen 2026-10-27). `quick-entry` and `delete-product` clean up in `afterAll`. A new
flow suite owes the same `afterAll`, and a fixture dated outside the current month
is the tell.

## 4.74 With `fullyParallel`, a `beforeAll` runs once per worker, so a spec that recreates its account there deletes it under another worker's login.

The symptom
is `loginViaApi failed: 500` in a test that does nothing wrong. A spec owning a
throwaway account declares `mode: 'serial'` (`dashboard-coverage.spec.ts`,
2026-11-03). Two more traps from that spec: a category section holds the visible
list and a screen-reader table, so scope a text count to the `ol`; and
`not.toContainText('0,0%')` also rejects `+10,0%`.
