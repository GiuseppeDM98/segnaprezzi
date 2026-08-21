/// <reference lib="webworker" />

/*
 * Service worker for segnaprezzi (Spec 06 §2.2).
 *
 * Strategy summary (Spec 06 §2.3):
 * - Build assets are precached (self.__SW_MANIFEST, injected by @serwist/next).
 * - Pages: NetworkFirst with a 3 s timeout — fresh when possible, instant
 *   from cache in the basement, locale-aware /offline fallback when neither.
 * - /api/*: NetworkOnly — authed, per-user data must never land in a cache
 *   shared with the next browser profile user.
 * - Vercel Blob photo thumbnails: StaleWhileRevalidate, LRU-capped at 50.
 *
 * skipWaiting is deliberately NOT automatic: a new SW activating mid-session
 * would break lazy-loaded chunks. The page shows an update toast and posts
 * SKIP_WAITING only when the user accepts (Spec 06 §8).
 */
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';

import { drainPendingPhotos, PHOTO_SYNC_TAG } from '@/lib/offline/sync';

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
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
    // Photo thumbnails from Vercel Blob: sub-hosts follow the pattern
    // <store-id>.public.blob.vercel-storage.com. LRU 50 keeps the cache
    // near ~2 MB (thumbnails, not originals).
    {
      matcher: ({ url }) => url.hostname.endsWith('.public.blob.vercel-storage.com'),
      handler: new StaleWhileRevalidate({
        cacheName: 'segnaprezzi-photos-v1',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            maxAgeFrom: 'last-used',
          }),
        ],
      }),
    },
    // App pages: try network for 3 s, fall back to the cached copy.
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'segnaprezzi-pages-v1',
        networkTimeoutSeconds: 3,
      }),
    },
    // Hashed build assets are immutable by construction.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
      handler: new CacheFirst({ cacheName: 'segnaprezzi-static-v1' }),
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
        url: '/en/offline',
        matcher: ({ request }) => {
          // The fallback matcher is handed the failed request, not a parsed
          // URL, so the locale prefix has to be read off it here.
          const { pathname } = new URL(request.url);
          return (
            request.destination === 'document' &&
            (pathname === '/en' || pathname.startsWith('/en/'))
          );
        },
      },
      {
        url: '/offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

// Update flow: the page posts SKIP_WAITING only after the user taps
// "Aggiorna" in the update toast (never automatically).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// Background Sync (progressive enhancement, Chromium-only): drain the photo
// queue even if the user closed the tab before regaining signal. The drain
// is idempotent and lock-guarded, so overlap with a page-driven drain is
// harmless (Spec 06 §5.4).
self.addEventListener('sync', (event) => {
  if (event.tag === PHOTO_SYNC_TAG) {
    event.waitUntil(drainPendingPhotos());
  }
});

serwist.addEventListeners();
