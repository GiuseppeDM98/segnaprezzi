/**
 * Middleware = auth gate + i18n, in that order.
 *
 * Design: the auth check here is OPTIMISTIC — it only tests session-cookie
 * presence (getSessionCookie does no DB or crypto work, so this stays
 * edge-cheap). Its job is UX: anonymous visitors never see a flash of the
 * app shell. The real enforcement is requireUser() in every server entry
 * point; a forged cookie passes the middleware and then dies there.
 */
import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { routing } from '@/lib/i18n/routing';

const handleI18n = createMiddleware(routing);

// Locale-stripped pathnames reachable without a session. /offline is the
// service worker's precached fallback page — an auth-free static
// page that must render without a session cookie.
const PUBLIC_PATHNAMES = new Set(['/login', '/signup', '/offline']);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Normalize away the locale prefix so the allowlist matches
  // /login, /it/login, and /en/login alike.
  const localeMatch = pathname.match(/^\/(it|en)(?=\/|$)/);
  const pathnameWithoutLocale = localeMatch
    ? pathname.slice(localeMatch[0].length) || '/'
    : pathname;

  if (!PUBLIC_PATHNAMES.has(pathnameWithoutLocale) && !getSessionCookie(request)) {
    // Preserve the visitor's locale in the redirect. localePrefix is
    // 'as-needed', so the default locale stays unprefixed — the redirect
    // target must be a URL the i18n middleware considers canonical.
    const locale = localeMatch?.[1] ?? routing.defaultLocale;
    const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
    const loginUrl = new URL(`${prefix}/login`, request.url);
    loginUrl.searchParams.set('redirectTo', pathnameWithoutLocale);
    return NextResponse.redirect(loginUrl);
  }

  return handleI18n(request);
}

export const config = {
  // Skip API routes (they self-authenticate via requireUser), Next internals,
  // and static files. Must stay a superset of the i18n middleware's matcher.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
