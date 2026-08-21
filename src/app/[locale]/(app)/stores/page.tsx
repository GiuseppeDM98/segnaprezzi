import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { listStoresWithCounts } from '@/lib/services/stores';
import { StoresScreen } from './stores-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('stores');
  return { title: t('title') };
}

/** Store management, reached from Settings and from the store pickers. */
export default async function StoresPage() {
  const user = await requireUser();
  const stores = await listStoresWithCounts(db, user.id);

  return <StoresScreen stores={stores} />;
}
