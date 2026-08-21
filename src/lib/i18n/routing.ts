import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['it', 'en'],
  defaultLocale: 'it',
  // Why: 'as-needed' keeps Italian URLs clean (`/products`, not `/it/products`)
  // while English remains fully addressable under `/en/*`.
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
