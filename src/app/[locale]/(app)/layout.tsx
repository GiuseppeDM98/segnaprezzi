import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { getSessionUser } from '@/lib/auth/session';
import { redirect } from '@/lib/i18n/navigation';

/**
 * Every route under (app) requires a verified session. The middleware's
 * cookie-presence check (src/middleware.ts) is UX-only optimism; this is
 * the real guard — no protected page renders without a session confirmed
 * server-side. Authenticated routes then share the app
 * shell: tab bar or rail, offline banner, toasts.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getSessionUser();
  if (!user) {
    redirect({ href: '/login', locale });
  }

  return <AppShell>{children}</AppShell>;
}
