'use client';

/**
 * Client half of the receipt review.
 *
 * Design: the server resolved every line; this screen owns the *corrections*.
 * Drafts live in React state and the stored extraction is never mutated — it
 * is the audit trail that replaces the document the app deliberately does not
 * keep (§5), and it becomes each entry's `ai_raw_json` on confirm.
 *
 * Editing a price or a size re-derives the unit price the way the capture
 * review does, and stops as soon as the user types a unit
 * price by hand — at that point they know something the arithmetic does not.
 *
 * This file is the orchestrator: it owns the drafts, the purchase date and
 * every Server Action call. What each correction produces, and how the lines
 * reconcile with the printed total, lives in receipt-review-derivations.ts;
 * the header card and the line list are their own files beside this one.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { MatchPicker } from '@/components/capture/match-picker';
import { useProductSearch } from '@/components/capture/use-product-search';
import { ScreenHeader } from '@/components/layout/screen-header';
import type { ReceiptLineCardFields } from '@/components/receipt/receipt-line-card';
import { ReceiptSummaryBar } from '@/components/receipt/receipt-summary-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { callAction, describeActionError } from '@/lib/call-action';
import { type AppLocale, formatDate, formatMoney } from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import type { StoreSummary } from '@/lib/services/capture-context';
import type { ReceiptReview } from '@/lib/services/import-receipt';
import { searchProducts } from '../../../products/actions';
import { confirmReceipt, discardReceipt } from './actions';
import { ReceiptLineList } from './receipt-line-list';
import {
  applyFieldsPatch,
  applyProductPick,
  blockingReasonOf,
  type LineDraft,
  liveHeaderReasons,
  type ProductPick,
  recalculateUnitPrice,
  reconcileWithReceiptTotal,
  summarizeLines,
  toConfirmLine,
  toDraft,
} from './receipt-review-derivations';
import { ReceiptReviewHeader } from './receipt-review-header';

export interface ReceiptReviewScreenProps {
  review: ReceiptReview;
  stores: StoreSummary[];
}

export function ReceiptReviewScreen({ review, stores }: ReceiptReviewScreenProps) {
  const t = useTranslations('receipt.review');
  const tErrors = useTranslations('errors');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();

  const [drafts, setDrafts] = useState<LineDraft[]>(() => review.lines.map(toDraft));
  const [purchasedAt, setPurchasedAt] = useState(review.header.purchasedAt);
  const [matchFor, setMatchFor] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const productSearch = useProductSearch(searchProducts);
  // Keyed by line index so a failed confirm can scroll to the card it means.
  const cardRefs = useRef<Record<number, HTMLLIElement | null>>({});

  function updateDraft(index: number, patch: (draft: LineDraft) => LineDraft): void {
    setDrafts((current) => current.map((draft) => (draft.index === index ? patch(draft) : draft)));
  }

  function updateFields(index: number, patch: Partial<ReceiptLineCardFields>): void {
    updateDraft(index, (draft) => applyFieldsPatch(draft, patch));
  }

  function handlePick(index: number, pick: ProductPick): void {
    updateDraft(index, (draft) => applyProductPick(draft, pick, productSearch.searchHits));
  }

  async function handleConfirm(): Promise<void> {
    /*
     * Why the button is not disabled instead (DESIGN.md, and the same call
     * the capture review made): a disabled confirm withholds both the reason
     * and the way out. Pressing it scrolls to the first card that cannot be
     * saved and says what it is missing; the server-side guarantee is
     * unchanged.
     */
    const blocked = includedDrafts.find((draft) => blockingReasonOf(draft) !== null);
    if (blocked) {
      cardRefs.current[blocked.index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setErrorCode('INVALID_INPUT');
      return;
    }

    setIsSubmitting(true);
    setErrorCode(null);
    const result = await callAction(
      'confirmReceipt',
      confirmReceipt({
        receiptId: review.receiptId,
        storeId: review.header.storeId,
        newStore: null,
        purchasedAt,
        lines: includedDrafts.map(toConfirmLine),
      }),
    );
    setIsSubmitting(false);

    if (!result.ok) {
      setErrorCode(result.error.code);
      return;
    }
    toast({ kind: 'success', message: t('saved', { count: result.data.entryIds.length }) });
    router.push('/history');
  }

  async function handleDiscard(): Promise<void> {
    const result = await callAction(
      'discardReceipt',
      discardReceipt({ receiptId: review.receiptId }),
    );
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, t('discardError')),
      });
      return;
    }
    toast({ kind: 'info', message: t('discarded') });
    router.push('/');
  }

  const { includedDrafts, readyCount, blockedCount, excludedCount, includedTotalCents } =
    summarizeLines(drafts);
  const reconciliation = reconcileWithReceiptTotal(review.header.receiptTotalCents, includedDrafts);
  const activeMatchDraft = drafts.find((draft) => draft.index === matchFor) ?? null;
  const storeName = stores.find((store) => store.id === review.header.storeId)?.name ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title={t('title')}
        backHref="/"
        caption={t('caption', { count: drafts.length, date: formatDate(purchasedAt, locale) })}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4 pb-4">
        <ReceiptReviewHeader
          storeName={storeName}
          storeSuggestion={review.header.storeSuggestion}
          purchasedAt={purchasedAt}
          onPurchasedAtChange={setPurchasedAt}
          includedTotalCents={includedTotalCents}
          receiptTotalCents={review.header.receiptTotalCents}
          reconciliation={reconciliation}
          headerReasons={liveHeaderReasons(review.header.reasons)}
        />

        {drafts.length === 0 ? (
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            data-testid="receipt-review-empty"
            action={<Button href="/add/receipt">{t('empty.cta')}</Button>}
          />
        ) : (
          <ReceiptLineList
            drafts={drafts}
            sameDayByLineIndex={review.sameDayByLineIndex}
            registerCard={(index, element) => {
              cardRefs.current[index] = element;
            }}
            onChange={updateFields}
            onRecalculateUnitPrice={(index) => updateDraft(index, recalculateUnitPrice)}
            onOpenMatch={setMatchFor}
            onToggleExcluded={(index) =>
              updateDraft(index, (current) => ({ ...current, isExcluded: !current.isExcluded }))
            }
            onToggleLearnAlias={(index, shouldLearnAlias) =>
              updateDraft(index, (current) => ({ ...current, shouldLearnAlias }))
            }
          />
        )}

        <Button variant="ghost" onClick={() => void handleDiscard()} data-testid="receipt-discard">
          {t('discard')}
        </Button>
      </div>

      {drafts.length > 0 && (
        <ReceiptSummaryBar
          readyCount={readyCount}
          blockedCount={blockedCount}
          excludedCount={excludedCount}
          totalLabel={formatMoney(includedTotalCents, locale)}
          isSubmitting={isSubmitting}
          errorMessage={errorCode ? tErrors(errorCode) : null}
          onConfirm={() => void handleConfirm()}
        />
      )}

      {activeMatchDraft && (
        <MatchPicker
          isOpen={matchFor !== null}
          onClose={() => setMatchFor(null)}
          suggestions={activeMatchDraft.suggestions}
          selectedProductId={
            activeMatchDraft.product.kind === 'existing' ? activeMatchDraft.product.productId : null
          }
          isNewSelected={activeMatchDraft.product.kind === 'new'}
          newProductName={activeMatchDraft.product.label}
          onPick={(pick) => handlePick(activeMatchDraft.index, pick)}
          onSearch={productSearch.searchProducts}
        />
      )}
    </div>
  );
}
