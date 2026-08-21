import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { listHistoryStoreOptions } from '@/lib/services/history';
import { getProductDetail } from '@/lib/services/product-detail';
import { ProductDetailScreen } from './product-detail-screen';

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { id } = await params;
  const user = await requireUser();
  const detail = await getProductDetail(db, user.id, id);
  const t = await getTranslations('productDetail');
  return { title: detail?.product.name ?? t('notFound') };
}

/**
 * The price story of one product (Spec 05 §5.7). A product id that is not
 * the user's renders the locale-aware 404 — never a hint that it exists.
 */
export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params;
  const user = await requireUser();
  const [detail, stores] = await Promise.all([
    getProductDetail(db, user.id, id),
    listHistoryStoreOptions(db, user.id),
  ]);
  if (!detail) {
    notFound();
  }

  return <ProductDetailScreen detail={detail} stores={stores} />;
}
