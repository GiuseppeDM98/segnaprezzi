import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { listCatalog } from '@/lib/services/catalog';
import { ProductsScreen } from './products-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('products');
  return { title: t('title') };
}

/**
 * The catalog (Spec 05 §5.6). The whole catalog — archived included — is
 * read once; search, category and archived filters run on the client,
 * because a personal catalog is a few hundred rows at most and a round trip
 * per keystroke would only add latency in an aisle with one bar of signal.
 */
export default async function ProductsPage() {
  const user = await requireUser();
  const catalog = await listCatalog(db, user.id, { includeArchived: true });

  return <ProductsScreen catalog={catalog} />;
}
