'use client';

/**
 * Sticky footer of the receipt review (Spec 07 §8.1).
 *
 * Same anatomy as the capture review's confirm bar (Spec 05 §5.3): counters
 * on the left in the print face, the one primary action on the right, and
 * `pb-11` on mobile so the raised Scan disc never covers it (DESIGN.md).
 * Confirm is disabled while any INCLUDED line still lacks a size or a
 * product — an excluded line is a decision, not an obstacle.
 */
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

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
    <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-20 border-border border-t border-dashed bg-surface/95 px-4 pt-3 pb-11 backdrop-blur-sm rail:bottom-0 rail:pb-3">
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
            <span className="font-mono font-semibold text-[17px] text-text tabular-nums">
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
    </div>
  );
}
