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
 *
 * This file is the orchestrator: it owns the session, the screen's flags and
 * every Server Action call. The drafts live in useReviewDrafts, their rules in
 * review-derivations.ts, and each section of the page (card list, confirm
 * bar, match sheet, success overlay) in its own file beside this one.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useProductSearch } from '@/components/capture/use-product-search';
import { ScreenHeader } from '@/components/layout/screen-header';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { callAction } from '@/lib/call-action';
import { type AppLocale, formatDate } from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import { useAppMotion } from '@/lib/motion';
import {
  clearActiveSessionId,
  clearSessionPhotos,
  listSessionPhotos,
  readActiveSessionId,
} from '@/lib/offline/photo-queue';
import { notifySessionCompleted } from '@/lib/offline/use-pwa-install';
import { searchProducts } from '../../products/actions';
import { beginSessionReview, confirmShoppingSession } from './actions';
import { ReviewCardList, ReviewCardListSkeleton } from './review-card-list';
import { ReviewConfirmBar } from './review-confirm-bar';
import {
  isDraftFlagged,
  isDraftResolved,
  type ProductPick,
  summarizeDrafts,
  toConfirmEntry,
} from './review-derivations';
import { ReviewMatchSheet } from './review-match-sheet';
import { SuccessOverlay } from './success-overlay';
import { useReviewDrafts } from './use-review-drafts';

export type { ReviewEntryDraft, SelectedProduct } from './review-derivations';

/** How long the success checkmark stays before navigating home. */
const SUCCESS_HOLD_MS = 700;
/**
 * The same hold under reduced motion: the checkmark does not animate, so
 * there is nothing to watch — only long enough to register that it saved.
 */
const REDUCED_MOTION_SUCCESS_HOLD_MS = 300;

export function ReviewScreen() {
  const t = useTranslations('review');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();
  const { isReduced } = useAppMotion();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hasResolvedSession, setHasResolvedSession] = useState(false);
  const [matchFor, setMatchFor] = useState<string | null>(null);
  const [isFlaggedOnly, setIsFlaggedOnly] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const productSearch = useProductSearch(searchProducts);

  useEffect(() => {
    const activeSessionId = readActiveSessionId();
    setSessionId(activeSessionId);
    setHasResolvedSession(true);
    if (!activeSessionId) {
      return;
    }
    // Best effort: an offline review never reports the transition, and
    // confirm accepts an `active` session anyway (§2.1). callAction still
    // logs a rejected request, so the result itself can be ignored.
    void callAction('beginSessionReview', beginSessionReview({ sessionId: activeSessionId }));
  }, []);

  const pendingPhotos = useLiveQuery(
    () => (sessionId ? listSessionPhotos(sessionId) : Promise.resolve([])),
    [sessionId],
  );

  // Any edit is an answer to the complaint: keeping "complete the
  // highlighted entry" on screen while the user does exactly that turns an
  // instruction into a scolding.
  const clearError = useCallback(() => setErrorCode(null), []);
  const { drafts, discardedDrafts, updateFields, pickProduct, discardDraft, restoreDraft } =
    useReviewDrafts(pendingPhotos, clearError);

  function handleDiscard(id: string): void {
    const draft = discardDraft(id);
    if (!draft) {
      return;
    }
    toast({
      kind: 'info',
      message: t('discarded'),
      action: { label: t('undo'), onClick: () => restoreDraft(draft) },
    });
  }

  function handlePick(draftId: string, pick: ProductPick): void {
    pickProduct(draftId, pick, productSearch.searchHits);
  }

  const photos = pendingPhotos ?? [];

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
    const result = await callAction(
      'confirmShoppingSession',
      confirmShoppingSession({
        sessionId,
        storeId: photos.find((photo) => photo.storeId)?.storeId ?? null,
        entries: drafts.map(toConfirmEntry),
      }),
    );
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
      isReduced ? REDUCED_MOTION_SUCCESS_HOLD_MS : SUCCESS_HOLD_MS,
    );
  }

  const isLoading = !hasResolvedSession || (sessionId !== null && pendingPhotos === undefined);
  /*
   * Photos still travelling get their own cards, after the drafts, instead
   * of being invisible. The batch stays all-or-nothing, though: confirming
   * completes the spesa and clears its queue, so a photo left mid-flight
   * would be destroyed rather than merely omitted — a deliberate correction
   * to the original "never blocked by pending items" design goal.
   */
  const unfinishedPhotos = photos.filter(
    (photo) => photo.status !== 'extracted' && !discardedDrafts.has(photo.id),
  );
  const hasUnfinishedPhotos = unfinishedPhotos.length > 0;
  const { flaggedCount, incompleteCount, runningTotalCents } = summarizeDrafts(drafts);
  const visibleDrafts = isFlaggedOnly ? drafts.filter(isDraftFlagged) : drafts;
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
          <ReviewCardListSkeleton />
        ) : drafts.length === 0 && !hasUnfinishedPhotos ? (
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            data-testid="review-empty"
            action={<Button href="/scan">{t('empty.cta')}</Button>}
          />
        ) : (
          <ReviewCardList
            drafts={visibleDrafts}
            unfinishedPhotos={unfinishedPhotos}
            showPending={!isFlaggedOnly}
            registerCard={(id, element) => {
              cardRefs.current[id] = element;
            }}
            onChange={updateFields}
            onOpenMatch={setMatchFor}
            onDiscard={handleDiscard}
          />
        )}
      </div>

      {drafts.length > 0 && (
        <ReviewConfirmBar
          draftCount={drafts.length}
          incompleteCount={incompleteCount}
          runningTotalCents={runningTotalCents}
          hasUnfinishedPhotos={hasUnfinishedPhotos}
          errorCode={errorCode}
          isSubmitting={isSubmitting}
          isSuccess={isSuccess}
          onConfirm={() => void handleConfirm()}
        />
      )}

      {activeMatchDraft && (
        <ReviewMatchSheet
          draft={activeMatchDraft}
          isOpen={matchFor !== null}
          onClose={() => setMatchFor(null)}
          onPick={(pick) => handlePick(activeMatchDraft.id, pick)}
          onSearch={productSearch.searchProducts}
        />
      )}

      <SuccessOverlay isVisible={isSuccess} />
    </div>
  );
}
