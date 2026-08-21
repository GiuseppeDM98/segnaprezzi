'use client';

/**
 * Client half of the review screen (Spec 03 §9.1).
 *
 * Design: the AI payload stored in Dexie is immutable — it becomes
 * price_entries.ai_raw_json and is the audit trail the user compares against
 * when correcting a number. Edits therefore live in React state only, and
 * every card must be resolved (a product picked, no "not legible" zeros left)
 * before the batch can be confirmed. Nothing reaches the database until then.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ExtractionResult } from '@/lib/ai/extraction-schema';
import type { ReviewedExtraction, ReviewReason } from '@/lib/ai/flag-extraction';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import { PROMO_KINDS, type PromoKind } from '@/lib/domain/entries';
import {
  calculateUnitPriceMilli,
  centsToEuros,
  milliToEuros,
  toCents,
  toMilli,
} from '@/lib/domain/money';
import { UNIT_KINDS, type UnitKind } from '@/lib/domain/units';
import { useRouter } from '@/lib/i18n/navigation';
import type { PendingPhoto } from '@/lib/offline/db';
import {
  clearActiveSessionId,
  clearSessionPhotos,
  listSessionPhotos,
  readActiveSessionId,
} from '@/lib/offline/photo-queue';
import type { ProductSuggestion } from '@/lib/services/match-products';
import { beginSessionReview, confirmShoppingSession } from './actions';
import type { ConfirmShoppingSessionInput } from './schema';

/** Above this score the top suggestion is safe to preselect (Spec 03 §9.1). */
const PRESELECT_SCORE_THRESHOLD = 0.7;

export type SelectedProduct =
  | { kind: 'existing'; productId: string }
  | { kind: 'new'; name: string; brand: string | null; category: CategoryId; unitKind: UnitKind };

export interface ReviewEntryDraft {
  /** = pendingPhotos.id = future price_entries.id */
  id: string;
  blobUrl: string;
  /** User-editable copy of extraction fields (name, prices, category, promo…). */
  fields: ExtractionResult;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  suggestions: ProductSuggestion[];
  /** null until the user picks; preselected to suggestions[0] when its score ≥ 0.7. */
  selectedProduct: SelectedProduct | null;
  /** Epoch ms; defaults to the moment the photo was taken. */
  recordedAt: number;
  /** The immutable AI payload, kept verbatim for ai_raw_json. */
  original: ReviewedExtraction;
  aiModel: string;
  /** True once the user typed a unit price: stops the auto-recompute. */
  isUnitPriceEdited: boolean;
}

export function ReviewScreen() {
  const t = useTranslations('review');
  const tCategories = useTranslations('categories');
  const tUnits = useTranslations('units');
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [drafts, setDrafts] = useState<ReviewEntryDraft[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    const activeSessionId = readActiveSessionId();
    setSessionId(activeSessionId);
    if (!activeSessionId) {
      return;
    }

    // Best effort: an offline review never reports the transition, and
    // confirm accepts an `active` session anyway (§2.1).
    void beginSessionReview({ sessionId: activeSessionId });

    void listSessionPhotos(activeSessionId).then((photos) => {
      setPendingPhotos(photos);
      setDrafts(photos.filter(hasExtraction).map(toDraft));
    });
  }, []);

  const updateDraft = useCallback(
    (id: string, patch: (draft: ReviewEntryDraft) => ReviewEntryDraft) => {
      setDrafts((current) => current.map((draft) => (draft.id === id ? patch(draft) : draft)));
    },
    [],
  );

  /** Editing the total or the size re-derives the unit price, unless the user owns it. */
  function updateFields(id: string, patch: Partial<ExtractionResult>): void {
    updateDraft(id, (draft) => {
      const fields = { ...draft.fields, ...patch };
      const shouldRecompute =
        !draft.isUnitPriceEdited &&
        patch.unitPriceMilli === undefined &&
        fields.totalPriceCents > 0 &&
        fields.packageSize > 0;
      return {
        ...draft,
        fields: shouldRecompute
          ? {
              ...fields,
              unitPriceMilli: calculateUnitPriceMilli(fields.totalPriceCents, fields.packageSize),
            }
          : fields,
        isUnitPriceEdited: draft.isUnitPriceEdited || patch.unitPriceMilli !== undefined,
      };
    });
  }

  async function handleConfirm(): Promise<void> {
    if (!sessionId) {
      return;
    }

    const unresolved = drafts.find((draft) => !isDraftResolved(draft));
    if (unresolved) {
      cardRefs.current[unresolved.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setErrorCode('INVALID_INPUT');
      return;
    }

    setIsSubmitting(true);
    setErrorCode(null);
    const result = await confirmShoppingSession({
      sessionId,
      storeId: pendingPhotos.find((photo) => photo.storeId)?.storeId ?? null,
      entries: drafts.map(toConfirmEntry),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setErrorCode(result.error.code);
      return;
    }

    await clearSessionPhotos(sessionId);
    clearActiveSessionId();
    router.push('/');
  }

  // The batch is all-or-nothing: a photo still travelling would be silently
  // dropped from the spesa if we let the user confirm around it.
  const hasUnfinishedPhotos = pendingPhotos.some((photo) => photo.status !== 'extracted');

  if (drafts.length === 0) {
    return <p className="text-text-muted">{t('empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            ref={(element) => {
              cardRefs.current[draft.id] = element;
            }}
            className="flex flex-col gap-3 rounded-2xl bg-surface p-4"
            data-testid="review-card"
          >
            <div className="flex gap-3">
              {/* biome-ignore lint/performance/noImgElement: a Vercel Blob URL
                  outside next/image's configured remote patterns; Spec 05 owns
                  the styled thumbnail component. */}
              <img src={draft.blobUrl} alt="" className="size-20 rounded-xl object-cover" />
              <div className="flex flex-1 flex-col gap-1">
                {draft.needsReview && (
                  <span
                    className="w-fit rounded-full bg-warning px-2 py-0.5 font-medium text-xs"
                    data-testid="needs-review-badge"
                  >
                    {t('needsReview')}
                  </span>
                )}
                {draft.reviewReasons.map((reason) => (
                  <span key={reason} className="text-text-muted text-xs">
                    {t(reason === 'price-mismatch' ? 'priceMismatch' : 'lowConfidence')}
                  </span>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              {t('fields.productName')}
              <input
                value={draft.fields.productName}
                onChange={(event) => updateFields(draft.id, { productName: event.target.value })}
                className="rounded-lg border border-border p-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {t('fields.brand')}
              <input
                value={draft.fields.brand ?? ''}
                onChange={(event) => updateFields(draft.id, { brand: event.target.value || null })}
                className="rounded-lg border border-border p-2"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {t('fields.category')}
                <select
                  value={draft.fields.category}
                  onChange={(event) =>
                    updateFields(draft.id, { category: event.target.value as CategoryId })
                  }
                  className="rounded-lg border border-border p-2"
                >
                  {CATEGORY_IDS.map((category) => (
                    <option key={category} value={category}>
                      {tCategories(category)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                {t('fields.unitKind')}
                <select
                  value={draft.fields.unitKind}
                  onChange={(event) =>
                    updateFields(draft.id, { unitKind: event.target.value as UnitKind })
                  }
                  className="rounded-lg border border-border p-2"
                >
                  {UNIT_KINDS.map((unitKind) => (
                    <option key={unitKind} value={unitKind}>
                      {tUnits(unitKind)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {t('fields.totalPrice')}
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  data-testid="field-total-price"
                  value={toInputValue(draft.fields.totalPriceCents, centsToEuros)}
                  onChange={(event) =>
                    updateFields(draft.id, { totalPriceCents: toCents(Number(event.target.value)) })
                  }
                  className="rounded-lg border border-border p-2"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                {t('fields.packageSize')}
                <input
                  type="number"
                  step="0.001"
                  inputMode="decimal"
                  value={draft.fields.packageSize === 0 ? '' : draft.fields.packageSize}
                  onChange={(event) =>
                    updateFields(draft.id, { packageSize: Number(event.target.value) })
                  }
                  className="rounded-lg border border-border p-2"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                {t('fields.unitPrice')}
                <input
                  type="number"
                  step="0.001"
                  inputMode="decimal"
                  value={toInputValue(draft.fields.unitPriceMilli, milliToEuros)}
                  onChange={(event) =>
                    updateFields(draft.id, { unitPriceMilli: toMilli(Number(event.target.value)) })
                  }
                  className="rounded-lg border border-border p-2"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.fields.isPromo}
                onChange={(event) =>
                  updateFields(draft.id, {
                    isPromo: event.target.checked,
                    promoKind: event.target.checked ? draft.fields.promoKind : null,
                  })
                }
              />
              {t('fields.isPromo')}
            </label>

            {draft.fields.isPromo && (
              <label className="flex flex-col gap-1 text-sm">
                {t('fields.promoKind')}
                <select
                  value={draft.fields.promoKind ?? ''}
                  onChange={(event) =>
                    updateFields(draft.id, {
                      promoKind: (event.target.value || null) as PromoKind | null,
                    })
                  }
                  className="rounded-lg border border-border p-2"
                >
                  <option value="">—</option>
                  {PROMO_KINDS.map((promoKind) => (
                    <option key={promoKind} value={promoKind}>
                      {t(`promoKinds.${promoKind}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="font-medium">{t('matchPicker')}</legend>
              {draft.suggestions.map((suggestion) => (
                <label key={suggestion.productId} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`product-${draft.id}`}
                    checked={
                      draft.selectedProduct?.kind === 'existing' &&
                      draft.selectedProduct.productId === suggestion.productId
                    }
                    onChange={() =>
                      updateDraft(draft.id, (current) => ({
                        ...current,
                        selectedProduct: { kind: 'existing', productId: suggestion.productId },
                      }))
                    }
                  />
                  <span>
                    {suggestion.brand ? `${suggestion.brand} ` : ''}
                    {suggestion.name}
                  </span>
                  <span className="text-text-muted text-xs">
                    {Math.round(suggestion.score * 100)}%
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`product-${draft.id}`}
                  data-testid="pick-new-product"
                  checked={draft.selectedProduct?.kind === 'new'}
                  onChange={() =>
                    updateDraft(draft.id, (current) => ({
                      ...current,
                      selectedProduct: toNewProductPick(current.fields),
                    }))
                  }
                />
                {t('newProduct')}
              </label>
            </fieldset>
          </li>
        ))}
      </ul>

      {hasUnfinishedPhotos && <p className="text-sm text-warning">{t('waitingForUploads')}</p>}
      {errorCode && (
        <p role="alert" data-testid="confirm-error" className="text-negative text-sm">
          {t('confirmError')}
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isSubmitting || hasUnfinishedPhotos}
        data-testid="confirm-batch"
        className="rounded-full bg-accent px-6 py-3 font-medium text-accent-contrast disabled:opacity-40"
      >
        {t('confirmBatch')}
      </button>
    </div>
  );
}

/** Photos still travelling have no extraction to review yet. */
function hasExtraction(
  photo: PendingPhoto,
): photo is PendingPhoto & { extraction: NonNullable<PendingPhoto['extraction']> } {
  return photo.extraction !== undefined;
}

function toDraft(
  photo: PendingPhoto & { extraction: NonNullable<PendingPhoto['extraction']> },
): ReviewEntryDraft {
  const { extraction, suggestions, blobUrl, model } = photo.extraction;
  const { needsReview, reviewReasons, ...fields } = extraction;
  const topSuggestion = suggestions[0];

  return {
    id: photo.id,
    blobUrl,
    fields: { ...fields },
    needsReview,
    reviewReasons,
    suggestions,
    selectedProduct:
      topSuggestion && topSuggestion.score >= PRESELECT_SCORE_THRESHOLD
        ? { kind: 'existing', productId: topSuggestion.productId }
        : null,
    recordedAt: photo.createdAt,
    original: extraction,
    aiModel: model,
    isUnitPriceEdited: false,
  };
}

function toNewProductPick(fields: ExtractionResult): SelectedProduct {
  return {
    kind: 'new',
    name: fields.productName,
    brand: fields.brand,
    category: fields.category,
    unitKind: fields.unitKind,
  };
}

/** A card is ready when it has a product and no "not legible" zeros left. */
function isDraftResolved(draft: ReviewEntryDraft): boolean {
  return (
    draft.selectedProduct !== null &&
    draft.fields.productName.trim().length > 0 &&
    draft.fields.totalPriceCents > 0 &&
    draft.fields.packageSize > 0 &&
    draft.fields.unitPriceMilli > 0
  );
}

function toConfirmEntry(draft: ReviewEntryDraft): ConfirmShoppingSessionInput['entries'][number] {
  return {
    id: draft.id,
    // isDraftResolved() has already guaranteed a pick before confirm runs.
    product: draft.selectedProduct ?? toNewProductPick(draft.fields),
    recordedAt: draft.recordedAt,
    totalPriceCents: draft.fields.totalPriceCents,
    packageSize: draft.fields.packageSize,
    unitPriceMilli: draft.fields.unitPriceMilli,
    isPromo: draft.fields.isPromo,
    promoKind: draft.fields.promoKind,
    photoUrl: draft.blobUrl,
    // The ORIGINAL confidence, even after edits: it records how sure the model
    // was, not how sure the user is.
    aiConfidence: draft.original.confidence,
    aiModel: draft.aiModel,
    aiRawJson: JSON.stringify(draft.original),
  };
}

/** Render the "not legible" 0 sentinel as an empty input the user must fill. */
function toInputValue(value: number, convert: (value: number) => number): number | '' {
  return value === 0 ? '' : convert(value);
}
