# Spec 06 — PWA & Offline

> **Status**: Approved · **Last updated**: 2026-08-20
> **Depends on**: Spec 03 (capture pipeline, Dexie queue, `/api/extract`), Spec 05 (UI shell, design tokens)
> **Contract**: [Spec 00 — Overview](./00-overview.md). Nothing here may contradict it.

The promise of this spec: **the app works completely in a supermarket basement
with zero signal**. Capture never blocks on the network. Ever.

---

## 1. Goal & Offline Philosophy

Supermarkets are network dead zones — metal shelving, basements, congested
cells. segnaprezzi is designed around three rules:

1. **Capture is local-first, always.** Taking a photo writes a compressed WebP
   to IndexedDB and returns immediately. No network check, no spinner, no
   "retry" dialog while shopping. The user's hands stay on the cart.
2. **Sync is background.** A sync engine drains the queue whenever
   connectivity allows — on app start, on reconnect, on tab focus, and (where
   supported) even after the tab is closed via the Background Sync API. The
   user never triggers sync manually except to retry a hard failure.
3. **The user never waits on the network to keep shopping.** Every screen
   renders something useful offline: the Scan screen captures, the Review
   screen shows whatever has been extracted so far, the Dashboard shows the
   last cached index with an honest "data as of…" banner.

What is intentionally **not** offline-capable in v1: authentication (login
requires network), AI extraction (server-side Claude call), and the initial
dashboard data fetch on a cold cache. Everything downstream of a photo capture
degrades gracefully instead of failing.

### Files created or modified by this spec

| Path | Purpose |
|---|---|
| `next.config.ts` | Wrap config with `@serwist/next` |
| `src/app/sw.ts` | Service worker source (Serwist) |
| `public/sw.js` | Generated at build time — **gitignored** |
| `src/app/manifest.ts` | Web app manifest |
| `src/app/[locale]/offline/page.tsx` | Offline fallback page (static, precached) |
| `src/app/[locale]/layout.tsx` | Icons/appleWebApp metadata, dual theme-color viewport, mounts PWA providers |
| `scripts/generate-icons.ts` | Icon pipeline (sharp) |
| `public/icons/*`, `public/favicon.ico`, `public/apple-touch-icon.png` | Generated icons — **committed** |
| `src/lib/offline/sync.ts` | Sync engine (state machine, triggers, backoff) |
| `src/lib/offline/sync.test.ts` | Unit tests (fake timers + fake-indexeddb) |
| `src/lib/offline/use-queue-status.ts` | Live queue status hook |
| `src/lib/offline/use-online-status.ts` | Connectivity hook |
| `src/lib/offline/use-pwa-install.ts` | Install prompt hook |
| `src/lib/offline/db.ts` | *Modified*: Dexie **version 2** migration — adds `nextAttemptAt` + `lastErrorMessage` to `pendingPhotos` and the new `syncMeta` table (base schema owned by Spec 03) |
| `src/components/pwa/sw-provider.tsx` | Manual SW registration + update toast wiring |
| `src/components/pwa/install-sheet.tsx` | Custom install CTA sheet (Android/desktop) |
| `src/components/pwa/ios-install-sheet.tsx` | iOS share-sheet instructions |
| `tests/e2e/offline.spec.ts` | Playwright offline scenarios |
| `tests/e2e/pwa.spec.ts` | Playwright SW/manifest/fallback scenarios |
| `messages/it.json`, `messages/en.json` | `offline.*` and `pwa.*` keys |

New dependencies: `dexie-react-hooks` (runtime — `dexie` itself is introduced
by Spec 03; this spec adds only the React hooks); `sharp`, `png-to-ico`,
`tsx`, `fake-indexeddb` (dev).

---

## 2. Serwist Setup (Next.js App Router)

### 2.1 `next.config.ts`

```ts
import withSerwistInit from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The SW caches aggressively and fights HMR; PWA behavior is verified
  // against production builds only (`pnpm build && pnpm start`).
  disable: process.env.NODE_ENV === "development",
  // We register manually in SwProvider so we own the update-toast flow
  // (waiting worker -> toast -> SKIP_WAITING -> single controlled reload).
  register: false,
});

const nextConfig: NextConfig = {
  // ...existing config from Spec 01
};

export default withSerwist(withNextIntl(nextConfig));
```

Add to `.gitignore` (build artifacts, regenerated on every build):

```
public/sw.js
public/sw.js.map
```

### 2.2 `src/app/sw.ts` — full skeleton

```ts
/// <reference lib="webworker" />

/*
 * Service worker for segnaprezzi.
 *
 * Strategy summary (see Spec 06 §2.3):
 * - Build assets are precached (self.__SW_MANIFEST, injected by @serwist/next).
 * - Pages: NetworkFirst with a 3s timeout — fresh when possible, instant
 *   from cache in the basement, locale-aware /offline fallback when neither.
 * - /api/*: NetworkOnly — authed, per-user data must never land in a cache
 *   shared with the next browser profile user.
 * - Vercel Blob photo thumbnails: StaleWhileRevalidate, LRU-capped at 50.
 *
 * skipWaiting is deliberately NOT automatic: a new SW activating mid-session
 * would break lazy-loaded chunks. The page shows an update toast and posts
 * SKIP_WAITING only when the user accepts (Spec 06 §8).
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";
import { drainPendingPhotos } from "@/lib/offline/sync";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Authed per-user data: never cache. Must come before the page rule.
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // Photo thumbnails from Vercel Blob: sub-hosts follow the pattern
    // <store-id>.public.blob.vercel-storage.com. LRU 50 keeps the cache
    // near ~2 MB (thumbnails, not originals).
    {
      matcher: ({ url }) =>
        url.hostname.endsWith(".public.blob.vercel-storage.com"),
      handler: new StaleWhileRevalidate({
        cacheName: "segnaprezzi-photos-v1",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            maxAgeFrom: "last-used",
          }),
        ],
      }),
    },
    // App pages: try network for 3s, fall back to the cached copy.
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "segnaprezzi-pages-v1",
        networkTimeoutSeconds: 3,
      }),
    },
    // Hashed build assets are immutable by construction.
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: "segnaprezzi-static-v1" }),
    },
    ...defaultCache,
  ],
  // Serwist precaches fallback entry URLs automatically. Entries are matched
  // in order: the /en check must precede the catch-all Italian default,
  // which is served UNPREFIXED at /offline (localePrefix "as-needed").
  // WARNING: adding a locale requires adding a fallback entry here AND
  // creating its /[locale]/offline page (Spec 06 §2.4).
  fallbacks: {
    entries: [
      {
        url: "/en/offline",
        matcher: ({ request, url }) =>
          request.destination === "document" &&
          (url.pathname === "/en" || url.pathname.startsWith("/en/")),
      },
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

// Update flow: the page posts SKIP_WAITING only after the user taps
// "Aggiorna" in the update toast (never automatically).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Background Sync (progressive enhancement, Chromium-only): drain the photo
// queue even if the user closed the tab before regaining signal. The drain
// is idempotent and mutex-guarded, so overlap with a page-driven drain is
// harmless (Spec 06 §5.4).
self.addEventListener("sync", (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag === "segnaprezzi-photo-sync") {
    syncEvent.waitUntil(drainPendingPhotos());
  }
});

serwist.addEventListeners();
```

Notes for the implementer:

- `drainPendingPhotos` is imported into the SW bundle; it pulls Dexie in
  (~25 KB gzipped) which is acceptable. Dexie works in worker scopes.
- Same-origin `fetch("/api/extract", …)` from the SW sends session cookies by
  default (`credentials: "same-origin"`), so authenticated background drains
  work without extra plumbing.
- `SyncEvent` is not in the default TS lib; either add a minimal local type
  declaration or use the one shipped by `serwist`.

### 2.3 Runtime caching strategies (authoritative table)

| Requests | Strategy | Cache name | Limits | Why |
|---|---|---|---|---|
| Build assets (precache manifest) | Precache | Serwist-managed | Cleaned on SW update | Instant shell offline |
| `request.mode === "navigate"` (pages) | NetworkFirst, 3 s timeout | `segnaprezzi-pages-v1` | — | Fresh when online; instant cached page on flaky signal; `/offline` fallback when neither |
| `/api/*` same-origin | NetworkOnly | — | — | Authed per-user data; caching it risks cross-user leaks on shared devices and stale money data |
| `*.public.blob.vercel-storage.com` (photo thumbnails) | StaleWhileRevalidate | `segnaprezzi-photos-v1` | LRU `maxEntries: 50`, 30 days from last use | Review/history thumbnails load instantly; bounded storage |
| `/_next/static/*` | CacheFirst | `segnaprezzi-static-v1` | — | Content-hashed, immutable |
| Everything else (fonts, images, …) | `defaultCache` from `@serwist/next/worker` | Serwist defaults | Serwist defaults | Sensible defaults for Next.js apps |

When a strategy or its limits change, bump the cache name suffix (`-v1` →
`-v2`); old named caches are orphaned, so the SW `activate` step in Serwist
plus the new precache cleanup will not remove them — delete renamed runtime
caches explicitly in an `activate` listener when bumping.

### 2.4 Offline fallback route (locale-aware)

`/offline` is a technical route, not part of the product route map in Spec 00
§9. One page per locale, so the fallback is in the user's language:

- `src/app/[locale]/offline/page.tsx` → served at `/offline` (Italian
  default, unprefixed per Spec 01's `localePrefix: "as-needed"`) and
  `/en/offline`, both precached by the `fallbacks` config above.

Requirements:

- **Public route**: `/offline` is listed in Spec 02 §5.6's
  `PUBLIC_PATHNAMES`, so the auth middleware never redirects it to login —
  a fallback page that bounced to `/login` would defeat its purpose offline.

- **Fully static**: no auth, no data fetching, `setRequestLocale(locale)` +
  `generateStaticParams` so next-intl renders it at build time. It must be
  servable from the precache with zero network.
- Content: app icon, `offline.fallbackTitle` ("Sei offline"),
  `offline.fallbackBody` (explains that queued photos are safe and will sync),
  and a retry button (`location.reload()`).
- `robots: { index: false }` in its metadata.

### 2.5 Development vs production

The SW is disabled in dev (`disable` flag). To verify PWA behavior locally:

```bash
pnpm build && pnpm start
# then open http://localhost:3000 — localhost is a secure context, SW installs
```

---

## 3. Web App Manifest

`src/app/manifest.ts` (Next serves it as `/manifest.webmanifest` and injects
the `<link>` automatically):

```ts
import type { MetadataRoute } from "next";

/*
 * The manifest is a single static file, so it cannot be locale-aware:
 * name/description use Italian, the app's default locale. It also accepts
 * only ONE theme/background color pair — we use the light tokens here and
 * handle dark mode with a media-query themeColor pair in the root layout
 * viewport export (Spec 06 §3, "dual theme-color strategy").
 *
 * Color values MUST equal the sRGB hex conversion of the DESIGN.md
 * background tokens (manifest JSON does not accept oklch()). If Spec 05
 * changed the tokens, update BRAND_COLORS in scripts/generate-icons.ts and
 * the values here together.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "segnaprezzi",
    short_name: "segnaprezzi",
    description:
      "Il tuo indice di inflazione personale: fotografa i segnaprezzi e scopri quanto aumenta davvero la tua spesa.",
    id: "/",
    // start_url is locale-agnostic on purpose: the middleware redirects to
    // the user's locale, so an installed app opens in the right language.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    lang: "it",
    categories: ["finance", "shopping", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
```

### Canonical PWA color values

DESIGN.md (Spec 05) owns the design tokens. The values below are the sRGB hex
conversions this spec was written against; **if DESIGN.md differs, DESIGN.md
wins and this table must be updated**:

| Token | Value | Used in |
|---|---|---|
| Background, light | `#faf7f2` | manifest `background_color` + `theme_color`, light `themeColor` meta |
| Background, dark | `#151310` | dark `themeColor` meta |
| Brand accent | `#EA580C` | maskable/apple icon background (`BRAND_COLORS` in the icon script) |

### Dual theme-color strategy

The manifest carries a single `theme_color`; the browser chrome must still
follow the user's color scheme. In `src/app/[locale]/layout.tsx`:

```ts
import type { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#151310" },
  ],
};
```

Next renders these as two `<meta name="theme-color" media="…">` tags; the
manifest value only applies where the meta tags are absent (e.g. splash
screen generation), which correctly uses the light value.

---

## 4. Icon Pipeline

### 4.1 Source

`docs/assets/logo.svg` — the only icon source of truth. Constraints on the
asset itself: **pure vector paths, no `<text>` elements** (text would depend
on fonts installed on the rendering machine and render differently
everywhere), square viewBox, transparent background.

### 4.2 `scripts/generate-icons.ts`

```ts
/*
 * Renders every PWA icon from docs/assets/logo.svg with sharp.
 *
 * Composition rules:
 * - "any" icons: brand background, logo scaled to 80% (10% padding/side) —
 *   transparent icons look broken on light OS install surfaces.
 * - maskable + apple-touch: brand background, logo scaled to 60% (20%
 *   padding/side) so any platform mask (circle, squircle, rounded square)
 *   never clips the mark. iOS applies its own corner mask, so apple-touch
 *   uses the same padded composition.
 * - favicon.ico: transparent background, logo full-frame, 16/32/48 px.
 *
 * Outputs are COMMITTED to the repo so production builds never need sharp.
 * Re-run with `pnpm icons` whenever logo.svg or BRAND_COLORS change.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const LOGO_PATH = "docs/assets/logo.svg";
const ICONS_DIR = "public/icons";

// Keep in sync with the color table in docs/specs/06-pwa-offline.md §3.
const BRAND_COLORS = { background: "#EA580C" };

const FAVICON_SIZES = [16, 32, 48];

interface IconTarget {
  outputPath: string;
  size: number;
  logoScale: number;
}

const ICON_TARGETS: IconTarget[] = [
  { outputPath: `${ICONS_DIR}/icon-192.png`, size: 192, logoScale: 0.8 },
  { outputPath: `${ICONS_DIR}/icon-512.png`, size: 512, logoScale: 0.8 },
  { outputPath: `${ICONS_DIR}/maskable-192.png`, size: 192, logoScale: 0.6 },
  { outputPath: `${ICONS_DIR}/maskable-512.png`, size: 512, logoScale: 0.6 },
  { outputPath: "public/apple-touch-icon.png", size: 180, logoScale: 0.6 },
];

/**
 * Render the logo centered on a solid brand background.
 *
 * @param logoSvg - Raw SVG bytes of docs/assets/logo.svg
 * @param size - Output edge in px (square)
 * @param logoScale - Fraction of the edge the logo occupies (0..1)
 * @returns PNG buffer
 */
async function renderIconPng(
  logoSvg: Buffer,
  size: number,
  logoScale: number,
): Promise<Buffer> {
  const logoEdge = Math.round(size * logoScale);
  const logoPng = await sharp(logoSvg)
    .resize(logoEdge, logoEdge, { fit: "contain" })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_COLORS.background,
    },
  })
    .composite([{ input: logoPng, gravity: "center" }])
    .png()
    .toBuffer();
}

async function generateIcons(): Promise<void> {
  const logoSvg = await readFile(LOGO_PATH);
  await mkdir(ICONS_DIR, { recursive: true });

  for (const target of ICON_TARGETS) {
    const png = await renderIconPng(logoSvg, target.size, target.logoScale);
    await writeFile(target.outputPath, png);
  }

  // favicon.ico: multi-size, transparent, logo full-frame.
  const faviconPngs = await Promise.all(
    FAVICON_SIZES.map((size) =>
      sharp(logoSvg).resize(size, size, { fit: "contain" }).png().toBuffer(),
    ),
  );
  await writeFile("public/favicon.ico", await pngToIco(faviconPngs));

  console.log(`Generated ${ICON_TARGETS.length} icons + favicon.ico`);
}

await generateIcons();
```

`package.json`:

```json
{
  "scripts": {
    "icons": "tsx scripts/generate-icons.ts"
  },
  "devDependencies": {
    "sharp": "latest",
    "png-to-ico": "latest",
    "tsx": "latest"
  }
}
```

### 4.3 Wiring icons in the root layout

In `src/app/[locale]/layout.tsx` metadata:

```ts
export const metadata: Metadata = {
  // ...title/description from Spec 05
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "segnaprezzi",
  },
};
```

---

## 5. Sync Engine — `src/lib/offline/sync.ts`

The sync engine is a **client-side module** (Spec 00 §5: `src/lib/offline/*`,
no imports from `next/*`, `db/`, or `services/`). It consumes the Dexie
`pendingPhotos` queue through Spec 03's `src/lib/offline/photo-queue.ts`
primitives and talks to exactly one endpoint: `POST /api/extract`.

### 5.1 Queue contract (owned by Spec 03, restated)

Spec 03 §5.1 defines the Dexie database in `src/lib/offline/db.ts` and the
queue primitives `enqueuePendingPhoto` / `retryFailedPhoto` in
`src/lib/offline/photo-queue.ts`. The `PendingPhoto` record, verbatim:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | **Client-generated nanoid(21) at capture time — the future entry id and the idempotency key** |
| `sessionId` | `string` | Active `shopping_sessions.id` |
| `storeId` | `string?` | Store captured with the session, when known |
| `blob` | `Blob` | Compressed WebP ≤ ~400 KB (Spec 03 compression) |
| `status` | `'queued' \| 'uploading' \| 'extracted' \| 'failed'` | `PendingPhotoStatus` — exactly these four; state machine below |
| `attempts` | `number` | Upload attempts so far |
| `lastError` | `string?` | Short classification code, e.g. `"network"`, `"http_413"`, `"http_401"` |
| `extraction` | `ExtractPhotoResponse?` | Parsed response **object** from `/api/extract` once extracted |
| `createdAt` | `number` | Epoch ms at capture; drain order is oldest-first |

**Idempotency contract (Spec 03):** the client id travels with the request;
the server uses it as the Blob pathname
(`users/{userId}/photos/{entryId}.webp`, overwrite allowed) and nothing is
written to the DB until the user confirms in review — and the confirm action
INSERTs with `onConflictDoNothing`. Therefore **retrying the same photo id is
always safe**: a duplicate upload overwrites the same blob and returns a
fresh extraction — no duplicate entries can ever result from retries.

This spec **extends the schema with a Dexie version 2 migration** in
`src/lib/offline/db.ts`:

- `pendingPhotos` gains two fields:
  - `nextAttemptAt: number | null` — epoch ms gate for backoff; `null` = due
    now (records created before the migration are treated as due);
  - `lastErrorMessage: string | null` — human-readable detail for the
    failed-item UI (`lastError` keeps the short classification code).
- New `syncMeta` table — key-value (`key: string` PK, `value: unknown`).
  Single key used in v1: `lastSyncAt` (epoch ms of the last successful
  extraction).

`sync.ts` **wraps** the `photo-queue.ts` primitives — it never redefines an
enqueue/retry API of its own (§5.5).

### 5.2 State machine

```
                  enqueuePendingPhoto()
                          │
                          ▼
                     ┌─────────┐  drain picks due item     ┌───────────┐
        ┌───────────▶│ queued  │──────────────────────────▶│ uploading │
        │            └─────────┘     attempts += 1         └─────┬─────┘
        │                 ▲                                      │
        │  backoff wait   │                     ┌────────────────┼────────────────┐
        │  (1/2/4/8/16 s) │                     │                │                │
        │                 │              2xx + valid JSON   retryable error  non-retryable
        │                 │                     │           & attempts < 5   error, or
        │                 │                     ▼                │           attempts = 5
        │                 └─────────────────────┼────────────────┘                │
        │                                       ▼                                 ▼
        │                                 ┌───────────┐                     ┌──────────┐
        │                                 │ extracted │                     │  failed  │
        │                                 └─────┬─────┘                     └────┬─────┘
        │                                       │ review confirm/discard        │
        │                                       ▼ (Spec 03 deletes record)      │
        │                                    (deleted)                          │
        └───────────────────────────────────────────────────────────────────────┘
                                retryFailedPhoto() — manual, resets attempts
```

Transition rules:

| From → To | Trigger | Side effects |
|---|---|---|
| — → `queued` | `enqueuePendingPhoto()` (Spec 03, capture flow) | `attempts: 0`, `nextAttemptAt: null`; the engine's enqueue hook (§5.3) registers Background Sync and kicks a drain if online |
| `queued` → `uploading` | Drain picks a due item (`nextAttemptAt` is `null` or ≤ now), max 2 in flight | `attempts += 1` |
| `uploading` → `extracted` | `POST /api/extract` returns 2xx with a valid extraction payload | Store the parsed `ExtractPhotoResponse` object in `extraction`; clear error fields; set `syncMeta.lastSyncAt = now`; live query notifies the Review screen |
| `uploading` → `queued` | Retryable error and `attempts < 5` | `nextAttemptAt = now + RETRY_DELAYS_MS[attempts - 1]`; store error fields |
| `uploading` → `failed` | Non-retryable error (any attempt), or retryable error at `attempts === 5` | Store error fields; surfaced in UI with a manual retry button |
| `failed` → `queued` | `retryFailedPhoto(photoId?)` (Spec 03, re-exported here) | Reset `attempts: 0`, `nextAttemptAt: null`, clear errors; kick drain |
| `uploading` → `queued` | **Crash recovery**: `startSyncEngine()` resets **every** `uploading` record at startup, unconditionally | `uploading` cannot legitimately survive a restart — the request died with the page. `attempts` is kept (the dead attempt counts) |
| `extracted` → deleted | Review confirm or discard (Spec 03) | Record removed, freeing the blob (§5.6) |

**Backoff schedule** (deterministic — no jitter; a single client with
concurrency 2 has no thundering-herd problem, and determinism keeps the fake
timer tests exact):

```ts
// Delays applied after failed attempt N (1-indexed). Attempt 6 never happens.
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const MAX_ATTEMPTS = 5;
```

**Error classification** (identical wording in Spec 03):

| Class | Errors | Handling |
|---|---|---|
| Retryable | HTTP 408, 429, ≥500, network errors (fetch `TypeError`), and the 30 s `AbortController` timeout per request | Backoff and retry up to 5 attempts |
| Non-retryable | Any other 4xx (400, 401, 403, 404, 413, 422, …) | → `failed` immediately. 401 sets `lastError: "http_401"` — the failed-item UI tells the user to sign in again, then use manual retry |

### 5.3 Triggers

The engine drains the queue on every plausible connectivity opportunity:

1. **App start** — `startSyncEngine()` called once from the client provider
   mounted in `src/app/[locale]/layout.tsx` (inside `SwProvider`).
2. **`window` `online` event** — signal returns while the app is open.
3. **`visibilitychange` → `visible`** — the user switches back to the tab/app;
   mobile browsers freeze timers in background, so this catches missed windows.
4. **After each `enqueuePendingPhoto()` (Spec 03) when `navigator.onLine`** —
   instant sync on good connectivity; zero perceived queue. The engine
   observes enqueues without wrapping the API: `startSyncEngine()` attaches a
   Dexie `creating` hook to `pendingPhotos`, so the capture flow keeps
   calling Spec 03's primitive directly.
5. **Background Sync API** (progressive enhancement, feature-detected):

```ts
// In the engine's pendingPhotos creating-hook (fires on every
// enqueuePendingPhoto()): ask the browser to drain even if the tab closes
// before signal returns. Chromium-only; everywhere else the four
// page-driven triggers above cover the same ground on next open.
const registration = await navigator.serviceWorker?.ready;
if (registration && "sync" in registration) {
  await registration.sync.register("segnaprezzi-photo-sync");
}
```

The SW `sync` handler (§2.2) calls the same `drainPendingPhotos()`.

### 5.4 Concurrency and mutual exclusion

- **Concurrency 2** inside a drain: at most two `/api/extract` requests in
  flight (a photo is ~400 KB; two parallel uploads saturate a weak uplink
  without starving it). Items are processed oldest-`createdAt`-first.
- **Single drainer** across contexts: the page engine and the SW sync handler
  can both call `drainPendingPhotos()`. The drain body runs inside
  `navigator.locks.request("segnaprezzi-sync", { ifAvailable: true }, …)`
  (Web Locks API — supported in every browser that has Background Sync, and
  in all evergreen browsers). If the lock is taken, the call returns
  immediately: someone is already draining. Where Web Locks is unavailable,
  a module-scoped `isDraining` boolean guards the page context — cross-context
  overlap is then theoretically possible but harmless thanks to idempotent
  ids (§5.1).
- A drain loops until no due `queued` items remain, then schedules a timer for
  the earliest `nextAttemptAt` (if any) and exits.

### 5.5 Public API

`sync.ts` wraps Spec 03's `photo-queue.ts` primitives: queue writes stay
where Spec 03 put them, and this module adds only the engine around them.

```ts
// src/lib/offline/sync.ts

/**
 * Start the sync engine: unconditionally reset 'uploading' records to
 * 'queued' (crash recovery, attempts kept), attach the online and
 * visibilitychange listeners plus the pendingPhotos creating-hook (§5.3),
 * and run an initial drain.
 * Idempotent — subsequent calls return the existing disposer.
 *
 * @returns Disposer that detaches all listeners (used in tests/HMR).
 */
export function startSyncEngine(): () => void;

/**
 * Drain due queued items with concurrency 2 under the "segnaprezzi-sync"
 * Web Lock. Exported for the service worker 'sync' handler; the page uses
 * it through startSyncEngine's triggers.
 */
export function drainPendingPhotos(): Promise<void>;

// Queue writes are Spec 03's API and are NOT redefined here: capture calls
// enqueuePendingPhoto() from photo-queue.ts, and manual retry is Spec 03's
// retryFailedPhoto() (resets attempts, clears errors), re-exported so sync
// consumers have a single import point.
export { retryFailedPhoto } from "./photo-queue";
```

```ts
// src/lib/offline/use-queue-status.ts

/*
 * Live queue status via dexie-react-hooks useLiveQuery — every status
 * change in IndexedDB re-renders subscribers with no polling.
 */
export interface QueueStatus {
  queuedCount: number;
  uploadingCount: number;
  extractedCount: number;
  failedCount: number;
  /** True while anything is queued or uploading — drives the Scan indicator. */
  hasPendingWork: boolean;
  /** Epoch ms of the last successful extraction (syncMeta), null if never. */
  lastSyncAt: number | null;
}

/**
 * Subscribe to queue counters, optionally scoped to one shopping session
 * (the Scan screen passes the active sessionId; global consumers such as
 * the Dashboard cached-data banner pass none).
 */
export function useQueueStatus(sessionId?: string): QueueStatus;
```

### 5.6 Storage pressure

- Photo blobs are the heavy part of the queue (~400 KB each). A record keeps
  its blob through `extracted` — the Review screen needs it for the offline
  thumbnail — and the **entire record is deleted when the user confirms or
  discards the entry in review** (Spec 03). Confirmed entries reference the
  Vercel Blob URL (`price_entries.photo_url`), never IndexedDB.
- On the first enqueue (observed via the engine's creating-hook, §5.3), call
  `navigator.storage.persist()` (best-effort; see §7.3 for why this matters
  on iOS).
- Worst realistic case — a 100-photo shopping trip fully offline — is ~40 MB
  of IndexedDB, far below every browser's quota. No additional eviction logic
  is needed in v1.

---

## 6. Offline UX

All components below are client components using tokens/primitives from
Spec 05.

### 6.1 Global connectivity indicator

The global offline indicator is **Spec 05 §5.13's `OfflineBanner`**
(`src/components/layout/`), rendered by the app shell and shown only while
offline — this spec consumes it and adds no component of its own (no
connectivity chip). It is driven by `useOnlineStatus()`
(`src/lib/offline/use-online-status.ts`, shipped here: `navigator.onLine` +
`online`/`offline` listeners; SSR-safe by defaulting to `true` until mounted).
It appears/disappears with a Motion fade — never a blocking overlay, never a
toast storm on flaky signal. Its strings are Spec 05's `offline.*` keys — no
duplicate key set here.

### 6.2 Scan screen queue status

The Scan screen (Spec 03) renders a one-line status under the photo tray,
composed from `useQueueStatus(activeSessionId)`, joining only the non-zero
parts with `" · "`:

> **3 in coda · 1 in elaborazione**

Failed items add a red segment ("1 non riuscita") and expose per-item retry
in the tray plus a "Riprova tutti" action (→ `retryFailedPhoto()`).

### 6.3 Review screen

`/scan/review` renders **extracted-so-far**: `extracted` items appear as
editable entry cards the moment their status flips (live query — no refresh),
while `queued`/`uploading` items show as skeleton cards with the photo
thumbnail (from the IndexedDB blob) and a progress hint. The user can confirm
extracted entries while others still pend — confirmation is per-batch but
never blocked by pending items.

### 6.4 Dashboard cached-data banner

When offline and showing cached page data, the Dashboard shows a slim banner
under the header: `offline.cachedBanner` with `lastSyncAt` formatted via
next-intl relative time ("aggiornati 2 ore fa"). It links nothing and demands
nothing — it exists so a cached index value is never mistaken for a live one.

### 6.5 i18n keys

Added to `messages/it.json` / `messages/en.json`. The `OfflineBanner`'s own
strings are Spec 05 §5.13's `offline.*` keys and are **not** redefined here;
this spec adds only the keys below:

| Key | it | en |
|---|---|---|
| `offline.queued` | {count} in coda | {count} queued |
| `offline.processing` | {count} in elaborazione | {count} processing |
| `offline.failed` | {count, plural, one {# non riuscita} other {# non riuscite}} | {count} failed |
| `offline.retry` | Riprova | Retry |
| `offline.retryAll` | Riprova tutti | Retry all |
| `offline.cachedBanner` | Sei offline · dati aggiornati {lastSyncTime} | You're offline · data last updated {lastSyncTime} |
| `offline.fallbackTitle` | Sei offline | You're offline |
| `offline.fallbackBody` | Nessun problema: le foto scattate sono al sicuro e verranno elaborate al ritorno del segnale. | No problem: your captured photos are safe and will be processed when the signal returns. |
| `offline.fallbackRetry` | Riprova | Try again |
| `pwa.install.cta` | Installa l'app | Install the app |
| `pwa.install.title` | Porta segnaprezzi con te | Take segnaprezzi with you |
| `pwa.install.body` | Installala per aprirla come un'app e scattare anche senza segnale. | Install it to open like an app and capture even with no signal. |
| `pwa.install.notNow` | Non ora | Not now |
| `pwa.install.iosTitle` | Aggiungi alla schermata Home | Add to Home Screen |
| `pwa.install.iosStep1` | Tocca il pulsante Condividi in Safari | Tap the Share button in Safari |
| `pwa.install.iosStep2` | Scegli "Aggiungi alla schermata Home" | Choose "Add to Home Screen" |
| `pwa.install.iosStep3` | Tocca "Aggiungi" | Tap "Add" |
| `pwa.install.iosWarning` | Senza installazione, Safari può cancellare le foto in coda dopo 7 giorni di inutilizzo. | Without installing, Safari may delete queued photos after 7 days of inactivity. |
| `pwa.update.title` | Nuova versione disponibile | New version available |
| `pwa.update.action` | Aggiorna | Update |
| `pwa.update.later` | Più tardi | Later |

---

## 7. Install Experience

### 7.1 `beforeinstallprompt` capture (Android / desktop Chromium)

`src/lib/offline/use-pwa-install.ts`:

```ts
export interface PwaInstallState {
  /** True when a stashed beforeinstallprompt event can be replayed. */
  canInstall: boolean;
  /** True when running installed (display-mode: standalone or iOS standalone). */
  isStandalone: boolean;
  /** True on iPhone/iPad Safari, where no install prompt API exists. */
  isIos: boolean;
  /** Replay the stashed prompt; resolves with the user's choice. */
  promptInstall(): Promise<"accepted" | "dismissed">;
}

export function usePwaInstall(): PwaInstallState;
```

A module-level listener (attached by `SwProvider`) calls `preventDefault()` on
`beforeinstallprompt` and stashes the event; `promptInstall()` replays it.

### 7.2 Where and when the CTA appears

| Surface | Condition | Behavior |
|---|---|---|
| **Settings row** (`/settings`) | `!isStandalone` and (`canInstall` or `isIos`) | Always available, zero pressure: `pwa.install.cta`. Tapping runs `promptInstall()` or opens the iOS sheet |
| **After first completed session** | Session status flips to `completed` for the first time ever, `!isStandalone`, `canInstall` or `isIos` | Bottom sheet (`install-sheet.tsx` / `ios-install-sheet.tsx`) with `pwa.install.title/body`. **Tasteful and dismissible**: "Non ora" closes it |

Nag prevention, tracked in `localStorage`:

- `segnaprezzi.install.lastPromptAt` — the contextual sheet respects a
  **30-day cooldown** after any dismissal.
- `segnaprezzi.install.promptCount` — the contextual sheet appears **at most
  2 times ever**. After that, install lives only in Settings.

The contextual moment is deliberate: right after the first completed session
the user has experienced the core value, and installing unlocks the honest
pitch — full-screen app, reliable offline queue.

### 7.3 iOS

Safari on iOS fires no `beforeinstallprompt`. Detection:

```ts
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS masquerades as macOS
const isStandalone = window.matchMedia("(display-mode: standalone)").matches
  || (navigator as { standalone?: boolean }).standalone === true;
```

When `isIos && !isStandalone`, the CTA opens `ios-install-sheet.tsx`: a
bottom sheet with the three `pwa.install.iosStep*` instructions, each with an
inline glyph (share icon, plus-square), pointing at Safari's share sheet.

**iOS storage eviction warning (important):** Safari evicts all
script-writable storage — IndexedDB included, so the entire photo queue —
after **7 days without user interaction** for non-installed web apps.
Home-screen-installed apps are exempt. Consequences baked into this spec:

- The iOS install sheet includes `pwa.install.iosWarning` so the risk is
  stated where it can be acted on.
- The sync engine requests `navigator.storage.persist()` on the first
  enqueue (best-effort; iOS currently ignores it, but it hardens
  Chromium/Firefox and is future-proof).
- The sync engine's aggressive triggers (§5.3) make a 7-day-old queue
  extremely unlikely in practice: any app open with signal drains it.

---

## 8. Service Worker Update Flow

Registration is manual (`register: false` in §2.1), owned by
`src/components/pwa/sw-provider.tsx` (client component mounted in
`src/app/[locale]/layout.tsx`):

1. On `window` `load`: `navigator.serviceWorker.register("/sw.js")`.
2. **Detect a waiting update**:
   - If `registration.waiting` exists already (update installed on a previous
     visit), show the toast immediately.
   - On `registration.updatefound`, watch the installing worker; when its
     state hits `installed` **and** `navigator.serviceWorker.controller` is
     non-null (i.e. this is an update, not the first install), show the toast.
3. **Toast** (Spec 05 toast primitive): `pwa.update.title` with an
   `pwa.update.action` button and a `pwa.update.later` dismiss. Non-blocking,
   bottom of screen, above the tab bar.
4. **User taps "Aggiorna"**: set a module flag `hasAcceptedUpdate = true`,
   then `registration.waiting.postMessage({ type: "SKIP_WAITING" })`.
5. On `navigator.serviceWorker` `controllerchange`: reload **only if
   `hasAcceptedUpdate`** — `window.location.reload()`, exactly once (guard
   against double `controllerchange`).
6. **Dismiss** keeps the waiting worker parked; the toast re-appears on the
   next app start (no per-session re-nagging).

**Never auto-reload mid-session**: without the `hasAcceptedUpdate` guard, a
background update would reload the page while the user is mid-review — the
cardinal sin this flow exists to prevent. The offline capture path is
unaffected either way (IndexedDB survives reloads), but form state would not.

Update freshness: call `registration.update()` on `visibilitychange` →
`visible` and on a 60-minute interval, so long-lived installed-app sessions
still learn about new deploys.

---

## 9. Testing

### 9.1 Playwright E2E — `tests/e2e/offline.spec.ts`, `tests/e2e/pwa.spec.ts`

The SW only exists in production builds, so the Playwright `webServer` runs
`pnpm build && pnpm start`. Two Playwright projects, because Playwright
cannot intercept requests issued *through* an active service worker:

| Project | Context options | Covers |
|---|---|---|
| `offline-queue` | `serviceWorkers: "block"`, `/api/extract` mocked via `page.route` | Sync engine, Dexie persistence, review flow |
| `pwa` | SW enabled, no route mocks | Precache, offline fallback page, manifest, update flow |

Scenarios (Chromium):

1. **Capture offline** (`offline-queue`): log in with the seeded test user →
   start a session → `context.setOffline(true)` → capture two photos (file
   input fixture `tests/e2e/fixtures/price-tag.webp`) → expect the offline
   banner (Spec 05's `OfflineBanner`) and "2 in coda"; **no error UI, no
   spinner blocking further capture**.
2. **Queue persists across reload** (`offline-queue`): still offline, reload
   the page → the queue still shows 2 (IndexedDB survived) and the startup
   `uploading` → `queued` reset leaves no stuck items.
3. **Sync on reconnect** (`offline-queue`): `context.setOffline(false)` →
   mocked `/api/extract` responds with a deterministic extraction → statuses
   flip to extracted → `/scan/review` shows 2 editable entries → confirm →
   entries appear in `/history` and the queue is empty.
4. **Backoff surfaces failure** (`offline-queue`): mock `/api/extract` to
   return 500 five times → item shows as failed with a retry button → mock
   success → tap retry → item extracts.
5. **Offline fallback page** (`pwa`): load the app online (SW installs and
   precaches) → `context.setOffline(true)` → navigate to an uncached route →
   the localized `/offline` page renders (Italian default, unprefixed); same
   check under `/en/…` yields `/en/offline`.
6. **Manifest & installability** (`pwa`): `/manifest.webmanifest` returns the
   §3 contract (name, display, icons incl. maskable); `/sw.js` is served.

### 9.2 Unit tests — `src/lib/offline/sync.test.ts` (Vitest)

Setup: `fake-indexeddb` (registered in the Vitest setup file so Dexie runs in
Node) + `vi.useFakeTimers()` + a mocked `fetch`. Behaviors under test:

- should retry with delays 1s/2s/4s/8s/16s after consecutive retryable
  failures (assert exact timer advances)
- should mark the item failed after the fifth retryable failure
- should mark the item failed immediately on HTTP 422 without scheduling
  a retry
- should unconditionally reset uploading items to queued (attempts kept)
  when the engine starts
- should never run more than 2 uploads concurrently (instrumented fetch mock)
- should reset attempts and re-drain when retryFailedPhoto is called
- should store the extraction object and update syncMeta.lastSyncAt on success
- should issue no fetch when a photo is enqueued while offline

### 9.3 Lighthouse targets

Run against the production build (`pnpm build && pnpm start`, audit
`http://localhost:3000/it` in mobile emulation — Chrome DevTools Lighthouse or
`pnpm dlx lighthouse`):

| Audit | Target |
|---|---|
| PWA installability (manifest + SW + offline response) | Pass |
| Performance (mobile) | ≥ 90 |
| Accessibility | ≥ 95 |

Record the scores in the PR description for the spec-06 milestone.

---

## 10. Definition of Done

- [ ] `pnpm build` emits `public/sw.js`; SW disabled under `pnpm dev`
- [ ] `src/app/sw.ts` implements exactly the §2.3 strategy table; `/api/*` responses never appear in any cache (verify in DevTools → Application → Cache Storage)
- [ ] Airplane-mode navigation to an uncached route renders the localized offline fallback (`/offline` and `/en/offline`)
- [ ] `/manifest.webmanifest` matches §3 (name, `standalone`, `portrait`, 4 PNG icons incl. maskable); install prompt criteria pass in Chrome
- [ ] Dual theme-color metas render and the browser chrome follows light/dark
- [ ] `pnpm icons` regenerates all icons from `docs/assets/logo.svg`; outputs committed; maskable icons pass the safe-zone check on [maskable.app](https://maskable.app)
- [ ] Capturing a photo in airplane mode returns instantly and enqueues; capture is never blocked by network state
- [ ] Queue survives a full app kill + relaunch; `uploading` items recover to `queued` at startup (unconditional reset, `attempts` kept)
- [ ] Reconnecting drains the queue with concurrency 2; backoff follows 1/2/4/8/16 s; 5 failures → `failed` with a working manual retry; non-retryable errors fail fast
- [ ] Background Sync drains a queue after tab close on Chromium; its absence on other browsers changes nothing functionally
- [ ] Retrying an item never produces a duplicate blob or a duplicate entry (idempotent client ids verified in E2E scenario 4)
- [ ] `OfflineBanner` (Spec 05 §5.13), Scan queue status line, Review extracted-so-far rendering, and Dashboard cached-data banner all work in airplane mode; all strings via next-intl (`offline.*`, `pwa.*`) in both locales
- [ ] Install CTA present in Settings; contextual sheet appears after the first completed session, respects the 30-day cooldown and 2-prompt lifetime cap; iOS sheet shows share-sheet steps + eviction warning
- [ ] SW update shows the toast; "Aggiorna" activates + reloads exactly once; dismissing never auto-reloads mid-session
- [ ] All §9.1 Playwright scenarios and §9.2 unit tests pass in CI; Lighthouse targets met and recorded
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all green; code follows `docs/DEVELOPMENT_GUIDELINES.md` and `docs/COMMENTS.md`

---

## Implementation Prompt

```text
You are implementing Spec 06 (PWA & Offline) of segnaprezzi.

Before writing ANY code, read these files completely, in this order:
1. AGENTS.md
2. CLAUDE.md
3. docs/specs/00-overview.md   — the canonical contract (names, money rules, layout)
4. docs/specs/06-pwa-offline.md — THIS spec; implement it fully and exactly
5. docs/DEVELOPMENT_GUIDELINES.md — architecture layers, naming, errors, testing
6. docs/COMMENTS.md            — comment discipline for all code you write

Also skim docs/specs/03-capture-ai.md (Dexie queue + /api/extract
contract this spec consumes) and DESIGN.md (tokens for the PWA colors — if its
background token values differ from Spec 06 §3, use DESIGN.md's values and
update the table in Spec 06 §3).

Then implement Spec 06 in full:
- Serwist wiring (next.config.ts, src/app/sw.ts, locale-aware offline fallback)
- src/app/manifest.ts + dual theme-color viewport + icon metadata
- scripts/generate-icons.ts and the generated icons (run pnpm icons)
- The sync engine (src/lib/offline/sync.ts + hooks) with the exact state
  machine, backoff, concurrency, and triggers from §5
- Offline UX components and i18n keys (§6), install experience (§7),
  SW update toast flow (§8)
- All tests from §9 (Playwright projects + Vitest unit tests)

Work through the Definition of Done checklist (§10) and verify every item.
Run pnpm lint, pnpm typecheck, pnpm test, and the Playwright suite against a
production build; fix everything before finishing. Commit using conventional
commits (small, single-purpose commits, e.g. "feat: add serwist service
worker with offline fallback"). When done, update the "Current status"
section of CLAUDE.md to record that Spec 06 is implemented and note any
deviations you had to make.
```

**Recommended model:** Claude Opus 5
**Recommended effort:** high

**Prerequisites:** Specs 01–05 implemented (hard dependencies per Spec 00 §12: Spec 03 — capture pipeline, Dexie queue, `/api/extract`; Spec 05 — UI shell, toast/sheet primitives, design tokens).
