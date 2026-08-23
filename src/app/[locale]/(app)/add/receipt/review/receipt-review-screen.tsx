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
 */
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

import { type MatchOption, MatchPicker } from '@/components/capture/match-picker';
import { ScreenHeader } from '@/components/layout/screen-header';
import {
  type ReceiptLineBlockingReason,
  ReceiptLineCard,
  type ReceiptLineCardFields,
} from '@/components/receipt/receipt-line-card';
import { ReceiptSummaryBar } from '@/components/receipt/receipt-summary-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { CategoryId } from '@/lib/domain/categories';
import { calculateUnitPriceMilli, isUnitPriceConsistent } from '@/lib/domain/money';
import { type ReceiptLineStatus, suggestExtraPackages } from '@/lib/domain/receipt-lines';
import { RECEIPT_TOTAL_TOLERANCE_CENTS } from '@/lib/domain/receipts';
import type { UnitKind } from '@/lib/domain/units';
import { type AppLocale, formatDate, formatMoney } from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import type { StoreSummary } from '@/lib/services/capture-context';
import type { ReceiptReview } from '@/lib/services/import-receipt';
import { confirmReceipt, discardReceipt, searchProducts } from './actions';
import type { ConfirmReceiptActionInput } from './schema';

interface LineDraft {
  index: number;
  rawLine: string;
  /** How many identical receipt lines this card stands for; 1 when it is alone. */
  mergedLineCount: number;
  reviewReasons: ReceiptReview['lines'][number]['reviewReasons'];
  suggestions: MatchOption[];
  product: LineProduct;
  fields: ReceiptLineCardFields;
  category: CategoryId;
  /**
   * The matcher found candidates but none convincing: the user must pick or
   * accept "new" before this line can be confirmed.
   */
  needsProductDecision: boolean;
  isExcluded: boolean;
  learnAlias: boolean;
  /** True once the user typed a unit price: stops the auto-recompute. */
  isUnitPriceEdited: boolean;
}

type LineProduct =
  | {
      kind: 'existing';
      productId: string;
      label: string;
      brand: string | null;
      isArchived: boolean;
    }
  | { kind: 'new'; label: string; brand: string | null; isArchived: false };

export interface ReceiptReviewScreenProps {
  review: ReceiptReview;
  stores: StoreSummary[];
}

export function ReceiptReviewScreen({ review, stores }: ReceiptReviewScreenProps) {
  const t = useTranslations('receipt.review');
  const tErrors = useTranslations('errors');
  const tUnits = useTranslations('units');
  const tDetail = useTranslations('productDetail');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();

  const [drafts, setDrafts] = useState<LineDraft[]>(() => review.lines.map(toDraft));
  const [purchasedAt, setPurchasedAt] = useState(review.header.purchasedAt);
  const [matchFor, setMatchFor] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const searchHits = useMemo(() => new Map<string, MatchOption>(), []);
  // Keyed by line index so a failed confirm can scroll to the card it means.
  const cardRefs = useRef<Record<number, HTMLLIElement | null>>({});

  function updateDraft(index: number, patch: (draft: LineDraft) => LineDraft): void {
    setDrafts((current) => current.map((draft) => (draft.index === index ? patch(draft) : draft)));
  }

  /** Editing the price or the size re-derives the unit price, unless the user owns it. */
  function updateFields(index: number, patch: Partial<ReceiptLineCardFields>): void {
    updateDraft(index, (draft) => {
      const fields = { ...draft.fields, ...patch };
      const shouldRecompute =
        !draft.isUnitPriceEdited &&
        patch.unitPriceMilli === undefined &&
        fields.totalPriceCents > 0 &&
        fields.packageSize !== null &&
        fields.packageSize > 0;
      return {
        ...draft,
        fields: shouldRecompute
          ? {
              ...fields,
              unitPriceMilli: calculateUnitPriceMilli(
                fields.totalPriceCents,
                fields.packageSize as number,
              ),
            }
          : fields,
        isUnitPriceEdited: draft.isUnitPriceEdited || patch.unitPriceMilli !== undefined,
      };
    });
  }

  function handlePick(index: number, pick: { productId: string } | 'new'): void {
    updateDraft(index, (draft) => {
      if (pick === 'new') {
        return {
          ...draft,
          needsProductDecision: false,
          product: {
            kind: 'new',
            label: draft.product.label,
            brand: draft.product.brand,
            isArchived: false,
          },
        };
      }
      const known =
        draft.suggestions.find((option) => option.productId === pick.productId) ??
        searchHits.get(pick.productId);
      return {
        ...draft,
        needsProductDecision: false,
        product: {
          kind: 'existing',
          productId: pick.productId,
          label: known?.name ?? draft.product.label,
          brand: known?.brand ?? null,
          isArchived: false,
        },
      };
    });
  }

  /**
   * Take the unit price back from the user and re-derive it.
   *
   * The way out of the one blocking reason nobody can fix by arithmetic in
   * their head: a hand-typed unit price that no longer matches the price and
   * the size next to it.
   */
  function recalculateUnitPrice(index: number): void {
    updateDraft(index, (draft) => {
      if (draft.fields.packageSize === null || draft.fields.packageSize <= 0) {
        return draft;
      }
      return {
        ...draft,
        isUnitPriceEdited: false,
        fields: {
          ...draft.fields,
          unitPriceMilli: calculateUnitPriceMilli(
            draft.fields.totalPriceCents,
            draft.fields.packageSize,
          ),
        },
      };
    });
  }

  async function handleSearch(query: string): Promise<MatchOption[]> {
    const result = await searchProducts({ query });
    if (!result.ok) {
      return [];
    }
    const hits = result.data.map((hit) => ({
      productId: hit.id,
      name: hit.name,
      brand: hit.brand,
    }));
    for (const hit of hits) {
      searchHits.set(hit.productId, hit);
    }
    return hits;
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
    const result = await confirmReceipt({
      receiptId: review.receiptId,
      storeId: review.header.storeId,
      newStore: null,
      purchasedAt,
      lines: includedDrafts.map(toConfirmLine),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setErrorCode(result.error.code);
      return;
    }
    toast({ kind: 'success', message: t('saved', { count: result.data.entryIds.length }) });
    router.push('/history');
  }

  async function handleDiscard(): Promise<void> {
    const result = await discardReceipt({ receiptId: review.receiptId });
    if (!result.ok) {
      toast({ kind: 'error', message: t('discardError') });
      return;
    }
    toast({ kind: 'info', message: t('discarded') });
    router.push('/');
  }

  const includedDrafts = drafts.filter((draft) => !draft.isExcluded);
  const blockedCount = includedDrafts.filter((draft) => blockingReasonOf(draft) !== null).length;
  const readyCount = includedDrafts.length - blockedCount;
  const excludedCount = drafts.length - includedDrafts.length;
  const includedTotalCents = includedDrafts.reduce(
    (sum, draft) => sum + draft.fields.totalPriceCents * draft.fields.quantity,
    0,
  );
  const activeMatchDraft = drafts.find((draft) => draft.index === matchFor) ?? null;
  /*
   * The reconciliation the user is actually doing, against the paper in
   * their hand — so it is computed from the lines AS EDITED, not from the
   * extraction as it arrived. That is what lets a correction close the gap:
   * the model read one "PESTO 1,64" line too many, and dropping the
   * confezioni stepper from 7 to 6 has to take the difference to zero, or
   * the number is telling the user nothing they can act on.
   *
   * Signed: negative means the till charged less than the lines add up to.
   */
  const totalDifferenceCents =
    review.header.receiptTotalCents === null
      ? null
      : review.header.receiptTotalCents - includedTotalCents;
  const hasTotalMismatch =
    totalDifferenceCents !== null && Math.abs(totalDifferenceCents) > RECEIPT_TOTAL_TOLERANCE_CENTS;
  // The server's own total-mismatch flag is a snapshot of the extraction; the
  // live one above replaces it, and the rest of the header's reasons stand.
  const headerReasons = review.header.reasons.filter((reason) => reason !== 'total-mismatch');
  const extraPackages =
    totalDifferenceCents === null
      ? null
      : suggestExtraPackages(
          totalDifferenceCents,
          includedDrafts.map((draft) => ({
            key: draft.index,
            packagePriceCents: draft.fields.totalPriceCents,
            quantity: draft.fields.quantity,
          })),
        );
  const extraPackagesDraft = extraPackages
    ? (drafts.find((draft) => draft.index === extraPackages.key) ?? null)
    : null;
  const storeName = stores.find((store) => store.id === review.header.storeId)?.name ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title={t('title')}
        backHref="/"
        caption={t('caption', { count: drafts.length, date: formatDate(purchasedAt, locale) })}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4 pb-4">
        <section className="flex flex-col gap-3 rounded-control border border-border bg-surface p-4">
          <dl className="flex flex-col gap-2 font-mono text-[13px] tabular-nums">
            <div className="flex items-center justify-between gap-3">
              <dt className="font-sans text-text-muted">{t('store')}</dt>
              <dd className="truncate text-text">
                {storeName ??
                  review.header.storeSuggestion?.chain ??
                  review.header.storeSuggestion?.name ??
                  t('noStore')}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="font-sans text-text-muted">{t('date')}</dt>
              <dd>
                <Input
                  type="date"
                  aria-label={t('date')}
                  data-testid="receipt-date"
                  value={toDateInputValue(purchasedAt)}
                  onChange={(event) => {
                    const next = Date.parse(`${event.target.value}T12:00:00`);
                    if (Number.isFinite(next)) {
                      setPurchasedAt(next);
                    }
                  }}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="font-sans text-text-muted">{t('linesTotal')}</dt>
              <dd data-testid="receipt-lines-total" className="font-semibold text-text">
                {formatMoney(includedTotalCents, locale)}
              </dd>
            </div>
            {review.header.receiptTotalCents !== null && (
              <div className="flex items-center justify-between gap-3">
                <dt className="font-sans text-text-muted">{t('receiptTotal')}</dt>
                <dd className="font-semibold text-text">
                  {formatMoney(review.header.receiptTotalCents, locale)}
                </dd>
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
                  it is the difference between "i conti non tornano" and one
                  tap on that line's stepper. */}
              {extraPackagesDraft && (
                <span data-testid="receipt-extra-packages" className="mt-1 block font-semibold">
                  {t('totalMismatchExtraPackages', {
                    count: extraPackages?.packages ?? 0,
                    product: extraPackagesDraft.product.label,
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

        {drafts.length === 0 ? (
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            data-testid="receipt-review-empty"
            action={<Button href="/add/receipt">{t('empty.cta')}</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {drafts.map((draft) => {
              const sameDay = review.sameDayByLineIndex[draft.index];
              return (
                <li
                  key={draft.index}
                  ref={(node) => {
                    cardRefs.current[draft.index] = node;
                  }}
                >
                  <ReceiptLineCard
                    data-testid="receipt-line-card"
                    rawLine={draft.rawLine}
                    mergedLineCount={draft.mergedLineCount}
                    status={liveStatus(draft)}
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
                    learnAlias={draft.learnAlias}
                    unitSymbol={tUnits(`perBase.${draft.fields.unitKind}`)}
                    sizeSymbol={tUnits(SIZE_SYMBOL_KEY[draft.fields.unitKind])}
                    packagePriceLabel={formatMoney(draft.fields.totalPriceCents, locale)}
                    lineTotalLabel={formatMoney(
                      draft.fields.totalPriceCents * draft.fields.quantity,
                      locale,
                    )}
                    onChange={(patch) => updateFields(draft.index, patch)}
                    onRecalculateUnitPrice={() => recalculateUnitPrice(draft.index)}
                    onOpenMatch={() => setMatchFor(draft.index)}
                    onToggleExcluded={() =>
                      updateDraft(draft.index, (current) => ({
                        ...current,
                        isExcluded: !current.isExcluded,
                      }))
                    }
                    onToggleLearnAlias={(learnAlias) =>
                      updateDraft(draft.index, (current) => ({ ...current, learnAlias }))
                    }
                  />
                </li>
              );
            })}
          </ul>
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
          onSearch={handleSearch}
        />
      )}
    </div>
  );
}

const HEADER_REASON_KEY: Record<ReceiptReview['header']['reasons'][number], string> = {
  'total-mismatch': 'totalMismatch',
  'low-confidence': 'lowConfidence',
  'no-total': 'noTotal',
  'no-date': 'noDate',
};

const SIZE_SYMBOL_KEY: Record<UnitKind, 'kg' | 'liter' | 'piece'> = {
  weight: 'kg',
  volume: 'liter',
  count: 'piece',
};

/** Server-resolved line → editable draft. */
function toDraft(line: ReceiptReview['lines'][number]): LineDraft {
  const suggestions =
    line.match.kind === 'suggested'
      ? line.match.suggestions.map((suggestion) => ({
          productId: suggestion.productId,
          name: suggestion.name,
          brand: suggestion.brand,
          score: suggestion.score,
        }))
      : [];

  const product: LineProduct = line.selectedProduct
    ? {
        kind: 'existing',
        productId: line.selectedProduct.productId,
        label: line.selectedProduct.name,
        brand: line.selectedProduct.brand,
        isArchived: line.selectedProduct.isArchived,
      }
    : {
        kind: 'new',
        label: line.match.kind === 'new' ? line.match.draft.name : line.extraction.description,
        brand: line.extraction.brand,
        isArchived: false,
      };

  return {
    index: line.index,
    rawLine: line.extraction.rawLine,
    mergedLineCount: line.mergedLineIndexes.length + 1,
    reviewReasons: line.reviewReasons,
    suggestions,
    product,
    fields: {
      quantity: line.fields.quantity,
      packageSize: line.fields.packageSize,
      sizeSource: line.fields.sizeSource,
      totalPriceCents: line.fields.totalPriceCents,
      unitPriceMilli: line.fields.unitPriceMilli,
      isPromo: line.fields.isPromo,
      promoKind: line.fields.promoKind,
      unitKind: line.fields.unitKind,
    },
    category: line.fields.category,
    needsProductDecision: line.status === 'needs-product',
    isExcluded: false,
    learnAlias: true,
    isUnitPriceEdited: false,
  };
}

/**
 * The status the card shows now, after the user's edits — the server's
 * status was computed before they filled the missing size in.
 */
function liveStatus(draft: LineDraft): ReceiptLineStatus {
  if (draft.fields.packageSize === null || draft.fields.packageSize <= 0) {
    return 'needs-size';
  }
  if (draft.needsProductDecision) {
    return 'needs-product';
  }
  if (draft.fields.totalPriceCents <= 0 || draft.fields.unitPriceMilli === null) {
    return 'needs-review';
  }
  if (draft.reviewReasons.length > 0) {
    return 'needs-review';
  }
  return 'ready';
}

/**
 * Name what a line is still missing, in the order the user has to fix it:
 * the product first (only they can choose it), then the size the unit price
 * hangs off, then the money.
 *
 * The last check is the one the server used to make alone: a total, a size
 * and a unit price that contradict each other are refused by
 * `confirmReceipt` for the WHOLE receipt, and before this the screen had no
 * idea — it counted the line as ready and the user read "il prezzo non è
 * valido" under a confirm button with nothing else to go on.
 *
 * @returns null when the line can be confirmed as it stands
 */
function blockingReasonOf(draft: LineDraft): ReceiptLineBlockingReason | null {
  if (draft.needsProductDecision || draft.product.label.trim().length === 0) {
    return 'product';
  }
  if (draft.fields.packageSize === null || draft.fields.packageSize <= 0) {
    return 'size';
  }
  if (
    draft.fields.totalPriceCents <= 0 ||
    draft.fields.unitPriceMilli === null ||
    draft.fields.unitPriceMilli <= 0
  ) {
    return 'price';
  }
  if (
    !isUnitPriceConsistent(
      draft.fields.totalPriceCents,
      draft.fields.packageSize,
      draft.fields.unitPriceMilli,
    )
  ) {
    return 'unit-price';
  }
  return null;
}

function toConfirmLine(draft: LineDraft): ConfirmReceiptActionInput['lines'][number] {
  return {
    index: draft.index,
    product:
      draft.product.kind === 'existing'
        ? { kind: 'existing', productId: draft.product.productId }
        : {
            kind: 'new',
            name: draft.product.label,
            brand: draft.product.brand,
            category: draft.category,
            unitKind: draft.fields.unitKind,
          },
    quantity: draft.fields.quantity,
    // blockingReasonOf() has already guaranteed these are set: handleConfirm
    // stops at the first line that fails it.
    packageSize: draft.fields.packageSize as number,
    totalPriceCents: draft.fields.totalPriceCents,
    unitPriceMilli: draft.fields.unitPriceMilli as number,
    isPromo: draft.fields.isPromo,
    promoKind: draft.fields.promoKind,
    learnAlias: draft.learnAlias,
  };
}

/** The value a `date` input expects: local wall clock, no timezone. */
function toDateInputValue(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
