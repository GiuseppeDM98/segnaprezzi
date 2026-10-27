'use client';

/**
 * The sticky bar that animates in while the catalog is in selection mode:
 * the selection count, bulk delete (one or more products) and merge (two
 * or more). It only offers the actions; what they do is the screen's.
 * Always mounted, so the bar can animate out through AnimatePresence.
 */
import { Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  STICKY_ACTION_BAR_CLASSES,
  useStickyActionBarHeight,
} from '@/components/ui/sticky-action-bar';
import { useAppMotion } from '@/lib/motion';

export interface SelectionActionBarProps {
  isOpen: boolean;
  selectedCount: number;
  onDelete: () => void;
  onMerge: () => void;
}

/** Render the bar while `isOpen`, with its buttons enabled by the selection count. */
export function SelectionActionBar({
  isOpen,
  selectedCount,
  onDelete,
  onMerge,
}: SelectionActionBarProps) {
  const t = useTranslations('products');
  const { isReduced, spring, fade } = useAppMotion();
  const bulkBarRef = useStickyActionBarHeight<HTMLDivElement>();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={isReduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={isReduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={isReduced ? fade : spring}
          ref={bulkBarRef}
          className={STICKY_ACTION_BAR_CLASSES}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
            <span className="font-mono text-[13px] text-text-muted tabular-nums">
              {t('selected', { count: selectedCount })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={selectedCount === 0}
                icon={<Trash2 className="size-4" />}
                onClick={onDelete}
                data-testid="open-bulk-delete"
              >
                {t('delete', { count: selectedCount })}
              </Button>
              <Button disabled={selectedCount < 2} onClick={onMerge} data-testid="open-merge">
                {t('merge', { count: selectedCount })}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
