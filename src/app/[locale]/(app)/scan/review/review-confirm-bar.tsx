'use client';

/**
 * The review screen's sticky confirm bar: the waiting-for-uploads note, the
 * confirm error, the running total (or how many cards are incomplete) and
 * the confirm button.
 *
 * Design: presentational only. The screen owns the error code, the
 * submitting flag and the confirm itself; this bar only chooses which
 * sentence to show for them.
 */
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { StickyActionBar } from '@/components/ui/sticky-action-bar';
import { type AppLocale, formatMoney } from '@/lib/format';

export interface ReviewConfirmBarProps {
  draftCount: number;
  incompleteCount: number;
  runningTotalCents: number;
  /** Photos still uploading or extracting: confirm waits for them. */
  hasUnfinishedPhotos: boolean;
  /** The last confirm's error code; the local 'INVALID_INPUT' means a card is incomplete. */
  errorCode: string | null;
  isSubmitting: boolean;
  isSuccess: boolean;
  onConfirm: () => void;
}

/** Render the bar under the cards; the screen mounts it only when there are drafts. */
export function ReviewConfirmBar({
  draftCount,
  incompleteCount,
  runningTotalCents,
  hasUnfinishedPhotos,
  errorCode,
  isSubmitting,
  isSuccess,
  onConfirm,
}: ReviewConfirmBarProps) {
  const t = useTranslations('review');
  const locale = useLocale() as AppLocale;

  return (
    <StickyActionBar>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {hasUnfinishedPhotos && (
          <p className="font-sans text-[13px] text-warning">{t('waitingForUploads')}</p>
        )}
        {errorCode && (
          <p data-testid="confirm-error" className="font-sans text-[13px] text-negative">
            {/* The local INVALID_INPUT is the "you still owe me something"
                case, which has a specific instruction; every other code is
                a real failure of the save. */}
            {errorCode === 'INVALID_INPUT' ? t('incompleteError') : t('confirmError')}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
              {incompleteCount > 0
                ? t('incomplete', { count: incompleteCount })
                : t('runningTotal')}
            </span>
            <span className="font-mono font-semibold text-[17px] text-text tabular-nums">
              {formatMoney(runningTotalCents, locale)}
            </span>
          </div>
          <Button
            onClick={onConfirm}
            isPending={isSubmitting}
            /*
             * Not disabled while cards are incomplete, on purpose: a dead
             * button was the whole problem — it withheld both the reason
             * and the way out. Pressing it now walks the user to the first
             * card that is missing something and says what that is.
             */
            disabled={hasUnfinishedPhotos || isSuccess}
            data-testid="confirm-batch"
            size="lg"
          >
            {t('confirmBatch', { count: draftCount })}
          </Button>
        </div>
      </div>
    </StickyActionBar>
  );
}
