import { TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ScreenHeader } from '@/components/layout/screen-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { nanoidSchema } from '@/lib/domain/schemas';
import { ReceiptExtractionStaleError, ReceiptNotFoundError } from '@/lib/errors';
import { getManualEntryContext } from '@/lib/services/capture-context';
import { getReceiptForReview, type ReceiptReview } from '@/lib/services/import-receipt';
import { ReceiptReviewScreen } from './receipt-review-screen';

interface ReceiptReviewPageProps {
  searchParams: Promise<{ receiptId?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('receipt.review');
  return { title: t('title') };
}

/**
 * Receipt review. Unlike the capture review, this screen loads
 * from the server: the extraction lives in the `receipts` row, so a reload —
 * or opening the link on another device — resumes the same import instead of
 * losing it. Resolution re-runs on every load, so an alias learned a minute
 * ago in another tab already applies here.
 */
export default async function ReceiptReviewPage({ searchParams }: ReceiptReviewPageProps) {
  // The query string is untrusted input (AGENTS.md §1.8): a missing or
  // malformed id is a 404 before any service runs.
  const parsedReceiptId = nanoidSchema.safeParse((await searchParams).receiptId);
  if (!parsedReceiptId.success) {
    notFound();
  }
  const receiptId = parsedReceiptId.data;

  const user = await requireUser();
  const [review, context] = await Promise.all([
    loadReview(user.id, receiptId),
    getManualEntryContext(db, user.id),
  ]);

  if (review === 'not-found') {
    notFound();
  }
  if (review === 'stale') {
    return <StaleReceiptReview />;
  }

  return <ReceiptReviewScreen review={review} stores={context.stores} />;
}

/**
 * Load the review, turning the two expected failures into outcomes the page
 * renders. Anything else is a real error and reaches the route boundary.
 *
 * @returns the review; 'not-found' when the receipt is not the user's or was
 *   discarded; 'stale' when its stored extraction no longer parses.
 */
async function loadReview(
  userId: string,
  receiptId: string,
): Promise<ReceiptReview | 'not-found' | 'stale'> {
  try {
    return await getReceiptForReview(db, userId, receiptId, Date.now());
  } catch (error) {
    if (error instanceof ReceiptNotFoundError) {
      return 'not-found';
    }
    if (error instanceof ReceiptExtractionStaleError) {
      return 'stale';
    }
    throw error;
  }
}

/**
 * A receipt whose stored extraction an older version of the app wrote.
 *
 * Why rendered here rather than redirected to /add/receipt: the upload
 * screen has no way to receive a message, so a redirect would drop the user
 * on an empty dropzone with no idea why. Saying it here, with the way out as
 * the one action, is what tells them that uploading the same file again is
 * the fix.
 */
async function StaleReceiptReview() {
  const t = await getTranslations('receipt.review');
  const tErrors = await getTranslations('errors');

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title={t('title')} backHref="/" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4 pb-4">
        <EmptyState
          tone="error"
          icon={<TriangleAlert />}
          title={tErrors('RECEIPT_EXTRACTION_STALE')}
          data-testid="receipt-review-stale"
          action={<Button href="/add/receipt">{t('empty.cta')}</Button>}
        />
      </div>
    </div>
  );
}
