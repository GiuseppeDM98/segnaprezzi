import { randomUUID } from 'node:crypto';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Why: the request config lives under src/lib/i18n, not the plugin's default
// src/i18n, so the path must be passed explicitly.
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

/*
 * The precache manifest @serwist/next injects covers /_next/static assets
 * only — App Router pages are rendered by the server, so no HTML of ours is
 * in it. The offline fallback must be precached explicitly, or the service
 * worker has nothing to serve when a navigation fails, and the two locale
 * variants are separate documents.
 *
 * A fresh revision per build is deliberate: it is what makes an updated
 * worker re-fetch the fallback instead of keeping the previous deploy's copy.
 * WARNING: adding a locale means adding its /<locale>/offline entry here as
 * well as in the `fallbacks` list in src/app/sw.ts.
 */
const offlineFallbackRevision = randomUUID();

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  additionalPrecacheEntries: [
    { url: '/offline', revision: offlineFallbackRevision },
    { url: '/en/offline', revision: offlineFallbackRevision },
  ],
  // The SW caches aggressively and fights HMR; PWA behavior is verified
  // against production builds only (`pnpm build && pnpm start`).
  disable: process.env.NODE_ENV === 'development',
  // We register manually in SwProvider so we own the update-toast flow
  // (waiting worker → toast → SKIP_WAITING → single controlled reload).
  register: false,
});

const nextConfig: NextConfig = {
  // Why: `next dev` otherwise appends a generated block to AGENTS.md on
  // every run — this repo's AGENTS.md is a hand-maintained project contract,
  // not a file for Next.js to rewrite.
  agentRules: false,
};

export default withSerwist(withNextIntl(nextConfig));
