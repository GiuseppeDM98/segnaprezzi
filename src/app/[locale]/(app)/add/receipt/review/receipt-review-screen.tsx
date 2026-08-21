'use client';

/**
 * Client half of the receipt review (Spec 07 §8.1).
 *
 * Design: the server resolved every line; this screen owns the *corrections*.
 * Drafts live in React state and the stored extraction is never mutated — it
 * is the audit trail that replaces the document the app deliberately does not
 * keep (§5), and it becomes each entry's `ai_raw_json` on confirm.
 *
 * Editing a price or a size re-derives the unit price the way the capture
 * review does (Spec 03 §9.1), and stops as soon as the user types a unit
 * price by hand — at that point they know something the arithmetic does not.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { type MatchOption, MatchPicker } from '@/components/capture/match-picker';
import { ScreenHeader } from '@/components/layout/screen-header';
import {
  ReceiptLineCard,
  type ReceiptLineCardFields,
} from '@/components/receipt/receipt-line-card';
import { ReceiptSummaryBar } from '@/components/receipt/receipt-summary-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { CategoryId } from '@/lib/domain/categories';
import { calculateUnitPriceMilli } from '@/lib/domain/money';
import type { ReceiptLineStatus } from '@/lib/domain/receipt-lines';
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
  reviewReasons: ReceiptReview['lines'][number]['reviewReasons'];
  suggestions: MatchOption[];
  product: LineProduct;
  fields: ReceiptLineCardFields;
  category: CategoryId;
  /**
   * The matcher found candidates but none convincing: the user must pick or
   * accept "new" before this line can be confirmed (Spec 07 §8.1).
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
  const blockedCount = includedDrafts.filter((draft) => !isDraftConfirmable(draft)).length;
  const readyCount = includedDrafts.length - blockedCount;
  const excludedCount = drafts.length - includedDrafts.length;
  const includedTotalCents = includedDrafts.reduce(
    (sum, draft) => sum + draft.fields.totalPriceCents * draft.fields.quantity,
    0,
  );
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
              <dd className="font-semibold text-text">
                {formatMoney(review.header.linesTotalCents, locale)}
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
          </dl>

          {review.header.reasons.map((reason) => (
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
                <li key={draft.index}>
                  <ReceiptLineCard
                    data-testid="receipt-line-card"
                    rawLine={draft.rawLine}
                    status={liveStatus(draft)}
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
                    onChange={(patch) => updateFields(draft.index, patch)}
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

/** A line may be confirmed once every value the entry contract needs is real. */
function isDraftConfirmable(draft: LineDraft): boolean {
  return (
    !draft.needsProductDecision &&
    draft.fields.packageSize !== null &&
    draft.fields.packageSize > 0 &&
    draft.fields.totalPriceCents > 0 &&
    draft.fields.unitPriceMilli !== null &&
    draft.fields.unitPriceMilli > 0 &&
    draft.product.label.trim().length > 0
  );
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
    // isDraftConfirmable() has already guaranteed these are set before the
    // confirm button becomes clickable.
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
