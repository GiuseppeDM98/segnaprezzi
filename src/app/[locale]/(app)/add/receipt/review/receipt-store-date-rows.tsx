'use client';

/**
 * The store and date rows of the receipt review's header: which store the
 * import is filed under, and the purchase date the user can correct.
 *
 * Design: rendered as two rows of the header's description list, so it
 * returns a fragment of `<div>`s for the parent `<dl>`. It owns the store
 * label's fallbacks and the date input's conversion to epoch ms; the date
 * itself is the screen's state, because the caption and the confirm read it.
 */
import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { formatDateInputValue, parseDateInputValue } from '@/lib/format';
import type { ReceiptReview } from '@/lib/services/import-receipt';

export interface ReceiptStoreDateRowsProps {
  /** The resolved store's name; null when the import has no store of the user's. */
  storeName: string | null;
  /** What the receipt said about the store, shown when no store was resolved. */
  storeSuggestion: ReceiptReview['header']['storeSuggestion'];
  /** Epoch ms of the purchase. */
  purchasedAt: number;
  onPurchasedAtChange: (purchasedAt: number) => void;
}

/** Render the store label and the editable purchase date. */
export function ReceiptStoreDateRows({
  storeName,
  storeSuggestion,
  purchasedAt,
  onPurchasedAtChange,
}: ReceiptStoreDateRowsProps) {
  const t = useTranslations('receipt.review');

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <dt className="font-sans text-text-muted">{t('store')}</dt>
        <dd className="truncate text-text">
          {storeName ?? storeSuggestion?.chain ?? storeSuggestion?.name ?? t('noStore')}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="font-sans text-text-muted">{t('date')}</dt>
        <dd>
          <Input
            type="date"
            aria-label={t('date')}
            data-testid="receipt-date"
            value={formatDateInputValue(purchasedAt)}
            onChange={(event) => {
              const next = parseDateInputValue(event.target.value);
              if (next !== null) {
                onPurchasedAtChange(next);
              }
            }}
          />
        </dd>
      </div>
    </>
  );
}
