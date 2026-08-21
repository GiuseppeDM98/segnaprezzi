import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { ReceiptNotFoundError } from '@/lib/errors';
import { getManualEntryContext } from '@/lib/services/capture-context';
import { getReceiptForReview } from '@/lib/services/import-receipt';
import { ReceiptReviewScreen } from './receipt-review-screen';

interface ReceiptReviewPageProps {
  searchParams: Promise<{ receiptId?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('receipt.review');
  return { title: t('title') };
}

/**
 * Receipt review (Spec 07 §8). Unlike the capture review, this screen loads
 * from the server: the extraction lives in the `receipts` row, so a reload —
 * or opening the link on another device — resumes the same import instead of
 * losing it. Resolution re-runs on every load, so an alias learned a minute
 * ago in another tab already applies here.
 */
export default async function ReceiptReviewPage({ searchParams }: ReceiptReviewPageProps) {
  const { receiptId } = await searchParams;
  if (!receiptId) {
    notFound();
  }

  const user = await requireUser();
  const [review, context] = await Promise.all([
    getReceiptForReview(db, user.id, receiptId, Date.now()).catch((error) => {
      if (error instanceof ReceiptNotFoundError) {
        return null;
      }
      throw error;
    }),
    getManualEntryContext(db, user.id),
  ]);

  if (!review) {
    notFound();
  }

  return <ReceiptReviewScreen review={review} stores={context.stores} />;
}
