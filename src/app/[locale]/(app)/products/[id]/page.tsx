import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { nanoidSchema } from '@/lib/domain/schemas';
import { listHistoryStoreOptions } from '@/lib/services/history';
import { getProductDetail } from '@/lib/services/product-detail';
import { ProductDetailScreen } from './product-detail-screen';

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

/*
 * Why cache(): generateMetadata and the page both need the session and the
 * product, and without it every request would read each of them twice.
 * cache() memoizes per request, by argument — the same pattern as the
 * dashboard page.
 */
const requireUserCached = cache(requireUser);
const getProductDetailCached = cache(getProductDetail);

/**
 * The product id from the URL, or null when it cannot be one. The URL is
 * untrusted input (AGENTS.md §1.8): a malformed id never reaches the service.
 */
async function readProductId(params: ProductPageProps['params']): Promise<string | null> {
  const parsed = nanoidSchema.safeParse((await params).id);
  return parsed.success ? parsed.data : null;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const t = await getTranslations('productDetail');
  const id = await readProductId(params);
  if (!id) {
    return { title: t('notFound') };
  }
  const user = await requireUserCached();
  const detail = await getProductDetailCached(db, user.id, id);
  return { title: detail?.product.name ?? t('notFound') };
}

/**
 * The price story of one product. A product id that is not
 * the user's renders the locale-aware 404 — never a hint that it exists.
 */
export default async function ProductPage({ params }: ProductPageProps) {
  const id = await readProductId(params);
  if (!id) {
    notFound();
  }
  const user = await requireUserCached();
  const [detail, stores] = await Promise.all([
    getProductDetailCached(db, user.id, id),
    listHistoryStoreOptions(db, user.id),
  ]);
  if (!detail) {
    notFound();
  }

  return <ProductDetailScreen detail={detail} stores={stores} />;
}
