import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getDashboardData } from '@/lib/services/dashboard';
import { DashboardScreen } from './dashboard-screen';

/*
 * Why cache(): per-request memoization of the index
 * computation is wanted, and the service deliberately does not import React — so the
 * page, where several server components could share the result, wraps it.
 */
const getDashboardDataCached = cache(getDashboardData);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

/**
 * The dashboard: "what is MY inflation?" in one glance,
 * honestly. Server-rendered from the engine; the client half owns the
 * ticker, the ISTAT toggle and the chart interactions.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardDataCached(db, user.id);

  // Why a server timestamp: offline the page is served from the SW cache, and
  // this value — baked into that cached HTML — is what the "data as of" banner
  // reads.
  return <DashboardScreen data={data} generatedAt={Date.now()} />;
}
