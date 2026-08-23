'use client';

/**
 * Sticky footer of the receipt review.
 *
 * Same anatomy as the capture review's confirm bar: counters
 * on the left in the print face, the one primary action on the right, and
 * `pb-11` on mobile so the raised Scan disc never covers it (DESIGN.md).
 * Confirm is disabled while any INCLUDED line still lacks a size or a
 * product — an excluded line is a decision, not an obstacle.
 */
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { StickyActionBar } from '@/components/ui/sticky-action-bar';

export interface ReceiptSummaryBarProps {
  readyCount: number;
  blockedCount: number;
  excludedCount: number;
  /** Pre-formatted sum of the included lines' spend. */
  totalLabel: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
}

export function ReceiptSummaryBar({
  readyCount,
  blockedCount,
  excludedCount,
  totalLabel,
  isSubmitting,
  errorMessage,
  onConfirm,
}: ReceiptSummaryBarProps) {
  const t = useTranslations('receipt.review');

  return (
    <StickyActionBar>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {errorMessage && (
          <p data-testid="receipt-confirm-error" className="font-sans text-[13px] text-negative">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span
              data-testid="receipt-counters"
              className="truncate font-mono text-[11px] text-text-muted uppercase tracking-wide"
            >
              {t('counters', {
                ready: readyCount,
                blocked: blockedCount,
                excluded: excludedCount,
              })}
            </span>
            <span
              data-testid="receipt-total"
              className="font-mono font-semibold text-[17px] text-text tabular-nums"
            >
              {totalLabel}
            </span>
          </div>
          <Button
            onClick={onConfirm}
            isPending={isSubmitting}
            disabled={blockedCount > 0 || readyCount === 0}
            data-testid="receipt-confirm"
            size="lg"
          >
            {t('confirm', { count: readyCount })}
          </Button>
        </div>
      </div>
    </StickyActionBar>
  );
}
