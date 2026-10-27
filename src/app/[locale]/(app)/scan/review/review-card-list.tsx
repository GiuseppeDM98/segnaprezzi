'use client';

/**
 * The review screen's list: one animated editable card per draft, then a
 * placeholder card per photo still travelling, plus the skeleton shown while
 * the queue is first read.
 *
 * Design: the list owns how cards look and enter, not what they contain —
 * every edit, pick and discard goes back to the screen through callbacks, and
 * the screen keeps the card elements (via `registerCard`) so confirm can
 * scroll to the first card still missing something.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { ExtractionCard } from '@/components/capture/extraction-card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import type { ExtractionResult } from '@/lib/domain/extract-photo';
import { CARD_STAGGER_SECONDS, useAppMotion } from '@/lib/motion';
import type { PendingPhoto } from '@/lib/offline/db';
import { blockingReasonOf, type ReviewEntryDraft, toCardMatch } from './review-derivations';

export interface ReviewCardListProps {
  /** The drafts to show, already filtered by the "flagged" chip. */
  drafts: ReviewEntryDraft[];
  /** Photos not extracted yet; shown after the drafts when `showPending`. */
  unfinishedPhotos: PendingPhoto[];
  showPending: boolean;
  /** Receives each card's element on mount and null on unmount. */
  registerCard: (id: string, element: HTMLLIElement | null) => void;
  onChange: (id: string, patch: Partial<ExtractionResult>) => void;
  onOpenMatch: (id: string) => void;
  onDiscard: (id: string) => void;
}

/** Render the batch's cards, staggered in on first appearance. */
export function ReviewCardList({
  drafts,
  unfinishedPhotos,
  showPending,
  registerCard,
  onChange,
  onOpenMatch,
  onDiscard,
}: ReviewCardListProps) {
  const { isReduced, spring, fade } = useAppMotion();

  return (
    <ul className="flex flex-col gap-4">
      <AnimatePresence initial={!isReduced}>
        {drafts.map((draft, index) => (
          <motion.li
            key={draft.id}
            ref={(element) => {
              registerCard(draft.id, element);
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
              blockingReason={blockingReasonOf(draft)}
              isUnitPriceDerived={!draft.isUnitPriceEdited}
              onChange={(patch) => onChange(draft.id, patch)}
              onOpenMatch={() => onOpenMatch(draft.id)}
              onDiscard={() => onDiscard(draft.id)}
            />
          </motion.li>
        ))}
      </AnimatePresence>
      {showPending && unfinishedPhotos.map((photo) => <PendingCard key={photo.id} photo={photo} />)}
    </ul>
  );
}

/** The list's shape while the queue is first read: two grey cards. */
export function ReviewCardListSkeleton() {
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
