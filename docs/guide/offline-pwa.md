# Offline queue, service worker and PWA

Read this guide before touching `src/lib/offline`, `src/components/pwa`, the
service worker, the manifest, the icons, or the build flags Serwist needs. The
short version is the stub in AGENTS.md § Domain guides.

## 4.3 Serwist is disabled in dev — and needs `--webpack` in prod (§4.39).

The Serwist plugin sets `disable: process.env.NODE_ENV === "development"`.
`pnpm dev` serves no service worker — offline behavior, caching, and the install prompt can only be
tested with `pnpm build && pnpm start`. Do not "fix" offline bugs against the
dev server; you are testing nothing. After testing SW changes, bump nothing
manually — Serwist handles SW versioning from the build.

## 4.9 Photo queue ids are client-generated nanoids — idempotency depends on this.

The offline queue (Dexie) assigns each captured photo a nanoid(21) at
capture time. That id is reused as the Blob pathname
(`users/{userId}/photos/{entryId}.webp`, `addRandomSuffix: false`) and becomes
`price_entries.id` when the user confirms. A retry after a dropped connection
therefore overwrites the same blob, and the confirm action **inserts with
`onConflictDoNothing`** so a replay never duplicates the row. Never regenerate
an id on retry; never let the server mint ids for queued items.

## 4.39 `next build` emits no service worker under Turbopack, and does not fail.

Next.js 16 builds with Turbopack by default; `@serwist/next` is a
webpack plugin, so it never runs, `public/sw.js` is never written, and the
build reports success — the only sign is one warning on stderr among Next's
own output. `package.json`'s `build` script is therefore
`next build --webpack`. `pnpm dev` is unaffected: Serwist disables itself in
development, and the warning only fires when it is enabled. When Next drops
webpack support, migrate to `@serwist/turbopack` or Serwist's configurator
mode (`@serwist/next/config` + `@serwist/cli`), not back to a silent no-op.

## 4.40 `@serwist/next`'s precache manifest contains no HTML of ours.

It
globs the build output, which for the App Router is `/_next/static/**` — every
page is server-rendered. The `fallbacks.entries` config therefore pointed at
`/offline` and `/en/offline` URLs that were never precached, and an offline
navigation failed with `ERR_FAILED` instead of rendering the fallback (the
`PrecacheFallbackPlugin` is attached correctly; `matchPrecache` simply found
nothing). Fix: `additionalPrecacheEntries` in `next.config.ts`, one entry per
locale, with a `randomUUID()` revision minted per build so an updated worker
re-fetches them. Adding a locale means adding an entry there *and* in
`src/app/sw.ts`'s `fallbacks` list.

## 4.43 In Vitest, fake `Date` only — never the timers — around Dexie.

fake-indexeddb drives itself on real macrotasks, so `vi.useFakeTimers()` with
its default `toFake` list deadlocks Dexie mid-transaction.
`vi.useFakeTimers({ toFake: ['Date'] })` freezes the clock instead, which is
what makes `nextAttemptAt` assertions exact; advance it with
`vi.setSystemTime()` and drain again rather than waiting on the engine's own
timer. Corollary: do not use `vi.waitFor()` in such a test — with fake timers
installed it advances them, and the frozen clock drifts by its 50 ms polling
interval (this cost one confusing "expected …408000, got …408050").

## 4.44 happy-dom's `FormData` rejects a Blob that has been through IndexedDB.

happy-dom installs its own `Blob`/`FormData` classes, but a Blob
stored in fake-indexeddb comes back as Node's (structuredClone knows nothing
about happy-dom), and `FormData.append` then throws "parameter 2 is not of
type Blob". `src/lib/offline/sync.test.ts` runs in the `node` environment with
three hand-made globals — an EventTarget `window`, an EventTarget `document`
with a `visibilityState`, and a `navigator` whose `onLine` the test controls.

## 4.45 `serwist` already declares the Background Sync `SyncEvent`.

Adding a
local `interface BackgroundSyncEvent` to `ServiceWorkerGlobalScopeEventMap`
is a TS2717 "subsequent property declarations must have the same type" error.
Write `self.addEventListener('sync', (event) => …)` and read `event.tag`.

## 4.46 A Serwist fallback matcher receives the failed request, not a parsed URL.

Its parameter is `HandlerDidErrorCallbackParam` (`request`, `error`,
`event`) — no `url`, unlike a `runtimeCaching` matcher. Parse it yourself:
`const { pathname } = new URL(request.url)`.

## 4.47 Lighthouse 12 has removed the PWA category and the `installable-manifest` audit.

`--only-audits=installable-manifest` returns
an empty `audits` object rather than an error. Installability is asserted in
`tests/e2e/pwa.spec.ts` instead (manifest contract, every icon served,
`/sw.js` served, an offline navigation answered by the fallback).

## 4.48 `src/app/favicon.ico` and `public/favicon.ico` cannot coexist.

Both
claim `/favicon.ico` and Next fails the build with a conflicting-public-file
error. The icon pipeline writes the `public/` one, so the App Router
convention file was deleted; `generateMetadata` declares `/favicon.ico`
explicitly.
