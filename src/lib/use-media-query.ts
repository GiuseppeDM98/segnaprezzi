'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query. Server-rendered as `false`, so components
 * that branch on it must render the mobile variant first (mobile-first is
 * also the app's layout rule).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The `tablet:` breakpoint of globals.css (48rem). */
export const TABLET_QUERY = '(min-width: 48rem)';
/** The `rail:` breakpoint of globals.css (64rem). */
export const RAIL_QUERY = '(min-width: 64rem)';
