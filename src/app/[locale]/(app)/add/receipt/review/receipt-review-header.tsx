'use client';

/**
 * The receipt review's header card: store and date, the lines total against
 * the printed total, the difference between them, and the warnings — the
 * live total mismatch with its "which line to check" hint, then the
 * extraction's own header reasons.
 *
 * Design: presentational. The reconciliation is computed by
 * reconcileWithReceiptTotal() in the screen, from the lines as edited, and
 * handed in; this card only decides how each number and warning reads.
 */
import { useLocale, useTranslations } from 'next-intl';

import { type AppLocale, formatMoney } from '@/lib/format';
import type { ReceiptReview } from '@/lib/services/import-receipt';
import type { ReceiptReconciliation } from './receipt-review-derivations';
import { ReceiptStoreDateRows, type ReceiptStoreDateRowsProps } from './receipt-store-date-rows';

export interface ReceiptReviewHeaderProps extends ReceiptStoreDateRowsProps {
  /** Σ line totals of the included lines, as edited. */
  includedTotalCents: number;
  /** The printed total; null when the receipt shows none legible. */
  receiptTotalCents: number | null;
  reconciliation: ReceiptReconciliation;
  /** The header reasons that still stand (see liveHeaderReasons). */
  headerReasons: ReceiptReview['header']['reasons'];
}

const HEADER_REASON_KEY: Record<ReceiptReview['header']['reasons'][number], string> = {
  'total-mismatch': 'totalMismatch',
  'low-confidence': 'lowConfidence',
  'no-total': 'noTotal',
  'no-date': 'noDate',
};

/** Render the header card above the line list. */
export function ReceiptReviewHeader({
  includedTotalCents,
  receiptTotalCents,
  reconciliation,
  headerReasons,
  ...storeDate
}: ReceiptReviewHeaderProps) {
  const t = useTranslations('receipt.review');
  const locale = useLocale() as AppLocale;
  const { totalDifferenceCents, hasTotalMismatch, extraPackages } = reconciliation;

  return (
    <section className="flex flex-col gap-3 rounded-control border border-border bg-surface p-4">
      <dl className="flex flex-col gap-2 font-mono text-[13px] tabular-nums">
        <ReceiptStoreDateRows {...storeDate} />
        <div className="flex items-center justify-between gap-3">
          <dt className="font-sans text-text-muted">{t('linesTotal')}</dt>
          <dd data-testid="receipt-lines-total" className="font-semibold text-text">
            {formatMoney(includedTotalCents, locale)}
          </dd>
        </div>
        {receiptTotalCents !== null && (
          <div className="flex items-center justify-between gap-3">
            <dt className="font-sans text-text-muted">{t('receiptTotal')}</dt>
            <dd className="font-semibold text-text">{formatMoney(receiptTotalCents, locale)}</dd>
          </div>
        )}
        {/* Named rather than left as an exercise: the gap is almost always
            a line the import is right to skip (a trip-level discount, the
            bag levy, a deposit), and seeing the amount is what tells the
            user which. */}
        {totalDifferenceCents !== null && totalDifferenceCents !== 0 && (
          <div className="flex items-center justify-between gap-3">
            <dt className="font-sans text-text-muted">{t('totalDifference')}</dt>
            <dd data-testid="receipt-total-difference" className="text-text-muted">
              {totalDifferenceCents > 0 ? '+' : ''}
              {formatMoney(totalDifferenceCents, locale)}
            </dd>
          </div>
        )}
      </dl>

      {hasTotalMismatch && (
        <p
          data-testid="receipt-header-warning"
          className="rounded-control bg-warning-soft px-3 py-2 font-sans text-[13px] text-text"
        >
          {t('totalMismatch')}
          {/* When the gap is exactly N packages of one line, say which:
              it is the difference between "the numbers don't add up"
              and one tap on that line's stepper. */}
          {extraPackages && (
            <span data-testid="receipt-extra-packages" className="mt-1 block font-semibold">
              {t('totalMismatchExtraPackages', {
                count: extraPackages.packages,
                product: extraPackages.draft.product.label,
              })}
            </span>
          )}
        </p>
      )}

      {headerReasons.map((reason) => (
        <p
          key={reason}
          data-testid="receipt-header-warning"
          className="rounded-control bg-warning-soft px-3 py-2 font-sans text-[13px] text-text"
        >
          {t(HEADER_REASON_KEY[reason])}
        </p>
      ))}
    </section>
  );
}
