'use client';

/**
 * Client half of the review screen.
 *
 * Design: the AI payload stored in Dexie is immutable — it becomes
 * price_entries.ai_raw_json and is the audit trail the user compares against
 * when correcting a number. Edits therefore live in React state only, and
 * every card must be resolved (a product picked, no "not legible" zeros left)
 * before the batch can be confirmed. Nothing reaches the database until then.
 *
 * The screen is live: the queue is read through a live query,
 * so a photo that finishes extracting — in this tab or in the service
 * worker's background drain — turns into an editable card without a refresh,
 * and the ones still travelling are shown as pending cards rather than being
 * silently absent.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ExtractionCard, type ExtractionCardMatch } from '@/components/capture/extraction-card';
import { type MatchOption, MatchPicker } from '@/components/capture/match-picker';
import { ScreenHeader } from '@/components/layout/screen-header';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import type { ExtractionResult } from '@/lib/ai/extraction-schema';
import type { ReviewedExtraction, ReviewReason } from '@/lib/ai/flag-extraction';
import type { CategoryId } from '@/lib/domain/categories';
import { calculateUnitPriceMilli } from '@/lib/domain/money';
import type { UnitKind } from '@/lib/domain/units';
import { type AppLocale, formatDate, formatMoney } from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import { CARD_STAGGER_SECONDS, useAppMotion } from '@/lib/motion';
import type { PendingPhoto } from '@/lib/offline/db';
import {
  clearActiveSessionId,
  clearSessionPhotos,
  listSessionPhotos,
  readActiveSessionId,
} from '@/lib/offline/photo-queue';
import { notifySessionCompleted } from '@/lib/offline/use-pwa-install';
import type { ProductSuggestion } from '@/lib/services/match-products';
import { beginSessionReview, confirmShoppingSession, searchProducts } from './actions';
import type { ConfirmShoppingSessionInput } from './schema';

/** Above this score the top suggestion is safe to preselect. */
const PRESELECT_SCORE_THRESHOLD = 0.7;
/** How long the success checkmark stays before navigating home. */
const SUCCESS_HOLD_MS = 700;

export type SelectedProduct =
  | { kind: 'existing'; productId: string; name: string; brand: string | null }
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
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();
  const { isReduced, spring, fade } = useAppMotion();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hasResolvedSession, setHasResolvedSession] = useState(false);
  const [drafts, setDrafts] = useState<ReviewEntryDraft[]>([]);
  const [discarded, setDiscarded] = useState<Map<string, ReviewEntryDraft>>(new Map());
  const [matchFor, setMatchFor] = useState<string | null>(null);
  const [isFlaggedOnly, setIsFlaggedOnly] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    const activeSessionId = readActiveSessionId();
    setSessionId(activeSessionId);
    setHasResolvedSession(true);
    if (!activeSessionId) {
      return;
    }
    // Best effort: an offline review never reports the transition, and
    // confirm accepts an `active` session anyway (§2.1).
    void beginSessionReview({ sessionId: activeSessionId });
  }, []);

  const pendingPhotos = useLiveQuery(
    () => (sessionId ? listSessionPhotos(sessionId) : Promise.resolve([])),
    [sessionId],
  );

  /*
   * Adopt each newly extracted photo as a card, and only once: the drafts
   * hold the user's in-progress edits, so a live-query tick must never
   * rebuild the ones already on screen (nor resurrect a discarded one).
   */
  useEffect(() => {
    if (!pendingPhotos) {
      return;
    }
    setDrafts((current) => {
      const known = new Set(current.map((draft) => draft.id));
      const fresh = pendingPhotos
        .filter(hasExtraction)
        .filter((photo) => !known.has(photo.id) && !discarded.has(photo.id))
        .map(toDraft);
      return fresh.length > 0 ? [...current, ...fresh] : current;
    });
  }, [pendingPhotos, discarded]);

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

  function discardDraft(id: string): void {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) {
      return;
    }
    setDrafts((current) => current.filter((item) => item.id !== id));
    setDiscarded((current) => new Map(current).set(id, draft));
    toast({
      kind: 'info',
      message: t('discarded'),
      action: {
        label: t('undo'),
        onClick: () => {
          setDiscarded((current) => {
            const next = new Map(current);
            next.delete(id);
            return next;
          });
          setDrafts((current) => [...current, draft]);
        },
      },
    });
  }

  const handleSearch = useCallback(async (query: string): Promise<MatchOption[]> => {
    const result = await searchProducts({ query });
    return result.ok
      ? result.data.map((hit) => ({ productId: hit.id, name: hit.name, brand: hit.brand }))
      : [];
  }, []);

  // Search hits are remembered so a pick from search can show its name.
  const lastSearchHits = useRef(new Map<string, MatchOption>());

  function handlePick(draftId: string, pick: { productId: string } | 'new'): void {
    updateDraft(draftId, (draft) => {
      if (pick === 'new') {
        return { ...draft, selectedProduct: toNewProductPick(draft.fields) };
      }
      const known =
        draft.suggestions.find((s) => s.productId === pick.productId) ??
        lastSearchHits.current.get(pick.productId);
      return {
        ...draft,
        selectedProduct: {
          kind: 'existing',
          productId: pick.productId,
          name: known?.name ?? draft.fields.productName,
          brand: known?.brand ?? null,
        },
      };
    });
  }

  const handleSearchRemembering = useCallback(
    async (query: string) => {
      const hits = await handleSearch(query);
      for (const hit of hits) {
        lastSearchHits.current.set(hit.productId, hit);
      }
      return hits;
    },
    [handleSearch],
  );

  async function handleConfirm(): Promise<void> {
    if (!sessionId) {
      return;
    }

    const unresolved = drafts.find((draft) => !isDraftResolved(draft));
    if (unresolved) {
      setIsFlaggedOnly(false);
      cardRefs.current[unresolved.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setErrorCode('INVALID_INPUT');
      return;
    }

    setIsSubmitting(true);
    setErrorCode(null);
    const result = await confirmShoppingSession({
      sessionId,
      storeId: photos.find((photo) => photo.storeId)?.storeId ?? null,
      entries: drafts.map(toConfirmEntry),
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setErrorCode(result.error.code);
      return;
    }

    await clearSessionPhotos(sessionId);
    clearActiveSessionId();
    setIsSuccess(true);
    // A completed spesa is the one honest moment to offer the install;
    // the provider decides whether it may actually ask.
    notifySessionCompleted();
    window.setTimeout(
      () => {
        toast({ kind: 'success', message: t('saved') });
        router.push('/');
      },
      isReduced ? 300 : SUCCESS_HOLD_MS,
    );
  }

  const photos = pendingPhotos ?? [];
  const isLoading = !hasResolvedSession || (sessionId !== null && pendingPhotos === undefined);
  /*
   * Photos still travelling get their own cards, above, instead of being
   * invisible. The batch stays all-or-nothing, though: confirming completes
   * the spesa and clears its queue, so a photo left mid-flight would be
   * destroyed rather than merely omitted — a deliberate correction to the
   * original "never blocked by pending items" design goal.
   */
  const unfinishedPhotos = photos.filter(
    (photo) => photo.status !== 'extracted' && !discarded.has(photo.id),
  );
  const hasUnfinishedPhotos = unfinishedPhotos.length > 0;
  const flaggedCount = drafts.filter(
    (draft) => draft.needsReview || !isDraftResolved(draft),
  ).length;
  const incompleteCount = drafts.filter((draft) => !isDraftResolved(draft)).length;
  const runningTotalCents = drafts.reduce((sum, draft) => sum + draft.fields.totalPriceCents, 0);
  const visibleDrafts = isFlaggedOnly
    ? drafts.filter((draft) => draft.needsReview || !isDraftResolved(draft))
    : drafts;
  const activeMatchDraft = drafts.find((draft) => draft.id === matchFor) ?? null;
  const captionDate = photos[0]
    ? formatDate(photos[0].createdAt, locale)
    : formatDate(Date.now(), locale);

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title={t('title')}
        backHref="/scan"
        caption={isLoading ? undefined : t('caption', { count: photos.length, date: captionDate })}
        actions={
          flaggedCount > 0 ? (
            <Chip
              variant="filter"
              isSelected={isFlaggedOnly}
              onClick={() => setIsFlaggedOnly((value) => !value)}
              data-testid="flagged-filter"
            >
              {isFlaggedOnly ? t('showAll') : t('flagged', { count: flaggedCount })}
            </Chip>
          ) : undefined
        }
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4 pb-28">
        {isLoading ? (
          <SkeletonCards />
        ) : drafts.length === 0 && !hasUnfinishedPhotos ? (
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            data-testid="review-empty"
            action={<Button href="/scan">{t('empty.cta')}</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-4">
            <AnimatePresence initial={!isReduced}>
              {visibleDrafts.map((draft, index) => (
                <motion.li
                  key={draft.id}
                  ref={(element) => {
                    cardRefs.current[draft.id] = element;
                  }}
                  layout={!isReduced}
                  initial={isReduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={isReduced ? fade : { ...spring, delay: index * CARD_STAGGER_SECONDS }}
                >
                  <ExtractionCard
                    data-testid="review-card"
                    blobUrl={draft.blobUrl}
                    fields={draft.fields}
                    match={toCardMatch(draft.selectedProduct)}
                    isFlagged={draft.needsReview}
                    reviewReasons={draft.reviewReasons}
                    isUnitPriceDerived={!draft.isUnitPriceEdited}
                    onChange={(patch) => updateFields(draft.id, patch)}
                    onOpenMatch={() => setMatchFor(draft.id)}
                    onDiscard={() => discardDraft(draft.id)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
            {!isFlaggedOnly &&
              unfinishedPhotos.map((photo) => <PendingCard key={photo.id} photo={photo} />)}
          </ul>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-20 border-border border-t border-dashed bg-surface/95 px-4 pt-3 pb-11 backdrop-blur-sm rail:bottom-0 rail:pb-3">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
            {hasUnfinishedPhotos && (
              <p className="font-sans text-[13px] text-warning">{t('waitingForUploads')}</p>
            )}
            {errorCode && (
              <p data-testid="confirm-error" className="font-sans text-[13px] text-negative">
                {t('confirmError')}
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
                onClick={() => void handleConfirm()}
                isPending={isSubmitting}
                disabled={hasUnfinishedPhotos || incompleteCount > 0 || isSuccess}
                data-testid="confirm-batch"
                size="lg"
              >
                {t('confirmBatch', { count: drafts.length })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {activeMatchDraft && (
        <MatchPicker
          isOpen={matchFor !== null}
          onClose={() => setMatchFor(null)}
          suggestions={activeMatchDraft.suggestions.map((suggestion) => ({
            productId: suggestion.productId,
            name: suggestion.name,
            brand: suggestion.brand,
            score: suggestion.score,
          }))}
          selectedProductId={
            activeMatchDraft.selectedProduct?.kind === 'existing'
              ? activeMatchDraft.selectedProduct.productId
              : null
          }
          isNewSelected={activeMatchDraft.selectedProduct?.kind === 'new'}
          newProductName={activeMatchDraft.fields.productName}
          onPick={(pick) => handlePick(activeMatchDraft.id, pick)}
          onSearch={handleSearchRemembering}
        />
      )}

      <SuccessOverlay isVisible={isSuccess} />
    </div>
  );
}

/** Confirm success: an SVG checkmark drawing its stroke, then a spring pop (§7). */
function SuccessOverlay({ isVisible }: { isVisible: boolean }) {
  const t = useTranslations('review');
  const { isReduced, spring, fade } = useAppMotion();
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90 backdrop-blur-sm"
        >
          <motion.span
            initial={isReduced ? false : { scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={{ ...spring, delay: isReduced ? 0 : 0.35 }}
            className="flex size-24 items-center justify-center rounded-full bg-positive-soft text-positive"
          >
            <svg viewBox="0 0 48 48" className="size-12" fill="none" aria-hidden="true">
              <motion.path
                d="M12 25l8 8 16-18"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={isReduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={isReduced ? { duration: 0 } : { duration: 0.4, ease: 'easeOut' }}
              />
            </svg>
          </motion.span>
          <p className="font-sans font-semibold text-lg text-text">{t('saved')}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A photo that has not been extracted yet: its own thumbnail
 * from IndexedDB, the queue status, and a line saying it will fill itself in.
 * It is a placeholder with a face, not a grey box — the user recognises the
 * shelf they photographed and knows nothing was lost.
 */
function PendingCard({ photo }: { photo: PendingPhoto }) {
  const t = useTranslations('review');
  const tScan = useTranslations('scan');
  const thumbnailUrl = useObjectUrl(photo.blob);

  return (
    <li
      data-testid="review-pending-card"
      className="flex items-center gap-3 rounded-control border border-border border-dashed bg-surface p-3"
    >
      {/* biome-ignore lint/performance/noImgElement: a local blob: URL for a
          photo that never reached a server — next/image cannot optimize it
          and would only add a failing request. */}
      <img
        src={thumbnailUrl}
        alt=""
        className="size-20 shrink-0 rounded-control bg-band object-cover opacity-70"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <Chip variant="status" tone={photo.status === 'failed' ? 'negative' : 'neutral'}>
          {tScan(`status.${photo.status}`)}
        </Chip>
        <p className="font-sans text-[13px] text-text-muted leading-snug">
          {photo.status === 'failed' ? t('pendingFailed') : t('pendingHint')}
        </p>
      </div>
    </li>
  );
}

/** One object URL per blob, revoked when the card unmounts. */
function useObjectUrl(blob: Blob): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url;
}

function SkeletonCards() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-control border border-border bg-surface p-3"
        >
          <div className="flex gap-3">
            <Skeleton shape="block" width="5rem" height="5rem" />
            <div className="flex flex-1 flex-col gap-3">
              <Skeleton width="70%" />
              <Skeleton width="45%" />
            </div>
          </div>
          <Skeleton shape="block" height="2.75rem" />
          <Skeleton shape="block" height="2.75rem" />
        </div>
      ))}
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
        ? {
            kind: 'existing',
            productId: topSuggestion.productId,
            name: topSuggestion.name,
            brand: topSuggestion.brand,
          }
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

function toCardMatch(selected: SelectedProduct | null): ExtractionCardMatch | null {
  if (!selected) {
    return null;
  }
  return { kind: selected.kind, label: selected.name, brand: selected.brand };
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
  const selected = draft.selectedProduct ?? toNewProductPick(draft.fields);
  return {
    id: draft.id,
    // isDraftResolved() has already guaranteed a pick before confirm runs.
    product:
      selected.kind === 'existing'
        ? { kind: 'existing', productId: selected.productId }
        : {
            kind: 'new',
            name: selected.name,
            brand: selected.brand,
            category: selected.category,
            unitKind: selected.unitKind,
          },
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
