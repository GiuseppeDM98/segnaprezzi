'use client';

/**
 * The review batch's in-progress edits: one draft per extracted photo, plus
 * the drafts the user discarded (kept so the toast's undo can bring them back
 * and so a live-query tick never resurrects them).
 *
 * Design: this hook owns the draft list and nothing else — no action calls,
 * no toasts, no navigation. The screen decides when to confirm and what to
 * say; the rules for what an edit or a pick produces live in
 * review-derivations.ts, so this file is only the React state around them.
 */
import { useCallback, useEffect, useState } from 'react';

import type { ExtractionResult } from '@/lib/domain/extract-photo';
import type { PendingPhoto } from '@/lib/offline/db';
import {
  applyFieldsPatch,
  applyProductPick,
  hasExtraction,
  type KnownProduct,
  type ProductPick,
  type ReviewEntryDraft,
  toDraft,
} from './review-derivations';

export interface ReviewDrafts {
  drafts: ReviewEntryDraft[];
  /** Discarded drafts by id, until an undo restores them. */
  discardedDrafts: ReadonlyMap<string, ReviewEntryDraft>;
  /** Edit a card's fields; the total and size re-derive the unit price. */
  updateFields: (id: string, patch: Partial<ExtractionResult>) => void;
  /** Record a match-sheet pick; `searchHits` names a product found by search. */
  pickProduct: (
    id: string,
    pick: ProductPick,
    searchHits: ReadonlyMap<string, KnownProduct>,
  ) => void;
  /**
   * Remove a card from the batch.
   *
   * @returns the removed draft, for the undo, or null when the id is unknown.
   */
  discardDraft: (id: string) => ReviewEntryDraft | null;
  /** Put a discarded draft back, at the end of the list. */
  restoreDraft: (draft: ReviewEntryDraft) => void;
}

/**
 * Keep the drafts in step with the live photo queue.
 *
 * @param pendingPhotos the session's queue as the live query reads it;
 *   undefined while the first read is in flight.
 * @param onEdit called on every edit and pick, so the screen can drop a
 *   complaint the user is busy answering. Pass a stable callback.
 */
export function useReviewDrafts(
  pendingPhotos: PendingPhoto[] | undefined,
  onEdit: () => void,
): ReviewDrafts {
  const [drafts, setDrafts] = useState<ReviewEntryDraft[]>([]);
  const [discardedDrafts, setDiscardedDrafts] = useState<Map<string, ReviewEntryDraft>>(new Map());

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
        .filter((photo) => !known.has(photo.id) && !discardedDrafts.has(photo.id))
        .map(toDraft);
      return fresh.length > 0 ? [...current, ...fresh] : current;
    });
  }, [pendingPhotos, discardedDrafts]);

  const updateDraft = useCallback(
    (id: string, patch: (draft: ReviewEntryDraft) => ReviewEntryDraft) => {
      setDrafts((current) => current.map((draft) => (draft.id === id ? patch(draft) : draft)));
      onEdit();
    },
    [onEdit],
  );

  function updateFields(id: string, patch: Partial<ExtractionResult>): void {
    updateDraft(id, (draft) => applyFieldsPatch(draft, patch));
  }

  function pickProduct(
    id: string,
    pick: ProductPick,
    searchHits: ReadonlyMap<string, KnownProduct>,
  ): void {
    updateDraft(id, (draft) => applyProductPick(draft, pick, searchHits));
  }

  function discardDraft(id: string): ReviewEntryDraft | null {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) {
      return null;
    }
    setDrafts((current) => current.filter((item) => item.id !== id));
    setDiscardedDrafts((current) => new Map(current).set(id, draft));
    return draft;
  }

  function restoreDraft(draft: ReviewEntryDraft): void {
    setDiscardedDrafts((current) => {
      const next = new Map(current);
      next.delete(draft.id);
      return next;
    });
    setDrafts((current) => [...current, draft]);
  }

  return { drafts, discardedDrafts, updateFields, pickProduct, discardDraft, restoreDraft };
}
