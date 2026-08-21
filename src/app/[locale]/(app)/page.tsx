import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getDashboardData } from '@/lib/services/dashboard';
import { DashboardScreen } from './dashboard-screen';

/*
 * Why cache(): Spec 04 §9 asks for per-request memoization of the index
 * computation, and the service deliberately does not import React — so the
 * page, where several server components could share the result, wraps it.
 */
const getDashboardDataCached = cache(getDashboardData);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

/**
 * The dashboard (Spec 05 §5.1): "what is MY inflation?" in one glance,
 * honestly. Server-rendered from the engine; the client half owns the
 * ticker, the ISTAT toggle and the chart interactions.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardDataCached(db, user.id);

  return <DashboardScreen data={data} />;
}
