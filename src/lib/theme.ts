/**
 * The theme preference: one plain cookie that the root layout's pre-paint
 * script reads ("dark" | "light"; absent = follow the OS), and the client-side
 * helpers that read and write it.
 *
 * Design: the cookie name lives here once because every reader and writer
 * must agree on it — the Settings screen writes and reads it, and the inline
 * script in src/app/[locale]/layout.tsx reads it before hydration. The helpers touch
 * `document`, so they may only be called in the browser; importing the module
 * on the server for the constant is safe.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Name of the cookie that carries the explicit theme choice. */
export const THEME_COOKIE = 'theme';

const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const THEME_COOKIE_PATTERN = new RegExp(`(?:^|; )${THEME_COOKIE}=(dark|light)`);

/**
 * Read the stored theme choice from `document.cookie`.
 *
 * @returns 'dark' or 'light' when the cookie holds one, otherwise 'system'
 */
export function readThemeCookie(): ThemeChoice {
  const match = document.cookie.match(THEME_COOKIE_PATTERN);
  return (match?.[1] as ThemeChoice | undefined) ?? 'system';
}

/**
 * Persist a theme choice and apply it to the current page.
 *
 * Side effects: writes (or, for 'system', deletes) the theme cookie and
 * toggles the `dark` class on <html>; 'system' resolves the class from the
 * OS preference at call time.
 */
export function applyTheme(next: ThemeChoice): void {
  if (next === 'system') {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not available in Safari; the pre-paint script reads this plain cookie
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', prefersDark);
    return;
  }
  // biome-ignore lint/suspicious/noDocumentCookie: same as above — one plain cookie, read pre-paint
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  document.documentElement.classList.toggle('dark', next === 'dark');
}
