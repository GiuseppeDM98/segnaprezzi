import type { MetadataRoute } from 'next';

/*
 * The web app manifest. Next serves it at
 * /manifest.webmanifest and injects the <link> automatically.
 *
 * The manifest is a single static file, so it cannot be locale-aware:
 * name/description use Italian, the app's default locale. It also accepts
 * only ONE theme/background color pair — we use the light tokens here and
 * handle dark mode with a media-query themeColor pair in the root layout
 * viewport export (the "dual theme-color strategy").
 *
 * WARNING: the colors below are the sRGB conversion of the `background`
 * token in src/app/globals.css (manifest JSON cannot express oklch()). When
 * DESIGN.md changes that token, update this file, BRAND_COLORS in
 * scripts/generate-icons.ts, and the viewport themeColor pair in
 * src/app/[locale]/layout.tsx together.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'segnaprezzi',
    short_name: 'segnaprezzi',
    description:
      'Il tuo indice di inflazione personale: fotografa i segnaprezzi e scopri quanto aumenta davvero la tua spesa.',
    id: '/',
    // start_url is locale-agnostic on purpose: the middleware redirects to
    // the user's locale, so an installed app opens in the right language.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf5eb',
    theme_color: '#faf5eb',
    lang: 'it',
    categories: ['finance', 'shopping', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
