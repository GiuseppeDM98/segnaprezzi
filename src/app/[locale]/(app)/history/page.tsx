import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { listHistoryPage, listHistoryStoreOptions } from '@/lib/services/history';
import { HistoryScreen } from './history-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('history');
  return { title: t('title') };
}

/**
 * The timeline: everything recorded, newest first. The first
 * page is server-rendered; filters and further pages go through the
 * loadHistoryPage action.
 */
export default async function HistoryPage() {
  const user = await requireUser();
  const [firstPage, stores] = await Promise.all([
    listHistoryPage(db, user.id),
    listHistoryStoreOptions(db, user.id),
  ]);

  return <HistoryScreen firstPage={firstPage} stores={stores} />;
}
