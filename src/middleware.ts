import createMiddleware from 'next-intl/middleware';
import { routing } from '@/lib/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals, and static files (any path with a dot).
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
