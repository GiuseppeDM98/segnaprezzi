'use client';

/**
 * The review screen's success state: a full-screen overlay with an SVG
 * checkmark drawing its stroke, then a spring pop (§7).
 *
 * Design: it shows and hides on `isVisible` alone. How long it stays and
 * where the user goes next belong to the screen, which starts the timer
 * after the confirm succeeds.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { useAppMotion } from '@/lib/motion';

/** Show the "saved" checkmark over the whole screen while `isVisible`. */
export function SuccessOverlay({ isVisible }: { isVisible: boolean }) {
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
