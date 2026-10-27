'use client';

/**
 * The receipt review's list of lines: one ReceiptLineCard per draft, with
 * every label the card needs already formatted.
 *
 * Design: the list owns the translation from a draft to the card's props —
 * live status, blocking reason, money and unit labels, the "already recorded
 * today" hint — and nothing else. Every correction goes back to the screen
 * through callbacks keyed by line index, and the screen keeps the card
 * elements (via `registerCard`) so confirm can scroll to the first line that
 * cannot be saved.
 */
import { useLocale, useTranslations } from 'next-intl';

import type { ReceiptLineCardFields } from '@/components/receipt/receipt-line-card';
import { ReceiptLineCard } from '@/components/receipt/receipt-line-card';
import { SIZE_UNIT_KEY } from '@/lib/domain/units';
import { type AppLocale, formatMoney } from '@/lib/format';
import type { ReceiptReview } from '@/lib/services/import-receipt';
import {
  blockingReasonOf,
  computeLiveStatus,
  type LineDraft,
  lineTotalCents,
} from './receipt-review-derivations';

export interface ReceiptLineListProps {
  drafts: LineDraft[];
  /** What the user already recorded today, by line index. */
  sameDayByLineIndex: ReceiptReview['sameDayByLineIndex'];
  /** Receives each card's element on mount and null on unmount. */
  registerCard: (index: number, element: HTMLLIElement | null) => void;
  onChange: (index: number, patch: Partial<ReceiptLineCardFields>) => void;
  onRecalculateUnitPrice: (index: number) => void;
  onOpenMatch: (index: number) => void;
  onToggleExcluded: (index: number) => void;
  onToggleLearnAlias: (index: number, shouldLearnAlias: boolean) => void;
}

/** Render one card per receipt line, in receipt order. */
export function ReceiptLineList({
  drafts,
  sameDayByLineIndex,
  registerCard,
  onChange,
  onRecalculateUnitPrice,
  onOpenMatch,
  onToggleExcluded,
  onToggleLearnAlias,
}: ReceiptLineListProps) {
  const tUnits = useTranslations('units');
  const tDetail = useTranslations('productDetail');
  const locale = useLocale() as AppLocale;

  return (
    <ul className="flex flex-col gap-4">
      {drafts.map((draft) => {
        const sameDay = sameDayByLineIndex[draft.index];
        return (
          <li
            key={draft.index}
            ref={(node) => {
              registerCard(draft.index, node);
            }}
          >
            <ReceiptLineCard
              data-testid="receipt-line-card"
              rawLine={draft.rawLine}
              mergedLineCount={draft.mergedLineCount}
              status={computeLiveStatus(draft)}
              blockingReason={draft.isExcluded ? null : blockingReasonOf(draft)}
              reviewReasons={draft.reviewReasons}
              fields={draft.fields}
              product={draft.product}
              sameDay={
                sameDay
                  ? {
                      price: formatMoney(sameDay.totalPriceCents, locale),
                      source: tDetail(`source.${sameDay.source}`),
                    }
                  : null
              }
              isExcluded={draft.isExcluded}
              shouldLearnAlias={draft.shouldLearnAlias}
              unitSymbol={tUnits(`perBase.${draft.fields.unitKind}`)}
              sizeSymbol={tUnits(SIZE_UNIT_KEY[draft.fields.unitKind])}
              packagePriceLabel={formatMoney(draft.fields.totalPriceCents, locale)}
              lineTotalLabel={formatMoney(lineTotalCents(draft), locale)}
              onChange={(patch) => onChange(draft.index, patch)}
              onRecalculateUnitPrice={() => onRecalculateUnitPrice(draft.index)}
              onOpenMatch={() => onOpenMatch(draft.index)}
              onToggleExcluded={() => onToggleExcluded(draft.index)}
              onToggleLearnAlias={(shouldLearnAlias) =>
                onToggleLearnAlias(draft.index, shouldLearnAlias)
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
